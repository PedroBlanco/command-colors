/**
 * LAB_ONLY subset of base Ancients Leader Evade (ordinary terrain).
 * Source: https://www.commandsandcolors.net/ancients/the-game/main/13-special-actions.html
 * Uses the demo's canonical odd-q board: A home row 8, B home row 0.
 * The vertical coordinate of a hex centre is proportional to 2*row+(col&1).
 * Each step must advance strictly towards the defender's own baseline.
 * Enemy-occupied routes require Leader Escape, a separate not-yet-supported
 * combat procedure. They are excluded, not interpreted as automatic losses.
 */
import {neighbors,BOARD_ROWS,inBounds} from '../hex-grid/hex.mjs';

const key=p=>p.col+','+p.row;
const depth=p=>2*p.row+(p.col&1);
const cell=p=>({col:p.col,row:p.row});
const samePath=(a,b)=>a.length===b.length&&a.every((p,i)=>p.col===b[i].col&&p.row===b[i].row);
const validCell=p=>p&&typeof p==='object'&&!Array.isArray(p)&&
  Object.keys(p).length===2&&Object.hasOwn(p,'col')&&Object.hasOwn(p,'row')&&inBounds(p);

export function listSectionLeaderEvades(state){
  const d=state.diceLab,check=d?.leaderCheck,plan=state.combatLab?.plan;
  if(d?.version!==3||!check?.outcome.leaderMustEvadeIfApplied||!plan||
     !d.pending?.loss.unitWouldBeEliminated||
     !['SERVER_GENERATED','ACCEPTED'].includes(d.pending.review))return [];
  const leader=state.board.leaders.find(l=>l.id===check.leaderId);
  const target=state.board.units.find(u=>u.id===plan.targetId);
  if(!leader||!target||leader.side!==target.side||key(leader)!==key(target))return [];
  const rear=leader.side==='A'?BOARD_ROWS-1:0,sign=leader.side==='A'?1:-1;
  const occupied=new Map(state.board.units.filter(u=>u.id!==target.id).map(u=>[key(u),u]));
  const leaders=new Map(state.board.leaders.filter(l=>l.id!==leader.id).map(l=>[key(l),l]));
  const terrain=new Map((state.footLab.terrain??[]).map(t=>[key(t),t.kind]));
  const out=[];
  function visit(at,path){
    const u=occupied.get(key(at)),l=leaders.get(key(at));
    // An attached leader cannot share a destination with another leader.
    if(path.length>0&&!l)out.push({path,exit:false,joinedUnitId:u?.id??null});
    // Exiting the friendly baseline consumes one of the 1-3 steps. There
    // is no banner for a voluntary exit, and the leader cannot return.
    if(at.row===rear&&path.length<3)out.push({path,exit:true,joinedUnitId:null});
    if(path.length===3)return;
    for(const p of neighbors(at)){
      if(sign*(depth(p)-depth(at))<=0)continue;
      const other=occupied.get(key(p)),otherLeader=leaders.get(key(p));
      if(other&&other.side!==leader.side||otherLeader&&otherLeader.side!==leader.side)continue;
      // Only the three known passable demo terrains are supported.
      if(terrain.has(key(p))&&!['FOREST','HILL','BROKEN_GROUND'].includes(terrain.get(key(p))))continue;
      visit(p,[...path,cell(p)]);
    }
  }
  visit(cell(leader),[]);
  return out;
}

export function selectSectionLeaderEvade(state,path,exit){
  if(!Array.isArray(path)||path.length>3||!path.every(validCell)||typeof exit!=='boolean')return null;
  return listSectionLeaderEvades(state).find(c=>c.exit===exit&&samePath(c.path,path))??null;
}
