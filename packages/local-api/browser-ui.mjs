/** Local-only browser lab; no licensed artwork, card texts or legal Ancients rules. */
import {deckActions, deckCommand, deckSummary, parseSyntheticMovementPath} from './deck-controls.mjs';
import {createMovementBoard,renderMovementBoard} from './movement-board-ui.mjs';
import {distance} from '../hex-grid/hex.mjs';
import {describeCommandError} from './command-feedback.mjs';
import {createPrivateViewScope} from './private-view-scope.mjs';
import {privateProjectionMatches} from './private-projection.mjs';
import {createRevisionRefresh} from './revision-refresh.mjs';

const el = id => document.getElementById(id);
const message = value => {el('message').textContent = value;};
const stateText = value => {el('state').textContent = JSON.stringify(value,null,2);};
// Report command errors in their originating control group, not only in #message.
const deckFeedbackSlots=Object.freeze({
  'deck-initialize':'deck-init-feedback','deck-play':'deck-card-feedback',
  'deck-unit-add':'deck-orders-feedback','deck-unit-clear':'deck-orders-feedback',
  'deck-orders':'deck-orders-feedback','deck-undo':'deck-orders-feedback',
  'deck-move':'deck-move-feedback','deck-movement':'deck-move-feedback',
  'deck-ask-defense':'deck-combat-feedback','deck-stand':'deck-combat-feedback',
  'deck-evade':'deck-combat-feedback','deck-combat':'deck-combat-feedback',
  'deck-draw':'deck-combat-feedback',
  'ancients-finish-movement':'ancients-combat-feedback',
  'ancients-prepare-ranged':'ancients-combat-feedback',
  'ancients-cancel-ranged':'ancients-combat-feedback',
  'ancients-roll-digital':'ancients-combat-feedback',
  'ancients-declare-physical':'ancients-combat-feedback',
  'ancients-elephant-red-ignore':'ancients-combat-feedback',
  'ancients-elephant-red-accept':'ancients-combat-feedback',
  'ancients-accept-physical':'ancients-combat-feedback',
  'ancients-dispute-physical':'ancients-combat-feedback',
  'ancients-finalize-ranged':'ancients-combat-feedback',
  'ancients-archive-ranged':'ancients-combat-feedback',
  'ancients-decline-battle-back':'ancients-combat-feedback',
  'ancients-accept-battle-back':'ancients-combat-feedback',
  'ancients-confirm-momentum':'ancients-combat-feedback',
  'ancients-decline-bonus-close':'ancients-combat-feedback',
  'ancients-confirm-unit-evade':'ancients-combat-feedback',
  'ancients-roll-leader':'ancients-combat-feedback',
  'ancients-evade-leader':'ancients-combat-feedback',
  'ancients-confirm-morale':'ancients-combat-feedback',
  'ancients-confirm-retreat':'ancients-combat-feedback',
  'ancients-roll-rampage':'ancients-combat-feedback',
  'ancients-evade-rampage':'ancients-combat-feedback'
});
function clearDeckFeedback() {
  for(const id of new Set(Object.values(deckFeedbackSlots))) el(id).textContent='';
}
let cached = null;
let signedInHandle = null;
const privateScope = createPrivateViewScope();
let movementBoard = null;
let ancientsDraft = null;
let ancientsDraftScope = null;
let ancientsRetry = null;
let ancientsWatch = null, ancientsWatchMatchId = null, ancientsWatchBusy = false;
function syncAncientsWatch(){
  const id=cached?.status==='LAB_ONLY'&&signedInHandle
    ? privateScope.capture().matchId:null;
  if(!id||ancientsWatchMatchId!==id){
    if(ancientsWatch!==null)clearInterval(ancientsWatch);
    ancientsWatch=null;ancientsWatchMatchId=null;
  }
  if(!id||ancientsWatch!==null)return;
  ancientsWatchMatchId=id;
  ancientsWatch=setInterval(async()=>{
    if(ancientsWatchBusy||document.hidden||cached?.status!=='LAB_ONLY'||
       privateScope.capture().matchId!==id)return;
    ancientsWatchBusy=true;
    try{await inspect();}
    catch{/* The next authenticated poll can retry; never reveal old state. */}
    finally{ancientsWatchBusy=false;}
  },12000); // Fallback in case a private SSE notice is missed.
  ancientsWatch.unref?.();
}
let updates = null, updateMatchId = null, inspectionSequence = 0;
let lobbyStatus = null, panelKey = null;
let lobbyWatch = null, lobbyWatchMatchId = null, lobbyWatchBusy = false;

// SSE is primary; a bounded authorized recheck only while INVITING
// avoids a stuck lobby if the READY transition notice is missed.
function syncLobbyWatch(mode, matchId) {
  const waiting = mode === 'invite' && Boolean(signedInHandle && matchId);
  if (!waiting || lobbyWatchMatchId !== matchId) {
    if (lobbyWatch !== null) clearInterval(lobbyWatch);
    lobbyWatch = null;
    lobbyWatchMatchId = null;
  }
  if (!waiting || lobbyWatch !== null) return;
  const watching = matchId;
  lobbyWatchMatchId = watching;
  lobbyWatch = setInterval(async () => {
    if (lobbyWatchBusy || document.hidden || !signedInHandle ||
        privateScope.capture().matchId !== watching ||
        lobbyStatus === 'READY') return;
    lobbyWatchBusy = true;
    try {
      await inspect(); // independently revalidates session and match
    } catch {
      // A transient GET error cannot leak state or stop later recovery.
    } finally { lobbyWatchBusy = false; }
  }, 2500);
  lobbyWatch.unref?.(); // Node test harness; no effect on browsers
}
let selectedOrderUnits = new Set(), orderSelectionContext = null;

// Fold irrelevant application phases, but do not override a player's manual
// expand/collapse choice on every SSE update. Never expose private data merely
// because a panel has been opened: authorized GET and projection still rule.
function updatePanels() {
  const matchId = privateScope.capture().matchId;
  const mode = !signedInHandle ? 'login' : !matchId ? 'browse' :
    lobbyStatus !== 'READY' ? 'invite' :
      typeof cached?.phase === 'string' ? 'game' : 'ready';
  el('login-form').hidden = Boolean(signedInHandle);
  el('logout').disabled = !signedInHandle;
  syncLobbyWatch(mode,matchId);
  const key = [signedInHandle ?? '', matchId ?? '', mode].join(':');
  if (key === panelKey) return;
  panelKey = key;
  const open = {
    'login-details': mode === 'login',
    'match-details': mode === 'browse' || mode === 'invite',
    'invite-details': mode === 'browse' || mode === 'invite',
    'state-details': mode === 'ready' || mode === 'game',
    'deck-details': mode === 'ready' || mode === 'game',
    'movement-details': mode === 'game' && cached?.status !== 'LAB_ONLY',
    'ancients-details': mode === 'game' && cached?.status === 'LAB_ONLY'
  };
  for (const [id,expanded] of Object.entries(open)) el(id).open = expanded;
}

// A dropdown is only a convenience: the server independently validates all
// unit IDs and all orders. Never present hidden hands or opponent units as
// selectable own units.
function updateUnitOptions(id, side, multiple = false) {
  const select = el(id);
  const previous = new Set(Array.from(select.selectedOptions ?? [],option=>option.value));
  const previousValue = select.value;
  select.replaceChildren();
  if (!multiple) {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Selecciona una unidad';
    select.appendChild(placeholder);
  }
  const units = Array.isArray(cached?.board) ? cached.board : [];
  for (const unit of units) {
    if (!unit || unit.side !== side || typeof unit.id !== 'string' ||
        !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(unit.id) ||
        !Number.isSafeInteger(unit.col) || !Number.isSafeInteger(unit.row)) continue;
    const option = document.createElement('option');
    option.value = unit.id;
    option.textContent = `${unit.id} (col. ${unit.col+1}, fila ${unit.row+1})`;
    option.selected = multiple ? previous.has(unit.id) : previousValue === unit.id;
    select.appendChild(option);
  }
  if (!multiple && !Array.from(select.options ?? select.children ?? [])
    .some(option=>option.value === previousValue && option.selected)) select.value = '';
}
const revisionRefresh = createRevisionRefresh({
  inspect: () => inspect(),
  onError: error => message(error.message)
});
revisionRefresh.setPaused(document.hidden);

