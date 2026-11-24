/**
 * Only fixed, public-facing error categories can appear beside a game control.
 * HTTP JSON bodies and arbitrary thrown messages are never interpolated.
 * In particular, unknown 403/404 errors do not confirm an opponent's secrets.
 */
const explanations=Object.freeze({
  ACCION_NO_DISPONIBLE:'Esta acción no está disponible en la fase actual.',
  CARTA_NO_PROPIA:'Esa carta no está disponible en tu mano.',
  CLAVE_INVALIDA:'No se ha podido preparar la solicitud. Inténtalo de nuevo.',
  ORDENES_INVALIDAS:'Revisa las unidades seleccionadas para recibir órdenes.',
  UNIDAD_NO_DISPONIBLE:'La unidad elegida no está disponible para esta orden.',
  UNIDAD_NO_PROPIA:'Solo puedes ordenar o mover tus propias unidades.',
  UNIDAD_YA_MOVIDA:'Esta unidad ya se ha movido en el turno.',
  RUTA_INVALIDA:'La ruta indicada no es válida. Revisa sus hexágonos.',
  OBJETIVO_INVALIDO:'Selecciona un objetivo válido para esta acción.',
  RESPUESTA_INVALIDA:'Selecciona una respuesta defensiva válida.',
  PARTIDA_DESACTUALIZADA:'La partida ha cambiado. Vuelve a consultarla.',
  INICIALIZACION_NO_DISPONIBLE:'El mazo no puede iniciarse en este momento.',
  STALE_REVISION:'La partida ha cambiado. Actualiza su estado antes de repetir la acción.',
  NOT_YOUR_TURN:'No te corresponde actuar en este turno.',
  NOT_AVAILABLE:'La acción no está disponible en este momento.',
  UNSUPPORTED_COMMAND:'El servidor no admite esta acción.',
  IDEMPOTENCY_KEY_REUSED:'La solicitud ya se utilizó para una acción diferente.',
  UNDO_NOT_AVAILABLE_AFTER_MOVEMENT:'No se pueden deshacer órdenes después de empezar a mover.',
  INVALID_PHASE:'No puedes realizar esa acción en la fase actual.',
  HEX_OCUPADO:'El hexágono de destino está ocupado.',
  HEX_REPETIDO:'Ese hexágono ya forma parte del recorrido.',
  HEX_INVALIDO:'El hexágono elegido no es válido.',
  RUTA_INACCESIBLE:'No hay un recorrido libre hasta el hexágono elegido.',
  RUTA_DEMASIADO_LARGA:'La ruta supera el límite de pasos del laboratorio.',
  BORRADOR_DESACTUALIZADO:'La partida ha cambiado. Vuelve a seleccionar la unidad.',
  SELECCIONA_UNIDAD_PROPIA:'Selecciona primero una unidad propia.',
  OBJETIVO_RIVAL_REQUERIDO:'Selecciona una unidad rival antes de solicitar defensa.',
  MOVIMIENTO_NO_DISPONIBLE:'No puedes mover una unidad en esta fase.',
  MOVEMENT_PHASE_CLOSED:'El movimiento ya está cerrado para este turno.',
  COMBAT_PHASE_NOT_AVAILABLE:'Cierra el movimiento antes de preparar el combate.',
  COMBAT_PLAN_PENDING:'Descarta la preparación actual antes de continuar.',
  NO_COMBAT_PLAN_PENDING:'No hay una preparación pendiente.',
  INVALID_RANGED_TARGET:'Selecciona una unidad propia y un objetivo enemigo válido.',
  UNIT_NOT_ELIGIBLE:'La unidad no ha recibido una orden para este turno.',
  BATTLE_AFTER_MOVEMENT_UNAVAILABLE:'Esta unidad no puede combatir después de ese movimiento.',
  NO_BASE_RANGED_WEAPON:'La unidad no dispone de un arma a distancia en este laboratorio.',
  TARGET_OUT_OF_RANGE:'El objetivo está fuera del alcance de la unidad.',
  RANGED_TARGET_ADJACENT:'El objetivo es adyacente: requiere combate cuerpo a cuerpo.',
  ADJACENT_ENEMY_PREVENTS_RANGED:'Una unidad enemiga adyacente impide el ataque a distancia.',
  LINE_OF_SIGHT_BLOCKED:'La línea de visión está bloqueada.',
  INVALID_PHYSICAL_DECLARATION:'Introduce exactamente los símbolos correspondientes al número de dados.',
  INVALID_PHYSICAL_REVIEW:'La revisión de la tirada física no es válida.',
  PHYSICAL_REVIEW_NOT_AVAILABLE:'Solo el adversario puede revisar la tirada física pendiente.',
  PHYSICAL_REVIEW_REQUIRED:'Es necesaria la conformidad del adversario con la tirada física.',
  PHYSICAL_ROLL_DISPUTED:'El adversario no está de acuerdo con los resultados declarados.',
  RANGED_ROLL_ALREADY_CAPTURED:'La tirada ya está registrada y no se puede repetir ni cancelar.',
  RANGED_ROLL_REQUIRED:'Registra una tirada antes de intentar aplicar los resultados.',
  UNIT_ALREADY_BATTLED:'Esta unidad ya ha efectuado su ataque durante el turno.',
  RETREAT_PENDING:'El resultado requiere resolver una retirada; todavía no está implementada.',
  LEADER_CHECK_PENDING:'Comprueba la baja del líder antes de aplicar el resultado.',
  LEADER_CHECK_REQUIRED:'La comprobación del líder debe realizarse antes de continuar.',
  LEADER_CHECK_NOT_AVAILABLE:'No hay una comprobación de líder disponible.',
  LEADER_CHECK_ALREADY_CAPTURED:'La tirada de comprobación del líder ya se ha registrado.',
  LEADER_EVASION_PENDING:'El líder ha sobrevivido a la eliminación de su unidad; falta resolver su evasión.',
  ELIMINATION_PENDING:'La eliminación y sus consecuencias todavía no se resuelven en este laboratorio.',
  DIRECT_HIT_FINALIZATION_REQUIRED:'El resultado se puede aplicar directamente; no procede archivarlo sin efectos.'
});
const generic='No se pudo completar la acción. Comprueba el estado de la partida y vuelve a intentarlo.';
export function describeCommandError(error) {
  const raw=typeof error==='string'?error:error?.message;
  if(typeof raw!=='string'||raw.length>120)return generic;
  // Parsing a status/code does not imply this code or the response is trusted.
  const http=/^([45][0-9]{2}): ([A-Z][A-Z0-9_]{0,79})$/.exec(raw);
  if(http) {
    const status=Number(http[1]);
    if(status===401)return 'La sesión ha caducado. Identifícate de nuevo.';
    if(status===403)return 'No tienes permiso para realizar esta acción.';
    if(status===404)return 'La partida o la acción ya no están disponibles.';
    if(status===429)return 'Demasiadas solicitudes. Inténtalo más tarde.';
    if(status>=500)return 'El servidor no está disponible. Inténtalo más tarde.';
    return Object.hasOwn(explanations,http[2])?explanations[http[2]]:
      'El servidor ha rechazado la acción. Consulta el estado de la partida.';
  }
  return Object.hasOwn(explanations,raw)?explanations[raw]:generic;
}
