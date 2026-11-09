/** One immutable authored exception, scoped only to Wake the Reserve. */
export const MINOR_RESERVE_RULESET_ID='frontier-campaign-wake-reserve';
export const MINOR_RESERVE=Object.freeze({policy:'original-post-reserve-v1',post:Object.freeze({type:'watchtower',x:2230,lane:0,side:1}),originalId:13,warningTicks:120,timeLimit:600,types:Object.freeze(['warrior','warrior','warrior','warrior','archer','archer']),arrivalX:3050,arrivalLane:0});
export const supportsMinorReserve=rules=>rules?.id===MINOR_RESERVE_RULESET_ID&&rules.revision===1&&rules.minorReserve?.policy===MINOR_RESERVE.policy;
export const createMinorReserve=()=>({postId:null,triggerTick:null,releases:[]});
export function bindMinorReserve(game){
 if(!supportsMinorReserve(game.ruleset))return;
 if(game.tick!==0||game.state.time!==0||game.state.minorReserve.postId!==null)throw Error('Reserve binding requires the fresh authored opening.');
 const p=MINOR_RESERVE.post,post=game.state.buildings.find(b=>b.side===p.side&&b.type===p.type&&b.x===p.x&&b.y===game.map.lanes[p.lane]);
 if(!post||post.id!==MINOR_RESERVE.originalId)throw Error('Wake the Reserve original post does not match its authored identity.');
 game.state.minorReserve.postId=post.id;
}
export const minorReserveEnded=game=>supportsMinorReserve(game?.ruleset)&&(game.tick>=MINOR_RESERVE.timeLimit*20||game.state.winner!==null||game.state.bases.some(b=>b.hp<=0));
export const minorReserveUnbound=game=>supportsMinorReserve(game?.ruleset)&&game.state.minorReserve.postId===null;
export function minorReserveStatus(game){
 if(!supportsMinorReserve(game?.ruleset))return null;
 const r=game.state.minorReserve;
 if(r.triggerTick===null)return {phase:'armed',remaining:6,warningSeconds:0,postId:r.postId};
 const due=r.triggerTick+MINOR_RESERVE.warningTicks;
 return {phase:r.releases.length===6?'complete':game.tick<due?'warning':'arriving',remaining:6-r.releases.length,warningSeconds:Math.max(0,(due-game.tick)/20),postId:r.postId};
}
export function advanceMinorReserve(game){
 if(!supportsMinorReserve(game.ruleset)||minorReserveEnded(game)||minorReserveUnbound(game))return;
 const r=game.state.minorReserve;
 if(r.triggerTick===null){if(!game.state.buildings.some(b=>b.id===r.postId&&b.hp>0))r.triggerTick=game.tick;return;}
 if(game.tick<r.triggerTick+MINOR_RESERVE.warningTicks)return;
 while(r.releases.length<6){
  const type=MINOR_RESERVE.types[r.releases.length],id=game.nextId;
  game._spawn({type:type==='warrior'?'barracks':'archery',side:1,x:MINOR_RESERVE.arrivalX+48,lane:0,level:1});
  if(game.nextId===id)break;
  r.releases.push({unitId:id,tick:game.tick});
 }
}
export function validateMinorReserve(r,{map,tick,nextId,state},fail){
 const fields=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v)))fail('invalid reserve object');const ds=Object.getOwnPropertyDescriptors(v),ks=Reflect.ownKeys(ds);if(ks.length!==keys.length||ks.some(k=>typeof k!=='string'||!keys.includes(k)||!Object.hasOwn(ds[k],'value')||!ds[k].enumerable))fail('unknown or unsafe reserve field');};
 fields(r,['postId','triggerTick','releases']);
 if(map.id!=='classic'||map.revision!==1||tick>12000||Math.abs(state.time-tick*.05)>Math.min(.001,1e-7+state.time*1e-9))fail('invalid reserve battlefield/clock');
 if(r.postId!==MINOR_RESERVE.originalId||r.postId>=nextId||state.units.some(u=>u.id===r.postId))fail('wrong or reused original reserve post');
 if(!Array.isArray(r.releases)||Object.getPrototypeOf(r.releases)!==Array.prototype||r.releases.length>6)fail('invalid reserve release list');
 const ds=Object.getOwnPropertyDescriptors(r.releases),ks=Reflect.ownKeys(ds).filter(k=>k!=='length');if(ks.length!==r.releases.length||ks.some((k,i)=>k!==String(i)||!Object.hasOwn(ds[k],'value')||!ds[k].enumerable))fail('invalid reserve release list');
 const p=MINOR_RESERVE.post,live=state.buildings.find(b=>b.id===r.postId&&b.hp>0),ended=tick>=12000||state.winner!==null||state.bases.some(b=>b.hp<=0);
 if(live&&(live.type!==p.type||live.side!==1||live.x!==p.x||live.y!==map.lanes[p.lane]||live.lane!==p.lane))fail('original reserve post identity changed');
 if(r.triggerTick===null){if(r.releases.length||(!live&&!ended))fail('untriggered reserve lost its original post');}
 else if(!Number.isSafeInteger(r.triggerTick)||r.triggerTick<1||r.triggerTick>tick||r.triggerTick>=12000||live)fail('invalid reserve trigger');
 let priorId=r.postId,priorTick=-1;
 for(const [index,release] of r.releases.entries()){
  fields(release,['unitId','tick']);
  if(!Number.isSafeInteger(release.unitId)||release.unitId<=priorId||release.unitId>=nextId||!Number.isSafeInteger(release.tick)||release.tick<r.triggerTick+120||release.tick>tick||release.tick>=12000||release.tick<priorTick)fail('invalid reserve arrival order');
  priorId=release.unitId;priorTick=release.tick;const unit=state.units.find(u=>u.id===release.unitId);
  if(state.buildings.some(b=>b.id===release.unitId)||(unit&&(unit.type!==MINOR_RESERVE.types[index]||unit.side!==1||unit.level!==1||unit.lane!==0)))fail('reserve arrival provenance changed');
 }
 // A between-tick paid Volley leaves dead records until ordinary fixed-tick cleanup.
 if(r.triggerTick!==null&&tick>=r.triggerTick+120&&r.releases.length<6&&!ended&&state.units.filter(u=>u.side===1).length<70)fail('uncapped due reserve queue was not drained');
}