// Optional, explicitly local Ancients laboratory. This control surface is
// completely separate from the old synthetic deck command contract.
function renderAncients() {
  const lab=cached?.status==='LAB_ONLY';
  const ready=lobbyStatus==='READY'&&Boolean(cached?.matchId);
  syncAncientsWatch();
  el('ancients-details').hidden=!ready;
  el('ancients-start').disabled=!ready||lab||cached?.you!=='A'||
    cached?.revision!==0||Boolean(cached?.phase);
  el('ancients-refresh').disabled=!ready;
  el('ancients-controls').hidden=!lab;
  if(!lab){
    ancientsDraft=null;ancientsDraftScope=null;ancientsRetry=null;
    el('ancients-status').textContent=ready
      ? 'Demo de Ancients no iniciada. Requiere activación local expresa.'
      : 'No hay partida preparada.';
    return;
  }
  const victory=cached.diceLab?.victory,finished=!!victory?.winner;
  const stopped=finished||cached.historyLimitReached===true;
  const isTurn=!stopped&&cached.turn===cached.you;
  const combat=cached.combatLab;
  const movementClosed=combat?.movementClosed===true;
  const scope=[cached.matchId,cached.you,cached.revision,cached.phase].join(':');
  if(ancientsDraftScope!==scope){
    ancientsDraft=null;ancientsRetry=null;ancientsDraftScope=scope;
    for(let i=1;i<=7;i++)el('ancients-physical-die-'+i).value='';
  }
  el('ancients-status').textContent=
    finished?`Partida terminada · ${victory.winner==='DRAW'?'Empate':victory.winner===cached.you?'Victoria':'Derrota'} · revisión ${cached.revision}`:
    cached.historyLimitReached?'Límite de comandos del laboratorio alcanzado. Consulta disponible; partida sin resolución.':
    `Ancients experimental · ${cached.phase} · turno ${cached.turn} · revisión ${cached.revision}`;
  const terrainNames={FOREST:'bosque',HILL:'colina',
    BROKEN_GROUND:'terreno accidentado'};
  el('ancients-terrain-info').textContent='Terreno del escenario: '+
    (cached.terrain?.length
      ?cached.terrain.map(x=>`${terrainNames[x.kind]??'desconocido'} (${x.col+1},${x.row+1})`).join('; ')
      :'solo hexágonos despejados')+'.';
  const selection=cached.selectionCard;
  const clash=cached.cardInPlay==='CLASH_OF_SHIELDS';
  const cardNames={ORDER_LIGHT_TROOPS:'Orden a tropas ligeras',ORDER_MEDIUM_TROOPS:'Orden a tropas medias',ORDER_HEAVY_TROOPS:'Orden a tropas pesadas',ORDER_MOUNTED_TROOPS:'Orden a tropas montadas',COORDINATED_ATTACK:'Ataque coordinado',OUT_FLANKED:'Ataque por los flancos',LINE_COMMAND:'Orden en línea',DOUBLE_TIME:'Paso acelerado',MOUNTED_CHARGE:'Carga de tropas montadas',CLASH_OF_SHIELDS:'Choque de escudos'};
  if(isTurn&&selection)el('ancients-status').textContent+=' · '+(cardNames[cached.cardInPlay]??cached.cardInPlay)+' · máximo '+selection.maximumOrders+' órdenes'+(selection.fallback?' (sin tropas de esa clase)':selection.connected?' (grupo de unidades contiguas)':'');
  const cardSelect=el('ancients-card');
  const chosen=cardSelect.value;
  cardSelect.replaceChildren();
  for(const card of cached.yourHand??[]){
    const option=document.createElement('option');
    option.value=card.instanceId;
    option.textContent=cardNames[card.definitionId]??card.definitionId;
    cardSelect.appendChild(option);
  }
  if((cached.yourHand??[]).some(c=>c.instanceId===chosen))
    cardSelect.value=chosen;
  const unitSelect=el('ancients-units');
  const selected=new Set(Array.from(unitSelect.selectedOptions??[],x=>x.value));
  unitSelect.replaceChildren();
  for(const unit of cached.board??[]){
    if(unit.side!==cached.you||selection&&!selection.unitIds.includes(unit.id))continue;
    const option=document.createElement('option');
    option.value=unit.id;
    option.textContent=`${unit.id} (${unit.unitType}, ${unit.col+1},${unit.row+1})`;
    option.selected=!!selection?.allRequired||selected.has(unit.id);
    unitSelect.appendChild(option);
  }
  const leaderOrderSelect=el('ancients-leader-orders');
  const chosenLeaders=new Set(Array.from(
    leaderOrderSelect.selectedOptions??[],o=>o.value));
  leaderOrderSelect.replaceChildren();
  for(const leader of cached.leaders??[]){
    if(leader.side!==cached.you||selection&&!selection.leaderIds.includes(leader.id))continue;
    const option=document.createElement('option');
    option.value=leader.id;
    option.textContent=`${leader.id} (${leader.col+1},${leader.row+1})`;
    option.selected=chosenLeaders.has(leader.id);
    leaderOrderSelect.appendChild(option);
  }
  const orderedLeaders=new Set(cached.orderedLeaderIds??[]);
  const movedLeaders=new Set(cached.movedLeaderIds??[]);
  const availableLeaders=(cached.leaders??[]).filter(l=>l.side===cached.you&&
    orderedLeaders.has(l.id)&&!movedLeaders.has(l.id));
  const leaderChoice=el('ancients-leader-choice');
  const previousLeader=leaderChoice.value;
  leaderChoice.replaceChildren();
  const blank=document.createElement('option');
  blank.value='';blank.textContent='Selecciona un líder';
  leaderChoice.appendChild(blank);
  for(const leader of availableLeaders){
    const option=document.createElement('option');
    option.value=leader.id;
    option.textContent=leader.id;
    leaderChoice.appendChild(option);
  }
  leaderChoice.value=availableLeaders.some(l=>l.id===previousLeader)
    ?previousLeader:(availableLeaders[0]?.id??'');
  el('ancients-select-leader').disabled=!isTurn||
    cached.phase!=='LAB_RESOLUTION_PENDING'||movementClosed||availableLeaders.length===0;
  const ordered=new Set(Array.isArray(cached.orderedUnitIds)?cached.orderedUnitIds:[]);
  const moved=new Set(Array.isArray(cached.movedUnitIds)?cached.movedUnitIds:[]);
  const locked=new Set(Array.isArray(cached.unitsLockedByLeader)?cached.unitsLockedByLeader:[]);
  const selectable=movementClosed||!isTurn||clash?[]:(cached.board??[]).filter(u=>u.side===cached.you&&
    ordered.has(u.id)&&!moved.has(u.id)&&!locked.has(u.id)).map(u=>u.id);
  el('ancients-play').disabled=!isTurn||cached.phase!=='AWAIT_CARD'||
    (cached.yourHand??[]).length===0;
  el('ancients-order').disabled=!isTurn||cached.phase!=='ASSIGN_ORDERS';
  el('ancients-end').disabled=!isTurn||cached.phase!=='LAB_RESOLUTION_PENDING'||Boolean(combat?.plan)||!!cached.diceLab?.battleBackPending||!!cached.diceLab?.momentumPending||!!cached.diceLab?.bonusClosePending||!!combat?.pendingWarriorCharges?.length;
  el('ancients-finish-movement').hidden=!combat;
  el('ancients-finish-movement').disabled=!combat||!isTurn||cached.phase!=='LAB_RESOLUTION_PENDING'||movementClosed;
  el('ancients-clear-path').disabled=!ancientsDraft;
  el('ancients-move').disabled=!isTurn||movementClosed||clash||cached.phase!=='LAB_RESOLUTION_PENDING'||
    !ancientsDraft?.path.length||!!(ancientsDraft?.kind!=='LEADER'&&ancientsDraft?.path.length&&(cached.board??[]).some(u=>u.col===ancientsDraft.path.at(-1).col&&u.row===ancientsDraft.path.at(-1).row));
  el('ancients-route-status').textContent=ancientsDraft
    ? `${ancientsDraft.kind==='LEADER'?'Líder':'Unidad'} ${ancientsDraft.unitId}: ${ancientsDraft.path.length} hexágonos. Confirma para validar en el servidor.`
    : clash&&!movementClosed?'Choque de escudos: las unidades no se mueven antes del combate. Cierra la fase de movimiento.':movementClosed?'Movimiento cerrado. Prepara un ataque si está disponible.':`${selectable.length} unidades ordenadas disponibles; selecciona una sobre el tablero.`;
  el('ancients-combat').hidden=!combat||!movementClosed;
  const choice=el('ancients-ranged-choice'),oldChoice=choice.value;
  choice.replaceChildren();
  const candidates=isTurn&&movementClosed&&!combat?.plan?(combat.candidates??[]):[];
  for(const [index,candidate] of candidates.entries()){
    const option=document.createElement('option');
    option.value=String(index);
    option.textContent=`${candidate.bonusClose?'Combate adicional':candidate.kind==='CLOSE_PREVIEW'?'Cuerpo a cuerpo':'A distancia'}: ${candidate.attackerId} → ${candidate.loneLeader?'líder ':''}${candidate.targetId} (${candidate.diceCount} dados)`;
    choice.appendChild(option);
  }
  if(candidates.length)choice.value=candidates[Number(oldChoice)]?oldChoice||'0':'0';
  el('ancients-prepare-ranged').disabled=!isTurn||!candidates.length||Boolean(combat?.plan);
  const dice=cached.diceLab,pending=dice?.pending,last=dice?.last;
  el('ancients-cancel-ranged').disabled=!isTurn||!combat?.plan||!!pending||!!combat?.plan?.evadeOptions?.length||!!combat?.plan?.battleBack||!!combat?.plan?.bonusClose;
  const plan=combat?.plan;
  el('ancients-combat-status').textContent=plan
    ?`Preparación: ${plan.attackerId} → ${plan.targetId}. Distancia ${plan.distance}; movimiento ${plan.movedSteps}; ${plan.diceCount} dados (base: ${plan.baseDice}${plan.cardBonusDice?' · carta +'+plan.cardBonusDice:''}).`
    :!isTurn?'El adversario prepara su combate.':candidates.length
      ?`${candidates.length} ataques disponibles.`:'No hay ataques disponibles en esta posición.';
  el('ancients-banners').textContent=dice?.banners?`Medallas: A ${dice.banners.A}${victory?'/'+victory.targets.A:''} · B ${dice.banners.B}${victory?'/'+victory.targets.B:''}`+(finished?` · ${victory.winner==='DRAW'?'Empate':'Vencedor: '+victory.winner}`:''):'';
  el('ancients-dice-controls').hidden=!dice||!movementClosed;
  const unitEvadeChoice=el('ancients-unit-evade-choice'),oldUnitEvade=unitEvadeChoice.value;
  unitEvadeChoice.replaceChildren();
  if(dice?.unitEvadePending&&dice.canChooseUnitEvade){
    for(const path of [[],...(plan?.evadeOptions??[])]){
      const option=document.createElement('option');
      option.value=JSON.stringify(path);
      option.textContent=path.length?'Evadir: '+path.map(c=>'('+ (c.col+1)+','+(c.row+1)+')').join(' → '):'Permanecer y combatir';
      unitEvadeChoice.appendChild(option);
    }
    if([...unitEvadeChoice.options].some(o=>o.value===oldUnitEvade))unitEvadeChoice.value=oldUnitEvade;
  }
  el('ancients-unit-evade-controls').hidden=!dice?.unitEvadePending;
  el('ancients-confirm-unit-evade').disabled=stopped||!dice?.canChooseUnitEvade;
  unitEvadeChoice.disabled=stopped||!dice?.canChooseUnitEvade;
  el('ancients-unit-evade-status').textContent=dice?.unitEvadePending
    ?dice.canChooseUnitEvade?'Elige permanecer o evadir antes de la tirada.':'El defensor debe decidir antes de tirar.'
    :'';
  const mayRoll=!!dice&&!stopped&&(dice.combatSide??cached.turn)===cached.you&&!!plan&&!pending&&!dice.unitEvadePending;
  el('ancients-roll-digital').disabled=!mayRoll;
  el('ancients-declare-physical').disabled=!mayRoll;
  const rerollField=el('ancients-elephant-rerolls');
  const repeats=!!plan?.elephantAttack&&plan.swordsHit&&!plan.evadePath?.length;
  el('ancients-elephant-reroll-controls').hidden=!repeats;
  rerollField.disabled=!mayRoll||!repeats;
  if(!repeats||pending)rerollField.value='';
  el('ancients-elephant-red-controls').hidden=!dice?.elephantRedPending;
  el('ancients-elephant-red-ignore').disabled=stopped||!dice?.canChooseElephantRed;
  el('ancients-elephant-red-accept').disabled=stopped||!dice?.canChooseElephantRed;
  for(let i=1;i<=7;i++){
    el('ancients-physical-die-'+i).disabled=!mayRoll||i>(plan?.diceCount??0);
    if(i>1)el('ancients-physical-die-'+i+'-label').hidden=i>(plan?.diceCount??0);
  }
  el('ancients-decline-battle-back').hidden=!dice?.battleBackPending;
  el('ancients-decline-battle-back').disabled=stopped||!dice?.canDeclineBattleBack;
  el('ancients-accept-battle-back').hidden=!dice?.battleBackPending;
  el('ancients-accept-battle-back').disabled=stopped||!dice?.canAcceptBattleBack;
  if(dice?.battleBackPending)el('ancients-combat-status').textContent=
    'Respuesta al combate pendiente. El defensor debe decidir si responde o renuncia.';
  const momentumChoice=el('ancients-momentum-choice'),oldMomentum=momentumChoice.value;
  momentumChoice.replaceChildren();
  const momentumOptions=dice?.momentumOptions??[];
  if(dice?.canChooseMomentum){
    for(const path of [[],...momentumOptions.map(o=>o.path)]){
      const option=document.createElement('option');option.value=JSON.stringify(path);
      option.textContent=path.length?'Avanzar: '+path.map(c=>'('+(c.col+1)+','+(c.row+1)+')').join(' → '):'Renunciar al avance';
      momentumChoice.appendChild(option);
    }
    if([[],...momentumOptions.map(o=>o.path)].some(p=>JSON.stringify(p)===oldMomentum))momentumChoice.value=oldMomentum;
  }
  el('ancients-momentum-controls').hidden=!dice?.momentumPending;
  el('ancients-confirm-momentum').disabled=stopped||!dice?.canChooseMomentum;
  momentumChoice.disabled=stopped||!dice?.canChooseMomentum;
  el('ancients-momentum-status').textContent=dice?.canChooseMomentum?'Puedes avanzar al hexágono liberado o renunciar.':'El atacante debe decidir si avanza.';
  el('ancients-decline-bonus-close').hidden=!dice?.bonusClosePending;
  el('ancients-decline-bonus-close').disabled=stopped||!dice?.canDeclineBonusClose;
  if(dice?.bonusClosePending)el('ancients-combat-status').textContent='Combate adicional disponible: el atacante puede seleccionar un objetivo adyacente o renunciar.';
  if(isTurn&&!plan&&!dice?.momentumPending&&!dice?.battleBackPending&&!dice?.bonusClosePending&&combat?.pendingWarriorCharges?.length)
    el('ancients-combat-status').textContent='Carga obligatoria pendiente: '+combat.pendingWarriorCharges.join(', ')+'. Selecciona un combate cuerpo a cuerpo.';
  if(plan?.bonusClose)el('ancients-combat-status').textContent=`Combate adicional: ${plan.attackerId} → ${plan.targetId} (${plan.diceCount} dados).`;
  if(plan?.battleBack)el('ancients-combat-status').textContent=`Respuesta al combate: ${plan.attackerId} → ${plan.targetId} (${plan.diceCount} dados).`;
  el('ancients-accept-physical').disabled=stopped||!dice?.canReview;
  el('ancients-dispute-physical').disabled=stopped||!dice?.canReview;
  el('ancients-finalize-ranged').disabled=stopped||!dice?.canFinalize;
  el('ancients-roll-leader').disabled=stopped||!dice?.canRollLeader;
  el('ancients-roll-leader').hidden=!dice?.banners;
  el('ancients-archive-ranged').disabled=stopped||!dice?.canArchive||!!dice?.leaderEvasionAvailable;
  const evadeChoice=el('ancients-evasion-choice'),oldEvasion=evadeChoice.value;
  const evasionOptions=dice?.leaderEvasionOptions??[];
  evadeChoice.replaceChildren();
  for(const candidate of evasionOptions){
    const option=document.createElement('option');
    option.value=JSON.stringify(candidate);
    const route=candidate.path.map(p=>`(${p.col+1},${p.row+1})`).join(' → ');
    option.textContent=candidate.trapped?'Sin salida: confirmar baja del líder':(candidate.exit?(route?route+' → fuera del tablero':'Salir del tablero'):route)+
      (candidate.risks?.length?' · riesgo: '+candidate.risks.map(r=>r.unitId+' ('+r.diceCount+' dados)').join(', '):'');
    evadeChoice.appendChild(option);
  }
  if(evasionOptions.some(o=>JSON.stringify(o)===oldEvasion))evadeChoice.value=oldEvasion;
  el('ancients-evasion-controls').hidden=dice?.blocker!=='LEADER_EVASION_PENDING';
  el('ancients-evade-leader').disabled=stopped||!dice?.canEvadeLeader;
  el('ancients-evasion-status').textContent=dice?.leaderEvasionAvailable
    ?dice.canEvadeLeader?'Elige la ruta de evasión de tu líder.':'El adversario debe elegir la evasión de su líder.'
    :'No hay una ruta sin enemigos disponible en este laboratorio.';
  const morale=dice?.moralePreview,decision=dice?.morale??last?.morale;
  const moraleChoice=el('ancients-morale-choice'),previousMorale=moraleChoice.value;
  moraleChoice.replaceChildren();
  if(dice?.canChooseMorale){
    for(let n=0;n<=morale.maxIgnored;n++){
      const option=document.createElement('option');option.value=String(n);
      option.textContent=`Ignorar ${n}; aceptar ${morale.flags-n}`;moraleChoice.appendChild(option);
    }
    moraleChoice.value=previousMorale!==''&&Number(previousMorale)<=morale.maxIgnored?previousMorale:String(morale.maxIgnored);
  }
  el('ancients-morale-controls').hidden=!morale&&!decision;
  el('ancients-confirm-morale').disabled=stopped||!dice?.canChooseMorale;
  el('ancients-morale-status').textContent=morale
    ?`Banderas: ${morale.flags}; máximo ignorable: ${morale.maxIgnored}. Líder: ${morale.attachedLeader?'sí':'no'}; apoyo: ${morale.supported?'sí':'no'}; guerreros al completo: ${morale.fullWarrior?'sí':'no'}.`+(decision?` Ignoradas: ${decision.ignored}; pendientes de retirada: ${decision.remaining}.`:'')
    :decision?`Banderas ignoradas: ${decision.ignored}; aceptadas: ${decision.remaining}.`:'';
  const retreat=dice?.retreat,retreatChoice=el('ancients-retreat-choice'),oldRetreat=retreatChoice.value;
  retreatChoice.replaceChildren();
  for(const candidate of retreat?.options??[]){
    const option=document.createElement('option');option.value=JSON.stringify(candidate.path);
    const route=candidate.path.map(p=>`(${p.col+1},${p.row+1})`).join(' → ')||'Sin desplazamiento';
    option.textContent=route+` · bajas: ${candidate.blocksLost}`+(candidate.joinedLeaderId?' · unión a '+candidate.joinedLeaderId:'')+(candidate.needsLeaderResolution?' · comprobar consecuencias del líder':'');
    if(candidate.blockingLosses?.length)option.textContent+=' · pérdidas de bloqueadores: '+candidate.blockingLosses.map(l=>(l.unitId??l.leaderId)+' ('+l.blocksLost+')').join(', ');
    retreatChoice.appendChild(option);
  }
  if(retreat?.options.some(o=>JSON.stringify(o.path)===oldRetreat))retreatChoice.value=oldRetreat;
  el('ancients-retreat-controls').hidden=!retreat&&!last?.retreat&&!dice?.retreatPending&&!dice?.elephantRetreatPending;
  el('ancients-confirm-retreat').disabled=stopped||!dice?.canRetreat;
  el('ancients-retreat-status').textContent=retreat
    ?`Retirada de ${retreat.required} hexágonos por ${retreat.flags} bandera(s). `+
       (retreat.reason==='ELEPHANT_RAMPAGE_PENDING'?'El atacante debe resolver las tiradas de estampida.':
        retreat.reason==='ELEPHANT_LEADER_EFFECTS_PENDING'?'Líder unido al elefante: caso pendiente.':
        retreat.reason==='RAMPAGE_LEADER_EVASION_PENDING'?'Resuelve primero la evasión del líder.':
        retreat.reason==='ELEPHANT_BLOCKER_LEADERS_PENDING'?'Pérdidas de bloqueadores con líderes aún no disponibles.':
        retreat.reason?'Consecuencias para el líder aún no implementadas.':
        dice.canRetreat?'Elige una ruta validada.':'El defensor debe elegir la ruta.')
    :dice?.retreatPending?`Ruta confirmada: ${dice.retreatPending.choice.path.length} pasos; ${dice.retreatPending.choice.blocksLost} bajas previstas. Pendiente de resolver el líder.`
    :last?.retreat?`Retirada aplicada: ${last.retreat.path.length} pasos, ${last.retreat.blocksLost} bloques perdidos.`:'';
  const rampage=dice?.rampage,rampageChoice=el('ancients-rampage-choice'),oldRampage=rampageChoice.value;
  rampageChoice.replaceChildren();
  for(const u of rampage?.remaining??[]){
    const option=document.createElement('option');option.value=u.unitId;
    option.textContent=u.unitId+' ('+(u.side===cached.you?'propia':'adversaria')+')';rampageChoice.appendChild(option);
  }
  if(rampage?.remaining.some(u=>u.unitId===oldRampage))rampageChoice.value=oldRampage;
  el('ancients-rampage-controls').hidden=!rampage&&!last?.rampage;
  el('ancients-roll-rampage').disabled=stopped||!rampage?.canRoll;
  const rampageEvasion=rampage?.evasion,rampageRoute=el('ancients-rampage-evasion'),oldRampageRoute=rampageRoute.value;
  rampageRoute.replaceChildren();
  for(const o of rampageEvasion?.options??[]){
    const option=document.createElement('option');option.value=JSON.stringify(o);
    option.textContent=o.trapped?'Sin salida: baja del líder':(o.path.map(p=>`(${p.col+1},${p.row+1})`).join(' → ')+(o.exit?' → fuera del tablero':''))+
      (o.risks.length?' · riesgo: '+o.risks.map(r=>r.unitId+' ('+r.diceCount+' dados)').join(', '):'');
    rampageRoute.appendChild(option);
  }
  if(rampageEvasion?.options.some(o=>JSON.stringify(o)===oldRampageRoute))rampageRoute.value=oldRampageRoute;
  el('ancients-rampage-evasion-controls').hidden=!rampageEvasion;
  el('ancients-evade-rampage').disabled=stopped||!rampageEvasion?.options.length;
  el('ancients-rampage-evasion-status').textContent=rampageEvasion?'Evasión de '+rampageEvasion.leaderId+' (bando '+rampageEvasion.side+').':'';
  const elephantStage=dice?.elephantRetreatPending;
  if(elephantStage)el('ancients-retreat-status').textContent=dice.blocker
    ?'Retirada confirmada: resolver las evasiones de líderes antes de aplicar las bajas.'
    :'Evasiones resueltas: el atacante puede aplicar las bajas y medallas.';
  const faceNames={LIGHT:'Ligera',MEDIUM:'Media',HEAVY:'Pesada',
    LEADER:'Líder',FLAG:'Bandera',SWORDS:'Espadas'};
  el('ancients-rampage-status').textContent=(rampage?.rolls??last?.rampage??[]).map(r=>r.unitId+': '+r.results.map(f=>faceNames[f]??f).join(', ')+'; bajas: '+r.blocksLost+(r.leaderId?' · líder '+r.leaderId+(r.leaderEliminated||r.evasion?.escape.eliminated?' eliminado':r.needsEvasion&&!r.evasion?' debe evadirse':' superviviente'):'')).join(' | ');
  const elephantChecks=elephantStage?.checks??last?.elephantChecks;
  if(elephantChecks?.length)el('ancients-rampage-status').textContent+=' | Comprobaciones de retirada: '+elephantChecks.map(c=>c.leaderId+': '+(c.reused?'tirada anterior':c.faces.map(f=>faceNames[f]??f).join(', '))+(c.leaderEliminated?' (baja)':c.needsEvasion?' (evasión)':' (superviviente)')).join('; ');
  const reviewNames={SERVER_GENERATED:'Digital, generada por el servidor',
    AWAITING_OPPONENT:'Física, pendiente de revisión del adversario',
    ACCEPTED:'Física, aceptada por el adversario',DISPUTED:'Física, en desacuerdo'};
  const shown=pending??last;
  const blockerNames={ELIMINATION_PENDING:'eliminación de unidad',
    LEADER_CHECK_PENDING:'comprobación de líder',RETREAT_PENDING:'retirada',
    LEADER_EVASION_PENDING:'evasión del líder superviviente',MORALE_CHOICE_PENDING:'decisión de moral del defensor',ELEPHANT_RETREAT_EVASION_PENDING:'evasión de líder tras retirada de elefante',
    PHYSICAL_ROLL_DISPUTED:'desacuerdo sobre la tirada física'};
  el('ancients-dice-status').textContent=shown?.loss.kind==='LONE_LEADER_LOSS'
    ?`${reviewNames[shown.review]??'Tirada'} contra líder: ${shown.roll.results.map(x=>faceNames[x]??x).join(', ')}. ${shown.loss.leaderWouldBeEliminated?'Impacto de líder.':'Sin impacto de líder.'}`+
      (pending?(dice.blocker?` Pendiente: ${blockerNames[dice.blocker]??'efecto no disponible'}.`:' Aún no se ha aplicado el resultado.'):'')
    :shown
    ?`${reviewNames[shown.review]??'Tirada'}: ${shown.roll.results.map(x=>faceNames[x]??x).join(', ')}${shown.interpretation.rerolls?.length?' · Repeticiones: '+shown.interpretation.rerolls.map(x=>faceNames[x]??x).join(', '):''}${shown.interpretation.chariotSwordIgnored?' · Primera espada ignorada':''}. Impactos: ${shown.interpretation.hits??shown.interpretation.matchingColorHits}; banderas: ${shown.interpretation.flagsPending}; bloques previstos tras impactos: ${shown.loss.remainingBlocks}.`+
      (pending?(dice.blocker?` Pendiente: ${blockerNames[dice.blocker]??'efecto no disponible'}.`:' Aún no se han aplicado bajas.')
        :last.outcome==='DIRECT_HITS_APPLIED'?` Bloques retirados: ${last.blocksApplied}; quedan ${last.blocksRemaining}.`:' Archivado sin aplicar efectos (solo laboratorio).')
    :plan?'Elige tirada digital o registra los dados físicos.':'Sin tirada registrada en este turno.';
  const leaderCheck=dice?.leaderCheck??last?.leaderCheck;
  el('ancients-leader-check-status').textContent=leaderCheck
    ?`Líder ${leaderCheck.leaderId}: ${leaderCheck.roll.results.map(x=>faceNames[x]??x).join(', ')}. ${leaderCheck.outcome.leaderWouldBeEliminated?'Resultado: baja de líder.':'Resultado: líder superviviente.'}`
    :'';
  el('ancients-casualty-status').textContent=last?.unitEliminated||last?.leaderEliminated
    ?`Bajas aplicadas: ${last.unitEliminated?'unidad '+last.targetId:''}${last.unitEliminated&&last.leaderEliminated?' y ':''}${last.leaderEliminated?'líder '+(last.loneLeader?last.targetId:last.leaderCheck?.leaderId??last.leaderEvasion?.leaderId??'') :''}.`
    :'';
  if(last?.leaderEvasion?.escape?.eliminated)el('ancients-casualty-status').textContent+=last.leaderEvasion.trapped
    ?' Líder eliminado por imposibilidad de escapar.':' Líder eliminado durante el escape.';
  else if(last?.leaderEvasion)el('ancients-casualty-status').textContent+=last.leaderEvasion.exit
    ?' El líder salió del tablero sin conceder medalla.'
    :' El líder se desplazó a ('+(last.leaderEvasion.path.at(-1).col+1)+','+(last.leaderEvasion.path.at(-1).row+1)+').';
  if(last?.leaderEvasion?.escape?.rolls.length)el('ancients-casualty-status').textContent+=' Tiradas de escape: '+last.leaderEvasion.escape.rolls.map(r=>r.unitId+': '+r.results.map(x=>faceNames[x]??x).join(', ')).join('; ')+'.';
  const svg=el('ancients-board');
  if(svg?.ownerDocument?.createElementNS){
    renderMovementBoard(svg,cached.board??[],ancientsDraft,selectAncientsHex,cached.you,{
      terrain:Array.isArray(cached.terrain)?cached.terrain:[],
      selectableUnitIds:selectable,
      leaders:Array.isArray(cached.leaders)?cached.leaders:[]
    });
  }
}
function selectAncientsHex(cell){
  if(cached?.status!=='LAB_ONLY'||cached.diceLab?.victory?.winner||cached.historyLimitReached||cached.turn!==cached.you||
     cached.phase!=='LAB_RESOLUTION_PENDING'||cached.combatLab?.movementClosed||cached.cardInPlay==='CLASH_OF_SHIELDS')return;
  const units=cached.board??[];
  const at=units.find(u=>u.col===cell.col&&u.row===cell.row);
  const ordered=new Set(cached.orderedUnitIds??[]);
  const moved=new Set(cached.movedUnitIds??[]);
  const locked=new Set(cached.unitsLockedByLeader??[]);
  const transit=!!ancientsDraft&&ancientsDraft.kind!=='LEADER'&&cached.cardInPlay==='ORDER_LIGHT_TROOPS'&&ancientsDraft.path.length===0&&at?.side===cached.you&&at.id!==ancientsDraft.unitId&&['LIGHT_INFANTRY','LIGHT_SLING_INFANTRY','LIGHT_BOW_INFANTRY','AUXILIA_INFANTRY'].includes(units.find(u=>u.id===ancientsDraft.unitId)?.unitType)&&distance(ancientsDraft.origin,cell)===1;
  if(!transit&&ancientsDraft?.kind!=='LEADER'&&at?.side===cached.you&&ordered.has(at.id)&&!moved.has(at.id)&&!locked.has(at.id)){
    ancientsDraft={unitId:at.id,origin:{col:at.col,row:at.row},
      path:[],revision:cached.revision};
  }else if(ancientsDraft){
    const key=p=>`${p.col},${p.row}`;
    const previous=ancientsDraft.path.at(-1)??ancientsDraft.origin;
    const index=ancientsDraft.path.findIndex(p=>key(p)===key(cell));
    if(key(ancientsDraft.origin)===key(cell)){
      ancientsDraft.path=[];
    }else if(index>=0){
      ancientsDraft.path=ancientsDraft.path.slice(0,index+1);
    }else if(distance(previous,cell)!==1){
      el('ancients-route-status').textContent='El siguiente hexágono debe ser contiguo.';
      return;
    }else if(at && !transit && !(ancientsDraft.kind==='LEADER'&&at.side===cached.you)){
      el('ancients-route-status').textContent='El hexágono está ocupado.';
      return;
    }else if(ancientsDraft.path.length >= (ancientsDraft.kind==='LEADER'?3:4)){
      el('ancients-route-status').textContent='Superado el máximo de recorrido de esta pieza.';
      return;
    }else{
      ancientsDraft.path.push({col:cell.col,row:cell.row});
    }
  }
  renderAncients();
}
async function sendAncients(type,fields={},idempotencyKey=null){
  if(cached?.status!=='LAB_ONLY'||!cached?.matchId)
    throw Error('LABORATORIO_NO_DISPONIBLE');
  const matchId=cached.matchId,ticket=privateScope.capture(),revision=cached.revision;
  if(cached.diceLab?.victory?.winner)throw Error('MATCH_FINISHED');
  if(cached.historyLimitReached)throw Error('SECTION_HISTORY_LIMIT_REACHED');
  if(!await confirmCurrentSession(ticket,matchId))return false;
  // Never attach a newer revision to fields selected from an older view.
  if(cached?.revision!==revision)throw Error('STALE_REVISION');
  if(cached.diceLab?.victory?.winner)throw Error('MATCH_FINISHED');
  if(cached.historyLimitReached)throw Error('SECTION_HISTORY_LIMIT_REACHED');
  const signature=JSON.stringify({matchId,side:cached.you,
    revision,type,fields});
  if(!ancientsRetry||ancientsRetry.signature!==signature){
    ancientsRetry={signature,
      key:idempotencyKey??crypto.randomUUID().replaceAll('-','')};
  }
  const command={type,expectedRevision:revision,
    idempotencyKey:ancientsRetry.key,...fields};
  // Retry the exact same command with the exact same key after transport
  // uncertainty. Never allow a network retry to create a second movement.
  await api('POST',`/api/matches/${matchId}/ancients-lab/commands`,command);
  ancientsRetry=null;
  if(!privateScope.isCurrent(ticket,matchId))return false;
  await inspect();
  return privateScope.isCurrent(ticket,matchId);
}

