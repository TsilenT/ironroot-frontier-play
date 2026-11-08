/** Experimental, deterministic known-terrain observation. No DOM, RNG or profile access. */
import { RULESETS, FOG, FOG_RULESET_ID, FOG_SKIRMISH_RULESET_ID, LANTERNS_RULESET_ID } from './rulesets.js';
export { FOG, FOG_RULESET_ID, FOG_SKIRMISH_RULESET_ID, LANTERNS_RULESET_ID } from './rulesets.js';
export const supportsFog=ruleset=>!!ruleset&&(ruleset.id===FOG_RULESET_ID||ruleset.id===FOG_SKIRMISH_RULESET_ID||ruleset.id===LANTERNS_RULESET_ID)&&RULESETS[ruleset.id]===ruleset&&ruleset.revision===1&&ruleset.fog?.policy===FOG.policy;
const clone=value=>JSON.parse(JSON.stringify(value));
const sideOK=side=>side===0||side===1;
const eventViews=new WeakMap();
export const createFog=()=>({version:1,sides:[0,1].map(()=>({structures:[],citadel:null}))});
export function sightSnapshot(game){
  return [0,1].map(side=>[...game.state.bases,...game.state.buildings,...game.state.units]
    .filter(e=>e.side===side&&e.hp>0).map(e=>({x:e.x,y:e.y,radius:e.type==='base'?FOG.baseRadius:game.units[e.type]?.flying?FOG.flyerRadius:FOG.ordinaryRadius})));
}
export const pointInSight=(observers,x,y)=>Number.isFinite(x)&&Number.isFinite(y)&&observers.some(o=>(x-o.x)**2+(y-o.y)**2<=o.radius**2);
export function isPointVisible(game,side,x,y){
  if(!sideOK(side)||!Number.isFinite(x)||!Number.isFinite(y)||x<0||x>game.map.width||y<0||y>game.map.height)return false;
  return !supportsFog(game.ruleset)||pointInSight(sightSnapshot(game)[side],x,y);
}
function audienceFrom(game,entities,x,y,seen){
  for(const e of entities){
    if(!(e.hp>0)||(e.side!==0&&e.side!==1)||(seen&(1<<e.side)))continue;
    const radius=e.type==='base'?FOG.baseRadius:game.units[e.type]?.flying?FOG.flyerRadius:FOG.ordinaryRadius;
    if((x-e.x)**2+(y-e.y)**2<=radius**2){seen|=1<<e.side;if(seen===3)break;}
  }
  return seen;
}
/** Fresh birth-time sight, without allocating observer snapshots or caching across mutations. */
export function eventAudience(game,x,y){
  if(!Number.isFinite(x)||!Number.isFinite(y))return 0;
  let seen=audienceFrom(game,game.state.bases,x,y,0);
  if(seen!==3)seen=audienceFrom(game,game.state.buildings,x,y,seen);
  return seen===3?seen:audienceFrom(game,game.state.units,x,y,seen);
}
/** Two independent observation budgets, union bounded by 256. Hidden traffic cannot evict seen traffic. */
export function appendFogEffect(game,e){
  if(!e.fogSeen)return;
  const effects=game.state.effects;
  for(const side of [0,1])if(e.fogSeen&(1<<side)){
    const bit=1<<side;let count=effects.filter(old=>old.fogSeen&bit).length;
    for(const old of effects){if(count<FOG.maxEffectsPerSide)break;if(old.fogSeen&bit){old.fogSeen&=~bit;count--;}}
  }
  game.state.effects=effects.filter(old=>old.fogSeen);game.state.effects.push(e);
}
const memoryOf=(b,time)=>({id:b.id,type:b.type,side:b.side,x:b.x,y:b.y,lane:b.lane,level:b.level,observedAt:time});
/** Update both sides from the same snapshot. Hidden live objects are never consulted to delete memories. */
export function refreshFog(game){
  if(!supportsFog(game.ruleset))return null;
  const s=game.state,sight=sightSnapshot(game);
  for(const side of [0,1]){
    const record=s.fog.sides[side],visible=s.buildings.filter(b=>b.side!==side&&b.hp>0&&pointInSight(sight[side],b.x,b.y));
    const seen=new Set(visible.map(b=>b.id));
    const memories=record.structures.filter(m=>!seen.has(m.id)&&!pointInSight(sight[side],m.x,m.y));
    memories.push(...visible.map(b=>memoryOf(b,s.time)));
    // Evict oldest observations first; ID tie-break makes bounded rebuild history deterministic.
    memories.sort((a,b)=>b.observedAt-a.observedAt||b.id-a.id);
    record.structures=memories.slice(0,FOG.maxMemories).sort((a,b)=>a.id-b.id);
    const base=s.bases[1-side];
    if(base.hp>0&&pointInSight(sight[side],base.x,base.y))record.citadel={choice:s.citadelOptions.sides[1-side].choice,observedAt:s.time};
  }
  return sight;
}
export function decisionSnapshot(game){
  if(!supportsFog(game.ruleset))return null;
  const sight=sightSnapshot(game);
  return sight.map((observers,side)=>new Set([...game.state.units,...game.state.buildings,...game.state.bases]
    .filter(e=>e.hp>0&&(e.side===side||pointInSight(observers,e.x,e.y))).map(e=>e.id)));
}
function publicEntity(e,own){
  if(own)return clone(e);
  const keys=['id','type','side','x','y','lane','hp','maxHp','level','flying'];
  return {...Object.fromEntries(keys.filter(k=>Object.hasOwn(e,k)).map(k=>[k,e[k]])),cooldown:0,progress:0,attack:0,hit:0};
}
function eventId(game,side,event){
  let views=eventViews.get(game);if(!views){views={maps:[new WeakMap(),new WeakMap()],next:[1,1]};eventViews.set(game,views);}
  if(!views.maps[side].has(event))views.maps[side].set(event,`fog-${side}-${views.next[side]++}`);
  return views.maps[side].get(event);
}
export function observerFront(game,side=0){
  const forward=values=>side===0?Math.max(...values):Math.min(...values);
  const ground=game.state.units.filter(u=>u.side===side&&u.hp>0&&!game.units[u.type]?.flying);
  const producers=game.state.buildings.filter(b=>b.side===side&&b.hp>0&&game.buildings[b.type]?.unit);
  return forward((ground.length?ground:producers.length?producers:[game.state.bases[side]]).map(e=>e.x));
}
/** Detached, sanitized contact data shared by AI and UI. No action methods or raw-state references. */
export function observe(game,side=0){
  return observation(game,side);
}
/** Presentation only: the caller supplies a trusted campaign objective result.
 * Ordinary observe() and AI remain fogged until an actual engine victory. */
