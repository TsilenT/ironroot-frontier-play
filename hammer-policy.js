/** Isolated, exact-identity siege commitment experiment. Never selected by old rules. */
import {chooseAICitadelOption} from './citadel-options.js';
export const HAMMER_RULESET_ID='frontier-hammer-prototype';
export const HAMMER_CAMPAIGN_RULESET_ID='frontier-campaign-hammer-turns';
export const HAMMER_AI=Object.freeze({policy:'siege-road-commitment-v1',lockTicks:900,cooldownTicks:400,switchMargin:2,maxFoundries:2});
export const supportsHammer=rules=>(rules?.id===HAMMER_RULESET_ID||rules?.id===HAMMER_CAMPAIGN_RULESET_ID)&&rules.revision===1&&rules.ai?.policy===HAMMER_AI.policy;
export const createHammerState=()=>({sides:[0,1].map(()=>({lane:null,lockUntilTick:0,cooldownUntilTick:0}))});
const home=(g,side,x)=>side===0?x:g.map.width-x;
const world=(g,side,x)=>side===0?x:g.map.width-x;
const screens=new Set(['barracks','wardenLodge']);
const forward=(g,side,b)=>home(g,side,b.x)>550;
const alive=b=>b.hp>0;
const equivalent=(g,units)=>units.reduce((n,u)=>n+u.hp/g.units[u.type].hp,0);
export function hammerRoads(g,side){
 const s=g.state,own=s.buildings.filter(b=>b.side===side&&alive(b));
 return g.map.lanes.map((_,lane)=>{
  const buildings=own.filter(b=>b.lane===lane),front=buildings.filter(b=>forward(g,side,b));
  const screen=front.filter(b=>screens.has(b.type)),ranged=front.filter(b=>b.type==='archery');
  const ours=s.units.filter(u=>u.side===side&&u.lane===lane&&alive(u)&&home(g,side,u.x)>=550&&home(g,side,u.x)<=1900);
  const foes=s.units.filter(u=>u.side!==side&&u.lane===lane&&alive(u)&&home(g,side,u.x)<1550);
  const ownScreen=equivalent(g,ours.filter(u=>u.type==='warrior'||u.type==='rootwarden')),ownRanged=equivalent(g,ours.filter(u=>u.type==='archer'));
  const ground=equivalent(g,foes.filter(u=>!g.units[u.type].flying)),air=equivalent(g,foes.filter(u=>g.units[u.type].flying));
  const score=2*Math.min(2,screen.reduce((n,b)=>n+b.level,0))+Math.min(2,ranged.reduce((n,b)=>n+b.level,0))+Math.min(3,ownScreen)+Math.min(3,ownRanged)-2*Math.min(3,ground)-3*Math.min(2,air);
  return{lane,buildings,front,screen,ranged,foes,ownScreen,ownRanged,ground,air,score,production:front.filter(b=>g.buildings[b.type].unit).length,foundries:buildings.filter(b=>b.type==='foundry')};
 });
}
function site(g,side,type,lane,xs){
 for(const x of xs){const y=g.map.lanes[lane],px=world(g,side,x),r=g.canBuild(type,px,y,side);
  // canBuild checks geometry before affordability; shortage is not legal room loss.
  if(r.ok||r.reason===`Need ${g.buildings[type].cost} gold.`)return{method:'build',type,lane,x:px,y};
 }return null;
}
function buildAction(g,side,type,lane,xs=[1250,1110,970,830,690,550,410,270]){return site(g,side,type,lane,xs);}
const upgradeAction=b=>({method:'upgrade',id:b.id,type:b.type,lane:b.lane});
const cost=(g,a)=>a.method==='build'?g.buildings[a.type].cost:g.upgradeCost(g.state.buildings.find(b=>b.id===a.id));
function fundRoad(g,side,road){
 const own=g.state.buildings.filter(b=>b.side===side&&alive(b)),f=road.foundries.slice().sort((a,b)=>a.level-b.level||a.id-b.id)[0];
 if(!f){if(own.filter(b=>b.type==='foundry').length>=HAMMER_AI.maxFoundries)return null;
  const screenFront=Math.max(...road.screen.map(b=>home(g,side,b.x)));
  return buildAction(g,side,'foundry',road.lane,[1110,970,830,690,550,410,270].filter(x=>x<=screenFront-140));
 }
 if(f.level<3)return upgradeAction(f);
 // Already established siege can be turned toward only by buying useful support.
 const support=[...road.screen,...road.ranged].filter(b=>b.level<3).sort((a,b)=>a.level-b.level||a.id-b.id);
 if(support[0])return upgradeAction(support[0]);
 if(road.screen.length<2&&road.ground>road.ownScreen)return buildAction(g,side,'barracks',road.lane);
 if(road.ranged.length<2&&road.air>road.ownRanged)return buildAction(g,side,'archery',road.lane);
 return null;
}
function defensiveOptions(road,air=false){
 const candidates=air?[...road.ranged,...road.buildings.filter(b=>b.type==='watchtower')]:[...road.screen,...road.ranged,...road.buildings.filter(b=>b.type==='watchtower')];
 return candidates.filter(b=>b.level<3).sort((a,b)=>a.level-b.level||a.id-b.id).map(upgradeAction);
}
function affordableCandidate(g,side,candidates){
 const legal=candidates.filter(x=>x.action);return legal.find(x=>cost(g,x.action)<=g.state.gold[side])??legal[0]??null;
}
function emergency(g,side,roads){
 const ranked=roads.slice().sort((a,b)=>b.air-a.air||b.ground-a.ground||a.lane-b.lane),candidates=[];
 const offer=(actions,reason)=>{for(const action of actions)if(action)candidates.push({action,reason});};
 for(const r of ranked){
  if(r.air>0&&r.ranged.length<2)offer([buildAction(g,side,'archery',r.lane),...defensiveOptions(r,true)],'visible-air');
  if(r.ground>0&&r.production===0)offer([buildAction(g,side,'barracks',r.lane),...defensiveOptions(r)],'empty-road-incursion');
  else if(r.foes.some(u=>!g.units[u.type].flying&&home(g,side,u.x)<1250)&&!r.buildings.some(b=>b.type==='watchtower')&&r.production>0)offer([buildAction(g,side,'watchtower',r.lane),...defensiveOptions(r)],'ground-incursion');
 }
 return affordableCandidate(g,side,candidates);
}
function basicRepair(g,side,roads){
 const ranked=roads.slice().sort((a,b)=>(b.ground+b.air)-(a.ground+a.air)||a.production-b.production||a.lane-b.lane),candidates=[];
 const offer=(r,type,air)=>{const action=buildAction(g,side,type,r.lane);if(action)candidates.push({action});if(!action||r.foes.length)for(const alternative of defensiveOptions(r,air))candidates.push({action:alternative});};
 for(const r of ranked){if(!r.screen.length)offer(r,'barracks',false);if(!r.ranged.length)offer(r,'archery',true);}
 return affordableCandidate(g,side,candidates)?.action??null;
}
function upkeep(g,side,road){
 if(!road.screen.length)return buildAction(g,side,'barracks',road.lane);
 if(!road.ranged.length)return buildAction(g,side,'archery',road.lane);
 if(road.ground>road.ownScreen&&road.screen.length<2)return buildAction(g,side,'barracks',road.lane);
 if(road.air>0&&road.ranged.length<2)return buildAction(g,side,'archery',road.lane);
 const f=road.foundries.filter(b=>b.level<3).sort((a,b)=>a.level-b.level||a.id-b.id)[0];
 if(f)return upgradeAction(f);
 const support=[...road.screen,...road.ranged].filter(b=>b.level<3).sort((a,b)=>a.level-b.level||(road.air>0?(b.type==='archery')-(a.type==='archery'):a.id-b.id)||a.id-b.id);
 return support[0]?upgradeAction(support[0]):null;
}
function maintain(g,side,roads,committed){
 const ranked=roads.filter(r=>r.lane!==committed).sort((a,b)=>(b.ground+b.air)-(a.ground+a.air)||a.production-b.production||a.lane-b.lane),candidates=[];
 for(const r of ranked)for(const action of r.air>0?defensiveOptions(r,true):r.ground>0?defensiveOptions(r):[])candidates.push({action});
 return affordableCandidate(g,side,candidates)?.action??null;
}