function renderDeck() {
  const isDeck = cached && cached.status !== 'LAB_ONLY' && typeof cached.phase === 'string';
  const options = isDeck ? deckActions(cached) : [];
  const orderContext = cached?.phase === 'ASSIGN_ORDERS'
    ? [cached.matchId,cached.you,cached.revision].join(':') : null;
  if (orderContext !== orderSelectionContext) {
    selectedOrderUnits.clear();
    orderSelectionContext = orderContext;
  }
  el('deck-panel').hidden = !isDeck;
  el('deck-initialize').disabled = !cached || cached.you !== 'A' || cached.revision !== 0 || isDeck || cached.status === 'LAB_ONLY';
  el('turn').disabled = Boolean(isDeck || cached?.status === 'LAB_ONLY');
  const select = el('deck-card');
  const selected = select.value;
  select.replaceChildren();
  if (isDeck && Array.isArray(cached.yourHand)) {
    for (const cardRef of cached.yourHand) {
      const option = document.createElement('option');
      option.value = cardRef;
      option.textContent = cardRef;
      select.appendChild(option);
    }
    if (cached.yourHand.includes(selected)) select.value = selected;
  }
  updateUnitOptions('deck-units',cached?.you);
  updateUnitOptions('deck-move-unit',cached?.you);
  updateUnitOptions('deck-target',cached?.you === 'A' ? 'B' : 'A');
  const currentUnits = new Set((Array.isArray(cached?.board) ? cached.board : [])
    .filter(unit => unit?.side === cached?.you).map(unit => unit.id));
  for (const id of selectedOrderUnits) {
    if (!currentUnits.has(id)) selectedOrderUnits.delete(id);
  }
  el('deck-unit-selected').textContent = selectedOrderUnits.size
    ? `Unidades seleccionadas: ${[...selectedOrderUnits].join(', ')}`
    : 'Ninguna unidad seleccionada';
  el('deck-unit-add').disabled = !options.includes('assign_synthetic_orders') ||
    !currentUnits.has(el('deck-units').value) ||
    selectedOrderUnits.has(el('deck-units').value);
  el('deck-unit-clear').disabled = selectedOrderUnits.size === 0;
  for (const [id,type] of [
    ['deck-play','play_synthetic_card'],['deck-orders','assign_synthetic_orders'],
    ['deck-undo','undo_synthetic_orders'],['deck-move','move_synthetic_unit'],['deck-movement','finish_synthetic_movement'],
    ['deck-ask-defense','ask_synthetic_defense'],['deck-stand','answer_synthetic_defense'],
    ['deck-evade','answer_synthetic_defense'],['deck-combat','finish_synthetic_combat'],
    ['deck-draw','acknowledge_synthetic_draw']
  ]) el(id).disabled = !options.includes(type) ||
    (id === 'deck-play' && select.value === '') ||
    (id === 'deck-orders' && selectedOrderUnits.size === 0);
  el('deck-status').textContent = isDeck
    ? `Mazo de prueba · fase ${cached.phase} · turno ${cached.turn} · debe actuar ${cached.actingSide}`
    : 'El mazo de prueba aún no está inicializado';
  movementBoard?.setView(cached?.status==='LAB_ONLY'?null:cached);
  renderAncients();
  updatePanels();
}