export function observeObjectiveResult(game,side=0,outcome=null){
  const terminal=!!outcome&&typeof outcome==='object'&&!Array.isArray(outcome)&&typeof outcome.completed==='boolean'&&typeof outcome.failed==='boolean'&&outcome.completed!==outcome.failed;
  return observation(game,side,terminal);
}
function observation(game,side,revealObjective=false){
  if(!sideOK(side))throw new Error('Invalid observation side');
  const s=game.state,enabled=supportsFog(game.ruleset),revealed=s.winner!==null||revealObjective;
  if(!enabled||revealed){const state=clone(s);for(const key of ['effects','projectiles'])state[key]=s[key].map(e=>{const {fogSeen,...publicEvent}=e;return {...publicEvent,eventId:eventId(game,side,e)};});delete state.fog;return {map:game.map,ruleset:game.ruleset,units:game.units,buildings:game.buildings,state,fog:{enabled:false,revealed,side,observers:[],memories:[],knownBases:s.bases.map(b=>({id:b.id,type:b.type,side:b.side,x:b.x,y:b.y,visible:true})),frontX:enabled?observerFront(game,side):s.frontline}};}
  const observers=sightSnapshot(game)[side],visible=e=>e.side===side||pointInSight(observers,e.x,e.y);
  const bases=s.bases.map(b=>visible(b)?publicEntity(b,b.side===side):{id:b.id,type:b.type,side:b.side,x:b.x,y:b.y,hp:null,maxHp:null});
  const buildings=s.buildings.filter(b=>b.hp>0&&visible(b)).map(b=>publicEntity(b,b.side===side));
  const units=s.units.filter(u=>u.hp>0&&visible(u)).map(u=>publicEntity(u,u.side===side));
  const currentIds=new Set(units.map(u=>u.id));
  for(const u of units)if(Object.hasOwn(u,'airTargetId')&&!currentIds.has(u.airTargetId))u.airTargetId=null;
  const ownPair=pair=>pair.map((n,i)=>i===side?n:null),frontX=observerFront(game,side);
  const effects=s.effects.filter(e=>(e.fogSeen&(1<<side))&&pointInSight(observers,e.x,e.y)).map(e=>{const {fogSeen,...publicEvent}=e;return {...publicEvent,eventId:eventId(game,side,e)};});
  const citadel=s.citadelOptions.sides.map((r,i)=>i===side?clone(r):visible(s.bases[i])?{choice:r.choice}:{choice:null});
  const state={time:s.time,gold:ownPair(s.gold),income:ownPair(s.income),bases,buildings,units,projectiles:[],effects,frontline:frontX,winner:s.winner,spellCooldown:ownPair(s.spellCooldown),overtime:s.overtime,stats:Object.fromEntries(Object.entries(s.stats).map(([k,v])=>[k,ownPair(v)])),citadelOptions:{sides:citadel}};
  const seen=new Set(buildings.map(b=>b.id));
  const memories=s.fog.sides[side].structures.filter(m=>!seen.has(m.id)&&!pointInSight(observers,m.x,m.y)).map(clone);
  return {map:game.map,ruleset:game.ruleset,units:game.units,buildings:game.buildings,state,fog:{enabled:true,revealed:false,side,observers,memories,knownBases:s.bases.map(b=>({id:b.id,type:b.type,side:b.side,x:b.x,y:b.y,visible:visible(b)})),rememberedCitadel:clone(s.fog.sides[side].citadel),frontX}};
}
/** Shape/bounds are exact; stale records need not match hidden live state. */
export function validateFog(fog,{map,ruleset,state,nextId},fail){
  const shape=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
  const number=(n,min,max,integer=false)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max&&(!integer||Number.isSafeInteger(n));
  if(!supportsFog(ruleset)||map.id!=='classic'||map.revision!==1||ruleset.endgame.forcedDecay||ruleset.economy.policy!=='legacy'||(ruleset.campaignOnly&&ruleset.id!==LANTERNS_RULESET_ID)||ruleset.authoredOnly)fail('fog supports only Classic open-ended without bridge income');
  if(!Array.isArray(state.effects)||state.effects.some(e=>!Number.isInteger(e.fogSeen)||e.fogSeen<1||e.fogSeen>3)||[0,1].some(side=>state.effects.filter(e=>e.fogSeen&(1<<side)).length>FOG.maxEffectsPerSide))fail('invalid fog effect budget');
  if(!Array.isArray(state.projectiles)||state.projectiles.length)fail('fog prototype does not retain projectiles');
  if(!shape(fog,['version','sides'])||fog.version!==1||!Array.isArray(fog.sides)||fog.sides.length!==2)fail('invalid fog state');
  for(const side of [0,1]){
    const r=fog.sides[side];if(!shape(r,['structures','citadel'])||!Array.isArray(r.structures)||r.structures.length>FOG.maxMemories)fail('invalid fog memory');
    let previousId=0;
    for(const m of r.structures){
      if(!shape(m,['id','type','side','x','y','lane','level','observedAt'])||!number(m.id,previousId+1,nextId-1,true)||typeof m.type!=='string'||!Object.hasOwn(ruleset.buildings,m.type)||m.side!==1-side||!number(m.level,1,3,true)||!number(m.observedAt,0,state.time))fail('invalid fog structure record');
      const min=m.side===0?200:map.width-1320,max=m.side===0?1320:map.width-200;
      if(!number(m.x,min,max)||!number(m.y,180,720)||!number(m.lane,0,map.lanes.length-1,true)||m.lane!==map.lanes.reduce((best,_,i)=>Math.abs(map.lanes[i]-m.y)<Math.abs(map.lanes[best]-m.y)?i:best,0))fail('invalid fog structure position');
      // A still-live ID cannot describe a different actor. Level/HP are deliberately not compared.
      const live=[...state.units,...state.buildings].find(e=>e.id===m.id);
      if(live&&(!Object.hasOwn(ruleset.buildings,live.type)||live.side!==m.side||live.type!==m.type||live.x!==m.x||live.y!==m.y))fail('recycled fog structure identity');
      previousId=m.id;
    }
    if(r.citadel!==null&&(!shape(r.citadel,['choice','observedAt'])||![null,'arrows','regen'].includes(r.citadel.choice)||!number(r.citadel.observedAt,0,state.time)))fail('invalid fog citadel record');
  }
}