const eligible=(road,roads)=>road.screen.length&&road.ranged.length&&roads.every(x=>x.lane===road.lane||x.production>0);

export function runHammerAI(g,side=1){
 const s=g.state,r=s.hammerCommitment.sides[side],report={tick:g.tick,side,before:{...r},transitions:[],attempts:[],roads:[],actions:0,apiAttempts:0,offensiveAttempts:0};
 let roads=hammerRoads(g,side),current=r.lane===null?null:roads[r.lane],offensiveUsed=false;
 if(current&&(!current.foundries.length||!current.screen.length||!current.ranged.length)){
  const reason=!current.foundries.length?'foundry-lost':!current.screen.length?'last-screen-lost':'last-range-lost';
  report.transitions.push({type:'collapse',lane:r.lane,reason});r.lane=null;r.lockUntilTick=0;r.cooldownUntilTick=g.tick+HAMMER_AI.cooldownTicks;
 }
 const choice=chooseAICitadelOption(g,side);if(choice)g.buyCitadelOption(choice,side);
 const execute=(a,reason)=>{if(!a)return false;report.apiAttempts++;const before=s.gold[side],out=a.method==='build'?g.build(a.type,a.x,a.y,side):g.upgrade(a.id,side);report.attempts.push({reason,action:{...a},cost:before-s.gold[side],ok:out.ok,denial:out.reason??null});if(out.ok)report.actions++;return out.ok;};
 for(let action=0;action<2;action++){
  roads=hammerRoads(g,side);const urgent=emergency(g,side,roads);
  if(urgent){if(!execute(urgent.action,'emergency:'+urgent.reason))break;continue;}
  const repair=basicRepair(g,side,roads);if(repair){if(!execute(repair,'basic-road-repair'))break;continue;}
  current=r.lane===null?null:roads[r.lane];let chosen=null,payment=null;
  if(!offensiveUsed&&g.tick>=r.cooldownUntilTick&&(!current||g.tick>=r.lockUntilTick)){
   const candidates=roads.filter(t=>eligible(t,roads)).map(t=>({road:t,payment:fundRoad(g,side,t)})).filter(x=>x.payment&&(!current||(x.road.lane!==current.lane&&x.road.score>=current.score+HAMMER_AI.switchMargin)));
   if(candidates.length){const best=Math.max(...candidates.map(x=>x.road.score)),ties=candidates.filter(x=>Math.abs(x.road.score-best)<1e-9);const selected=ties.length===1?ties[0]:ties[Math.floor(g.random()*ties.length)];chosen=selected.road;payment=selected.payment;}
  }
  if(chosen){offensiveUsed=true;report.offensiveAttempts++;const previous=r.lane;if(!execute(payment,current?'funded-turn':'funded-commitment'))continue;r.lane=chosen.lane;r.lockUntilTick=g.tick+HAMMER_AI.lockTicks;r.cooldownUntilTick=0;report.transitions.push({type:previous===null?'commit':'turn',from:previous,lane:r.lane,payment:{...payment}});continue;}
  if(current&&!offensiveUsed){const a=upkeep(g,side,current);if(a){offensiveUsed=true;report.offensiveAttempts++;execute(a,'commitment-upkeep');continue;}}
  const a=maintain(g,side,roads,r.lane);if(!a)break;
  // Only nonessential upkeep may wait for a genuinely eligible siege purchase.
  // Basic coverage and real emergencies have already bypassed this reservation.
  if(r.lane===null&&g.tick>=r.cooldownUntilTick&&roads.some(t=>eligible(t,roads)&&fundRoad(g,side,t))&&s.gold[side]-cost(g,a)<g.buildings.foundry.cost){report.attempts.push({reason:'save-for-siege',action:{...a},cost:0,ok:false,denial:'Treasury reserved, not an added resource.'});break;}
  if(!execute(a,'other-road-maintenance'))break;
 }
 if(s.gold[side]>=g.ruleset.spell.cost&&s.spellCooldown[side]<=0){const enemies=s.units.filter(u=>u.side!==side&&alive(u)&&home(g,side,u.x)<1650);let target=null,best=3;for(const u of enemies){const n=enemies.filter(e=>Math.hypot(e.x-u.x,e.y-u.y)<g.ruleset.spell.radius).length;if(n>best){best=n;target=u;}}if(target)g.cast(target.x,target.y,side);}
 report.after={...r};report.roads=hammerRoads(g,side).map(({lane,score,ownScreen,ownRanged,ground,air,production})=>({lane,score,ownScreen,ownRanged,ground,air,production}));return report;
}