function clearMatchPresentation() {
  lobbyStatus = null;
  cached = null;
  stateText(null);
  el('lobby').textContent = 'Sin partida cargada';
  el('invite-token').textContent = '—';
  el('received').value = '';
  clearDeckFeedback();
  renderDeck();
}
function clearPrivateView() {
  signedInHandle = null;
  privateScope.reset();
  inspectionSequence++; // invalidate GETs started under an earlier session
  clearMatchPresentation();
  el('match-id').value = '';
  updatePanels();
}
function selectActiveMatch(id) {
  // Programmatic navigation (create/accept) must clear private tokens too,
  // not just edits from the match-id input event.
  if (privateScope.capture().matchId !== id) {
    closeUpdates();
    inspectionSequence++;
    clearMatchPresentation();
  }
  privateScope.selectMatch(id);
  updatePanels();
}
function closeUpdates() {
  if (updates) updates.close();
  updates = null;
  updateMatchId = null;
  revisionRefresh.reset();
  el('connection').textContent = 'Avisos en tiempo real desconectados';
}
function subscribeTo(matchId,kind='synthetic') {
  if (typeof EventSource !== 'function') return;
  const subscriptionKey=matchId+':'+kind;
  if (updates && updateMatchId === subscriptionKey) return;
  closeUpdates();
  updateMatchId = subscriptionKey;
  const stream = new EventSource(`/api/matches/${matchId}/${kind==='ancients'
    ?'ancients-lab/updates':'updates'}`);
  const ticket = privateScope.capture();
  updates = stream;
  const active = () => updates === stream && privateScope.isCurrent(ticket,matchId) &&
    el('match-id').value.trim() === matchId;
  el('connection').textContent = 'Conectando avisos de partida…';
  stream.onopen = () => {
    if (active()) el('connection').textContent = 'Avisos de partida conectados';
  };
  stream.onerror = () => {
    if (active()) el('connection').textContent = 'Reconectando avisos de partida…';
  };
  stream.addEventListener('revision', event => {
    // Ignore callbacks queued before logout or a match / identity switch.
    if (!active()) return;
    try {
      const {lobbyRevision, gameRevision} = JSON.parse(event.data);
      if (!Number.isSafeInteger(lobbyRevision) || !(gameRevision === null || Number.isSafeInteger(gameRevision))) return;
      // The event can arrive just before visibilitychange is dispatched.
      // Never launch a private GET from a hidden tab merely for a notice.
      if (document.hidden) revisionRefresh.setPaused(true);
      // A revision is acknowledged only after inspect() really succeeds.
      // Failed HTTP requests remain pending for bounded automatic retry.
      revisionRefresh.notice(`${lobbyRevision}:${gameRevision}`);
    } catch {if (active()) message('No se ha podido interpretar el aviso de revisión');}
  });
}
document.addEventListener('visibilitychange', async () => {
  if (document.hidden) {
    revisionRefresh.setPaused(true);
    return;
  }
  // Confirm the current cookie identity before resuming deferred notices.
  if (!await session() || document.hidden) return;
  // A second visibilitychange may hide the tab while the session GET awaits.
  // Never unpause based on a stale visible event.
  revisionRefresh.setPaused(false);
  // A focused waiting lobby must refresh even if the SSE revision was missed.
  if (lobbyStatus === 'INVITING' && !document.hidden) {
    try { await inspect(); } catch { /* the periodic guard will retry */ }
  }
});
window.addEventListener('beforeunload', closeUpdates);

