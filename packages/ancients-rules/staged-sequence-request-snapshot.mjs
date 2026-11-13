/**
 * LAB-ANC: stable DATA snapshot of an untrusted internal sequence request.
 * This function DOES NOT authenticate or authorize anything.
 * It never uses property gets after checking shape (Proxy get traps, mutable
 * arrays, accessors and extra fields cannot alter the normalized intent).
 */
import {inBounds} from '../hex-grid/hex.mjs';

const ID=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const ROOT=Object.freeze(['sessionToken','expectedRevision','actions']);
const DRAFT_ROOT=Object.freeze(['sessionToken','expectedRevision',
  'expectedDraftRevision','idempotencyKey','actions']);
const DRAFT_KEY=/^[A-Za-z0-9_-]{8,80}$/;
const ACTION=Object.freeze(['kind','id','path']);
const COORD=Object.freeze(['col','row']);

function record(source,fields){
  if(source===null||typeof source!=='object'||Array.isArray(source)||
     Object.getPrototypeOf(source)!==Object.prototype)return null;
  const keys=Reflect.ownKeys(source);
  if(keys.length!==fields.length||!fields.every(k=>keys.includes(k)))
    return null;
  const out=Object.create(null);
  for(const key of fields){
    const d=Object.getOwnPropertyDescriptor(source,key);
    if(!d||!Object.hasOwn(d,'value')||!d.enumerable)return null;
    out[key]=d.value;
  }
  return out;
}

function dense(source,min,max,normalize){
  if(!Array.isArray(source)||Object.getPrototypeOf(source)!==Array.prototype)
    return null;
  const count=Object.getOwnPropertyDescriptor(source,'length')?.value;
  if(!Number.isSafeInteger(count)||count<min||count>max||
     Reflect.ownKeys(source).length!==count+1)return null;
  const items=[];
  for(let i=0;i<count;i++){
    const entry=Object.getOwnPropertyDescriptor(source,String(i));
    if(!entry||!Object.hasOwn(entry,'value')||!entry.enumerable)
      return null;
    const normalized=normalize(entry.value);
    if(normalized===null)return null;
    items.push(normalized);
  }
  return Object.freeze(items);
}

function coordinate(value){
  const c=record(value,COORD);
  if(!c||!Number.isSafeInteger(c.col)||!Number.isSafeInteger(c.row)||
     !inBounds({col:c.col,row:c.row}))return null;
  return Object.freeze({col:c.col,row:c.row});
}
function action(value){
  const a=record(value,ACTION);
  if(!a||!['UNIT','LEADER'].includes(a.kind)||typeof a.id!=='string'||
     !ID.test(a.id)||a.id==='__proto__')return null;
  const path=dense(a.path,1,32,coordinate);
  return path===null?null:Object.freeze({kind:a.kind,id:a.id,path});
}

/**
 * Returns a frozen validated request for PRIVATE read-only server use.
 * Caller MUST keep sessionToken internal; it is never included in projections.
 * On any malformed/hostile input returns null and never a partial request.
 */
export function snapshotStagedSequenceRequest(request){
  try{
    const r=record(request,ROOT);
    if(!r||typeof r.sessionToken!=='string'||
       !Number.isSafeInteger(r.expectedRevision)||r.expectedRevision<0)
      return null;
    const actions=dense(r.actions,1,117,action);
    if(actions===null)return null;
    return Object.freeze({
      sessionToken:r.sessionToken,expectedRevision:r.expectedRevision,actions
    });
  }catch{
    return null;
  }
}

/**
 * Immutable PRIVATE DRAFT WRITE input. The caller authenticates the captured
 * token and validates the replay under BEGIN IMMEDIATE before saving.
 * This only snapshots untrusted data: never a commit or rule authorization.
 */
export function snapshotStagedMovementDraftRequest(request){
  try {
    const r=record(request,DRAFT_ROOT);
    if(!r||typeof r.sessionToken!=='string'||
       !Number.isSafeInteger(r.expectedRevision)||r.expectedRevision<0||
       !Number.isSafeInteger(r.expectedDraftRevision)||r.expectedDraftRevision<0||
       typeof r.idempotencyKey!=='string'||!DRAFT_KEY.test(r.idempotencyKey))
      return null;
    const actions=dense(r.actions,1,117,action);
    if(actions===null)return null;
    return Object.freeze({
      sessionToken:r.sessionToken,expectedRevision:r.expectedRevision,
      expectedDraftRevision:r.expectedDraftRevision,
      idempotencyKey:r.idempotencyKey,actions
    });
  }catch{
    return null;
  }
}