export function validateHammerState(value,map,tick,fail){
 const shape=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
 if(!shape(value,['sides'])||!Array.isArray(value.sides)||value.sides.length!==2)fail('invalid Hammer commitment');
 for(const r of value.sides){if(!shape(r,['lane','lockUntilTick','cooldownUntilTick']))fail('invalid Hammer record');
  if(r.lane!==null&&(!Number.isInteger(r.lane)||r.lane<0||r.lane>=map.lanes.length))fail('invalid Hammer lane');
  if(!Number.isSafeInteger(r.lockUntilTick)||r.lockUntilTick<0||r.lockUntilTick>tick+HAMMER_AI.lockTicks||!Number.isSafeInteger(r.cooldownUntilTick)||r.cooldownUntilTick<0||r.cooldownUntilTick>tick+HAMMER_AI.cooldownTicks)fail('invalid Hammer timer');
  if((r.lockUntilTick>0&&r.lockUntilTick<HAMMER_AI.lockTicks)||(r.cooldownUntilTick>0&&r.cooldownUntilTick<HAMMER_AI.cooldownTicks))fail('Hammer deadline predates earliest possible origin');
  if(r.lane===null?r.lockUntilTick!==0:r.lockUntilTick===0||r.cooldownUntilTick!==0)fail('inconsistent Hammer commitment');
 }
}