async function api(method,path,data) {
  const res = await fetch(path, {
    method, credentials:'same-origin', cache:'no-store',
    headers: method === 'GET' ? {} : {'content-type':'application/json','x-ccw-request':'1'},
    ...(data===undefined ? {} : {body:JSON.stringify(data)})
  });
  const result = await res.json();
  if (!res.ok) throw new Error(`${res.status}: ${result.code ?? 'Error'}`);
  return result;
}
async function session() {
  const ticket=privateScope.capture();
  try {
    const data=await api('GET','/api/session');
    if (!privateScope.isCurrent(ticket)) return false;
    if (!data || typeof data.handle !== 'string' || !data.handle.trim()) {
      closeUpdates();clearPrivateView();
      el('current').textContent='Sin sesión';
      return false;
    }
    if (signedInHandle && signedInHandle !== data.handle) {
      closeUpdates();clearPrivateView();
      signedInHandle=data.handle;
      el('current').textContent=`Conectado: ${data.handle}`;
      updatePanels();
      message('Ha cambiado la identidad de la sesión. Vuelve a abrir la partida.');
      return false;
    }
    signedInHandle=data.handle;
    el('current').textContent=`Conectado: ${data.handle}`;
    updatePanels();
    return true;
  } catch (error) {
    if (!privateScope.isCurrent(ticket)) return false;
    if (/^401:/.test(error.message)) {
      closeUpdates();clearPrivateView();
      el('current').textContent='Sin sesión';
      message('La sesión ha caducado o se ha cerrado.');
    } else {
      // Treat a failed identity check as unverified: keep no old hand visible.
      closeUpdates();clearPrivateView();
      el('current').textContent='No se ha podido verificar la sesión';
      message('No se puede verificar la identidad; vuelve a identificarte.');
    }
    return false;
  }
}
async function inspect() {
  const id = el('match-id').value.trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw Error('Introduce el identificador de partida');
  selectActiveMatch(id);
  const sequence = ++inspectionSequence;
  const ticket = privateScope.capture();
  // Recheck the session before processing SSE or another private snapshot.
  // Another tab may have logged in with a different cookie while we were open.
  if (!await session() || !privateScope.isCurrent(ticket,id) ||
      sequence !== inspectionSequence || el('match-id').value.trim() !== id) return false;
  let lobby;
  try {
    lobby=await api('GET',`/api/matches/${id}`);
  } catch(initialError) {
    let error=initialError;
    if(error.message==='409: SECTION_LAB_INTERNAL_ONLY'){
      try {
        // This route exists only on explicitly opt-in loopback instances.
        lobby=await api('GET',`/api/matches/${id}/ancients-lab`);
      }catch(labError){error=labError;}
    }
    if(!lobby){
      if (!privateScope.isCurrent(ticket,id) || sequence !== inspectionSequence || el('match-id').value.trim() !== id) return false;
      if (/^(401|403|404):/.test(error.message)) {
        closeUpdates();clearPrivateView();
        if (/^401:/.test(error.message)) el('current').textContent='Sin sesión';
        message('La sesión o la partida ya no están disponibles.');
        return false;
      }
      throw error;
    }
  }
  if (!privateScope.isCurrent(ticket,id) || sequence !== inspectionSequence || el('match-id').value.trim() !== id) return false;
  if (!privateProjectionMatches(lobby,signedInHandle,id)) {
    // Refuse to render a side that does not belong to the verified account,
    // including a 200 response after an inter-tab cookie transition.
    closeUpdates();clearPrivateView();
    message('La respuesta de partida no corresponde a la sesión vigente.');
    return false;
  }
  subscribeTo(id,lobby.state?.status==='LAB_ONLY'?'ancients':'synthetic');
  el('lobby').textContent=JSON.stringify({status:lobby.status,players:lobby.players},null,2);
  lobbyStatus = lobby.status;
  cached=lobby.state??null;
  renderDeck();
  stateText(cached ? (deckSummary(cached) ?? {tuBando:cached.you,turno:cached.turn,revision:cached.revision,
    tuMano:cached.yourHand,cartasDelRival:cached.opponentCardCount,unidadesPublicas:cached.board})
    : {estado:'Esperando segundo jugador'});
  return lobby;
}
function action(id,callback) {
  const feedbackId=Object.hasOwn(deckFeedbackSlots,id) ? deckFeedbackSlots[id] : null;
  el(id).addEventListener('click',async() => {
    const ticket=privateScope.capture();
    if (feedbackId && privateScope.isCurrent(ticket)) el(feedbackId).textContent='';
    try {
      const outcome = await callback();
      if (outcome !== false && privateScope.isCurrent(ticket)) {
        message('Operación realizada');
        if (feedbackId) el(feedbackId).textContent='Operación realizada';
      }
    } catch(error) {
      if (privateScope.isCurrent(ticket)) {
        const explanation=feedbackId ? describeCommandError(error) : error.message;
        message(explanation);
        if (feedbackId) el(feedbackId).textContent=explanation;
      }
    }
  });
}
/** A cookie may have changed in another tab since the current view was drawn. */
async function confirmCurrentSession(ticket, matchId = ticket.matchId) {
  if (!privateScope.isCurrent(ticket,matchId)) return false;
  if (!await session()) return false;
  return privateScope.isCurrent(ticket,matchId) &&
    (matchId === null || el('match-id').value.trim() === matchId);
}
async function sendDeck(type, fields = {}, retryKey = null) {
  if (!cached?.matchId) throw new Error('No hay partida activa');
  const matchId = cached.matchId;
  const ticket = privateScope.capture();
  if (!privateScope.isCurrent(ticket,matchId) || el('match-id').value.trim() !== matchId)
    throw new Error('PARTIDA_DESACTUALIZADA');
  const key = retryKey ?? crypto.randomUUID().replaceAll('-','');
  const request = deckCommand(cached,type,fields,key);
  // A command cannot rely only on a cached client-side actor. Validate the
  // current cookie identity before issuing this mutation.
  if (!await session() || !privateScope.isCurrent(ticket,matchId) ||
      el('match-id').value.trim() !== matchId) return false;
  try {
    await api('POST',`/api/matches/${matchId}/commands`,request);
  } catch (error) {
    // An old failure cannot overwrite a new account's status message.
    if (!privateScope.isCurrent(ticket,matchId) || el('match-id').value.trim() !== matchId) return false;
    throw error;
  }
  if (!privateScope.isCurrent(ticket,matchId) || el('match-id').value.trim() !== matchId) return false;
  await inspect();
  return privateScope.isCurrent(ticket,matchId);
}
el('login-form').addEventListener('submit',async(event) => {
  event.preventDefault();
  // Invalidate all old GET/POST responses as soon as identity changes.
  closeUpdates(); clearPrivateView();
  const ticket = privateScope.capture();
  try {
    await api('POST','/api/session',{handle:el('handle').value,password:el('password').value});
    if (!privateScope.isCurrent(ticket)) return;
    el('password').value='';
    if (await session() && privateScope.isCurrent(ticket)) message('Sesión iniciada');
  } catch(error){if(privateScope.isCurrent(ticket)) message(error.message);}
});
action('logout',async()=>{
  closeUpdates();clearPrivateView();
  const ticket=privateScope.capture();
  await api('DELETE','/api/session');
  if(!privateScope.isCurrent(ticket))return false;
  await session();
  return privateScope.isCurrent(ticket);
});
action('create',async()=>{
  const ticket=privateScope.capture();
  if(!await confirmCurrentSession(ticket))return false;
  const result=await api('POST','/api/matches');
  if(!privateScope.isCurrent(ticket))return false;
  el('match-id').value=result.matchId;
  selectActiveMatch(result.matchId);
  const nextTicket=privateScope.capture();
  await inspect();
  return privateScope.isCurrent(nextTicket,result.matchId);
});
el('match-id').addEventListener('input', () => {
  if (el('match-id').value.trim() !== updateMatchId) {
    privateScope.reset();closeUpdates();inspectionSequence++;
    clearMatchPresentation();
  }
});
action('refresh',inspect);
action('invite',async()=>{
  const id=el('match-id').value.trim(),ticket=privateScope.capture();
  if(!privateScope.isCurrent(ticket,id))throw Error('PARTIDA_DESACTUALIZADA');
  if(!await confirmCurrentSession(ticket,id))return false;
  const data=await api('POST',`/api/matches/${id}/invitations`,{targetHandle:el('invitee').value});
  if(!privateScope.isCurrent(ticket,id) || el('match-id').value.trim()!==id)return false;
  // A cookie might change in a second tab while the token POST is pending.
  // Never display a secret response until identity has been rechecked.
  if(!await confirmCurrentSession(ticket,id))return false;
  el('invite-token').textContent=data.token;
});
action('accept',async()=>{
  const ticket=privateScope.capture();
  if(!await confirmCurrentSession(ticket))return false;
  const data=await api('POST','/api/invitations/accept',{invitationToken:el('received').value.trim()});
  if(!privateScope.isCurrent(ticket))return false;
  el('match-id').value=data.matchId;
  selectActiveMatch(data.matchId);
  const nextTicket=privateScope.capture();
  await inspect();
  return privateScope.isCurrent(nextTicket,data.matchId);
});
action('reject',async()=>{
  const ticket=privateScope.capture();
  if(!await confirmCurrentSession(ticket))return false;
  await api('POST','/api/invitations/reject',{invitationToken:el('received').value.trim()});
  return privateScope.isCurrent(ticket);
});
action('turn',async()=>{
  if(!cached?.matchId)throw Error('No hay partida activa');
  const matchId=cached.matchId,revision=cached.revision,ticket=privateScope.capture();
  if(!privateScope.isCurrent(ticket,matchId))throw Error('PARTIDA_DESACTUALIZADA');
  if(!await confirmCurrentSession(ticket,matchId))return false;
  await api('POST',`/api/matches/${matchId}/commands`,{type:'pass_demo_turn',expectedRevision:revision,
    idempotencyKey:crypto.randomUUID().replaceAll('-','')});
  if(!privateScope.isCurrent(ticket,matchId))return false;
  await inspect();
  return privateScope.isCurrent(ticket,matchId);
});
action('events',async()=>{
  const id=el('match-id').value.trim(),ticket=privateScope.capture();
  if(!privateScope.isCurrent(ticket,id))throw Error('PARTIDA_DESACTUALIZADA');
  if(!await confirmCurrentSession(ticket,id))return false;
  const events=await api('GET',`/api/matches/${id}/events`);
  if(!privateScope.isCurrent(ticket,id) || el('match-id').value.trim()!==id)return false;
  // Event contents are not accepted from a request whose cookie identity
  // may have changed while its HTTP response was in flight.
  if(!await confirmCurrentSession(ticket,id))return false;
  stateText(events);
});
action('deck-initialize',async()=>{
  if(!cached?.matchId || cached.you !== 'A' || cached.revision !== 0 || cached.phase)throw Error('INICIALIZACION_NO_DISPONIBLE');
  const id=cached.matchId,ticket=privateScope.capture();
  if(!privateScope.isCurrent(ticket,id))throw Error('PARTIDA_DESACTUALIZADA');
  if(!await confirmCurrentSession(ticket,id))return false;
  await api('POST',`/api/matches/${id}/deck/initialize`,{});
  if(!privateScope.isCurrent(ticket,id))return false;
  await inspect();
  return privateScope.isCurrent(ticket,id);
});
action('ancients-start',async()=>{
  const id=cached?.matchId,ticket=privateScope.capture();
  if(!id||cached.you!=='A'||cached.revision!==0||cached.phase)
    throw Error('INICIALIZACION_NO_DISPONIBLE');
  if(!await confirmCurrentSession(ticket,id))return false;
  await api('POST',`/api/matches/${id}/ancients-lab/initialize`,{});
  if(!privateScope.isCurrent(ticket,id))return false;
  await inspect();
  return privateScope.isCurrent(ticket,id);
});
action('ancients-refresh',inspect);
action('ancients-play',()=>sendAncients('PLAY_SECTION_CARD',{
  cardInstanceId:el('ancients-card').value
}));
action('ancients-order',()=>sendAncients('ASSIGN_SECTION_ORDERS',{
  unitIds:cached?.selectionCard?.allRequired?[...cached.selectionCard.unitIds]:Array.from(el('ancients-units').selectedOptions??[],x=>x.value),
  leaderIds:Array.from(el('ancients-leader-orders').selectedOptions??[],x=>x.value)
}));
action('ancients-select-leader',async()=>{
  if(cached?.status!=='LAB_ONLY'||cached.diceLab?.victory?.winner||cached.historyLimitReached||cached.turn!==cached.you||
     cached.phase!=='LAB_RESOLUTION_PENDING'||cached.combatLab?.movementClosed)throw Error('ACCION_NO_DISPONIBLE');
  const leader=(cached.leaders??[]).find(l=>l.id===
    el('ancients-leader-choice').value&&l.side===cached.you);
  if(!leader||!(cached.orderedLeaderIds??[]).includes(leader.id)||
     (cached.movedLeaderIds??[]).includes(leader.id))
    throw Error('LIDER_NO_DISPONIBLE');
  ancientsDraft={kind:'LEADER',unitId:leader.id,leaderId:leader.id,
    origin:{col:leader.col,row:leader.row},path:[],
    revision:cached.revision};
  renderAncients();
  return false;
});
action('ancients-clear-path',async()=>{
  ancientsDraft=null;renderAncients();return false;
});
action('ancients-move',()=>{
  if(!ancientsDraft?.path.length||ancientsDraft.revision!==cached?.revision)
    throw Error('BORRADOR_DESACTUALIZADO');
  const path=ancientsDraft.path.map(p=>({col:p.col,row:p.row}));
  if(ancientsDraft.kind==='LEADER')
    return sendAncients('MOVE_SECTION_LEADER_PATH_V1',{
      leaderId:ancientsDraft.leaderId,path
    });
  const selected=(cached?.board??[]).find(u=>u.id===ancientsDraft.unitId);
  const type=['LIGHT_CAVALRY','MEDIUM_CAVALRY','HEAVY_CAVALRY',
    'ELEPHANT','HEAVY_CHARIOT'].includes(selected?.unitType)
    ?'MOVE_SECTION_MOUNTED_PATH_V1':'MOVE_SECTION_FOOT_PATH_V2';
  return sendAncients(type,{unitId:ancientsDraft.unitId,path});
});
action('ancients-finish-movement',()=>sendAncients('FINISH_SECTION_MOVEMENT_LAB'));
action('ancients-prepare-ranged',()=>{
  const candidate=cached?.combatLab?.candidates?.[Number(el('ancients-ranged-choice').value)];
  if(!candidate)throw Error('ACCION_NO_DISPONIBLE');
  return sendAncients(candidate.kind==='CLOSE_PREVIEW'?'PREPARE_SECTION_CLOSE_LAB':'PREPARE_SECTION_RANGED_LAB',{
    attackerId:candidate.attackerId,targetId:candidate.targetId
  });
});
action('ancients-cancel-ranged',()=>sendAncients('CANCEL_SECTION_RANGED_LAB'));
action('ancients-roll-digital',()=>sendAncients('ROLL_SECTION_RANGED_DIGITAL_LAB'));
action('ancients-declare-physical',()=>{
  const n=cached?.combatLab?.plan?.diceCount;
  const faces=Array.from({length:Number.isInteger(n)&&n>=1&&n<=7?n:0},(_,i)=>el('ancients-physical-die-'+(i+1)).value);
  if(![1,2,3,4,5,6,7].includes(n)||faces.some(x=>!['LIGHT','MEDIUM','HEAVY','LEADER','FLAG','SWORDS'].includes(x)))
    throw Error('INVALID_PHYSICAL_DECLARATION');
  const plan=cached.combatLab.plan;
  if(plan.elephantAttack&&plan.swordsHit&&!plan.evadePath?.length){
    const extra=(el('ancients-elephant-rerolls').value??'').trim();
    if(extra)faces.push(...extra.toUpperCase().split(/[\s,;]+/));
  }
  return sendAncients('DECLARE_SECTION_RANGED_PHYSICAL_LAB',{faces});
});
action('ancients-elephant-red-ignore',()=>sendAncients('CHOOSE_SECTION_ELEPHANT_RED_LAB',{ignore:true}));
action('ancients-elephant-red-accept',()=>sendAncients('CHOOSE_SECTION_ELEPHANT_RED_LAB',{ignore:false}));
action('ancients-accept-physical',()=>sendAncients('REVIEW_SECTION_RANGED_PHYSICAL_LAB',{accept:true}));
action('ancients-dispute-physical',()=>sendAncients('REVIEW_SECTION_RANGED_PHYSICAL_LAB',{accept:false}));
action('ancients-roll-leader',()=>sendAncients('ROLL_SECTION_LEADER_CASUALTY_LAB'));
action('ancients-evade-rampage',()=>{
  const o=cached?.diceLab?.rampage?.evasion?.options.find(o=>JSON.stringify(o)===el('ancients-rampage-evasion').value);
  if(!o)throw Error('LEADER_EVASION_NOT_AVAILABLE');
  return sendAncients('EVADE_SECTION_RAMPAGE_LEADER_LAB',{path:o.path,exit:o.exit});
});
action('ancients-roll-rampage',()=>{
  if(!cached?.diceLab?.rampage?.canRoll)throw Error('ELEPHANT_RAMPAGE_NOT_AVAILABLE');
  return sendAncients('ROLL_SECTION_ELEPHANT_RAMPAGE_LAB',{unitId:el('ancients-rampage-choice').value});
});
action('ancients-confirm-retreat',()=>{
  const candidate=cached?.diceLab?.retreat?.options.find(o=>JSON.stringify(o.path)===el('ancients-retreat-choice').value);
  if(!cached?.diceLab?.canRetreat||!candidate)throw Error('RETREAT_NOT_AVAILABLE');
  return sendAncients('RETREAT_SECTION_UNIT_LAB',{path:candidate.path});
});
action('ancients-confirm-morale',()=>{
  const value=el('ancients-morale-choice').value;
  if(!cached?.diceLab?.canChooseMorale||value==='')throw Error('MORALE_CHOICE_NOT_AVAILABLE');
  return sendAncients('CHOOSE_SECTION_MORALE_LAB',{ignored:Number(value)});
});
action('ancients-evade-leader',()=>{
  const candidate=cached?.diceLab?.leaderEvasionOptions?.find(o=>JSON.stringify(o)===el('ancients-evasion-choice').value);
  if(!cached?.diceLab?.canEvadeLeader||!candidate)throw Error('LEADER_EVASION_NOT_AVAILABLE');
  return sendAncients('EVADE_SECTION_LEADER_LAB',{path:candidate.path,exit:candidate.exit});
});
action('ancients-finalize-ranged',()=>sendAncients('FINALIZE_SECTION_RANGED_LAB'));
action('ancients-archive-ranged',()=>sendAncients('ARCHIVE_SECTION_RANGED_LAB'));
action('ancients-confirm-unit-evade',()=>{
  if(!cached?.diceLab?.canChooseUnitEvade)throw Error('UNIT_EVADE_NOT_AVAILABLE');
  const value=el('ancients-unit-evade-choice').value;
  const path=[[],...(cached.combatLab?.plan?.evadeOptions??[])].find(p=>JSON.stringify(p)===value);
  if(!path)throw Error('INVALID_UNIT_EVADE_PATH');
  return sendAncients('CHOOSE_SECTION_UNIT_EVADE_LAB',{path});
});
action('ancients-accept-battle-back',()=>sendAncients('ACCEPT_SECTION_BATTLE_BACK_LAB'));
action('ancients-decline-battle-back',()=>sendAncients('DECLINE_SECTION_BATTLE_BACK_LAB'));
action('ancients-confirm-momentum',()=>{
  if(!cached?.diceLab?.canChooseMomentum)throw Error('MOMENTUM_NOT_AVAILABLE');
  const path=[[],...(cached.diceLab.momentumOptions??[]).map(o=>o.path)].find(p=>JSON.stringify(p)===el('ancients-momentum-choice').value);
  if(!path)throw Error('INVALID_MOMENTUM_PATH');
  return sendAncients('CHOOSE_SECTION_MOMENTUM_LAB',{path});
});
action('ancients-decline-bonus-close',()=>sendAncients('DECLINE_SECTION_BONUS_CLOSE_LAB'));
action('ancients-end',()=>sendAncients('END_EXPERIMENTAL_TURN'));
action('deck-play',()=>sendDeck('play_synthetic_card',{cardRef:el('deck-card').value}));
el('deck-units').addEventListener('change',()=>{
  const id=el('deck-units').value;
  const available=Array.isArray(cached?.board) &&
    cached.board.some(unit=>unit?.id===id && unit.side===cached.you);
  el('deck-unit-add').disabled =
    !deckActions(cached).includes('assign_synthetic_orders') ||
    !available || selectedOrderUnits.has(id);
});
action('deck-unit-add',async()=>{
  const id=el('deck-units').value;
  if (!deckActions(cached).includes('assign_synthetic_orders') ||
      !cached?.board?.some(unit=>unit?.id===id && unit.side===cached.you))
    throw Error('UNIDAD_NO_DISPONIBLE');
  selectedOrderUnits.add(id);
  renderDeck();
  return false; // local selection only, no server command was applied
});
action('deck-unit-clear',async()=>{
  selectedOrderUnits.clear();
  renderDeck();
  return false;
});
action('deck-orders',()=>sendDeck('assign_synthetic_orders',{
  unitIds: [...selectedOrderUnits]
}));
action('deck-undo',()=>sendDeck('undo_synthetic_orders'));
action('deck-move',()=>sendDeck('move_synthetic_unit',{
  unitId: el('deck-move-unit').value,
  path: parseSyntheticMovementPath(el('deck-move-path').value)
}));
action('deck-movement',()=>sendDeck('finish_synthetic_movement'));
action('deck-ask-defense',()=>sendDeck('ask_synthetic_defense',{targetUnit:el('deck-target').value}));
action('deck-stand',()=>sendDeck('answer_synthetic_defense',{choice:'STAND'}));
action('deck-evade',()=>sendDeck('answer_synthetic_defense',{choice:'EVADE'}));
action('deck-combat',()=>sendDeck('finish_synthetic_combat'));
action('deck-draw',()=>sendDeck('acknowledge_synthetic_draw'));
movementBoard = createMovementBoard({
  svg: el('movement-board'),
  status: el('movement-status'),
  undoButton: el('board-undo'),
  cancelButton: el('board-cancel'),
  confirmButton: el('board-confirm'),
  attackButton: el('board-ask-defense'),
  onRequestDefense: async (unitId,idempotencyKey) => {
    const confirmed=await sendDeck('ask_synthetic_defense',
      {targetUnit:unitId},idempotencyKey);
    if (confirmed) message('Solicitud de defensa sintética registrada');
    return confirmed;
  },
  onConfirm: async (fields, idempotencyKey) => {
    const confirmed=await sendDeck('move_synthetic_unit', fields, idempotencyKey);
    if (confirmed) message('Movimiento sintético confirmado por el servidor');
    return confirmed;
  },
  onError: error => message(describeCommandError(error))
});
renderDeck();
await session();
