import { BUILDINGS, UNITS, SPELL, getRuleset, LEGACY_RULESET_ID, LANTERNS_RULESET_ID, CAMPAIGN_FOG_RULESET_IDS, BORROWED_GROUND_RULESET_ID } from './rulesets.js';
import { supportsFlightOrders, flightGateHome, flightGateX } from './flight-orders.js';
import { supportsAutonomousAir, autonomousAirTarget, retainedAirTarget, releaseAirTarget } from './autonomous-air.js';
import { supportsBridgeControl, createBridgeControl, advanceBridgeControl, bridgeIncome, validateBridgeControl, supportsCampaignControl, createCampaignControl, advanceCampaignControl, campaignControlEnded, validateCampaignControl } from './bridge-control.js';
import { supportsCitadelOptions, createCitadelOptions, canBuyCitadelOption, buyCitadelOption, advanceCitadelRegeneration, chooseAICitadelOption, validateCitadelOptions } from './citadel-options.js';
import { supportsFog, createFog, refreshFog, observe, isPointVisible, eventAudience, appendFogEffect, decisionSnapshot, validateFog } from './fog.js';
export { FOG_RULESET_ID, FOG_SKIRMISH_RULESET_ID, LANTERNS_RULESET_ID } from './fog.js';
export { supportsAutonomousAir } from './autonomous-air.js';
export { supportsFlightOrders, flightGateHome, flightGateX } from './flight-orders.js';
export { BUILDINGS, UNITS, SPELL, RULESETS, getRuleset, LEGACY_RULESET_ID, DEFAULT_SKIRMISH_RULESET_ID, BORROWED_GROUND_RULESET_ID } from './rulesets.js';
/** Deterministic, DOM-free simulation. All coordinates are world pixels. */
export const WORLD = {width:3200,height:900};
export const LANES = [260,450,640];
// Public map revisions are immutable. Classic globals stay compatibility-only.
const SITE_COLUMNS=Object.freeze([270,410,550,690,830,970,1110,1250]);
const mapDescriptor=(id,name,width,lanes,startingLane)=>Object.freeze({id,revision:1,name,width,height:900,lanes:Object.freeze(lanes),startingLane,buildLimit:lanes.length*SITE_COLUMNS.length,siteColumns:SITE_COLUMNS});
export const MAPS=Object.freeze({
  classic:mapDescriptor('classic','Classic',3200,[260,450,640],1),
  'long-march':mapDescriptor('long-march','Long March',4000,[260,450,640],1),
  'twin-span':mapDescriptor('twin-span','Twin Span',3200,[340,560],0)
});
export const INTRO_MAPS=Object.freeze({
  'intro-one-road':mapDescriptor('intro-one-road','First Watch',3200,[450],0),
  'intro-two-road':mapDescriptor('intro-two-road','Forked Road',3200,[340,560],0)
});
// Authored maps are admitted by exact identity, never added to Skirmish's MAPS.
export const CAMPAIGN_MAPS=Object.freeze({
  'borrowed-yard':Object.freeze({...mapDescriptor('borrowed-yard','Borrowed Yard',3200,[260,450,640],1),buildLimit:12,siteColumns:Object.freeze([410,690,970,1250])})
});
const ALL_MAPS=Object.freeze({...MAPS,...INTRO_MAPS,...CAMPAIGN_MAPS});
export function getMap(mapId='classic',revision=1){if(typeof mapId!=='string'||!Object.hasOwn(ALL_MAPS,mapId))throw new Error('Unknown battlefield: '+String(mapId));const map=ALL_MAPS[mapId];if(revision!==map.revision)throw new Error('Unsupported battlefield revision');return map;}
export const homeX=(map,side,x)=>side===0?x:map.width-x;
export const worldX=(map,side,distance)=>side===0?distance:map.width-distance;
export const laneFor=(map,y)=>map.lanes.reduce((best,_,i)=>Math.abs(map.lanes[i]-y)<Math.abs(map.lanes[best]-y)?i:best,0);
export const buildBounds=(map,side)=>({minX:side===0?200:map.width-1320,maxX:side===0?1320:map.width-200,minY:180,maxY:720});
export const buildSites=(map,side)=>map.lanes.flatMap((y,lane)=>map.siteColumns.map(x=>({x:worldX(map,side,x),y,lane})));
const isBuildSite=(map,side,x,y)=>map.siteColumns.includes(homeX(map,side,x))&&map.lanes.includes(y);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const upgradeCost=b=>Math.round(BUILDINGS[b.type].cost*(0.7+0.35*(b.level-1)));
export class Game {
  constructor({difficulty='normal',seed=123,ai=true,mapId='classic',mapRevision=1,rulesetId,rulesetRevision=1}={}) {
    const ruleset=getRuleset(rulesetId===undefined?LEGACY_RULESET_ID:rulesetId,rulesetRevision);
    Object.defineProperties(this,{
      map:{value:getMap(mapId,mapRevision),enumerable:true},
      ruleset:{value:ruleset,enumerable:true},units:{value:ruleset.units,enumerable:true},buildings:{value:ruleset.buildings,enumerable:true},
      schemaVersion:{value:rulesetId!==undefined||!Object.hasOwn(MAPS,mapId)?3:mapId==='classic'?1:2}
    });
    const map=this.map;
    if((map.id==='borrowed-yard')!==(ruleset.id===BORROWED_GROUND_RULESET_ID))throw new Error('Borrowed Yard requires the Borrowed Ground campaign ruleset.');
    if(supportsFog(ruleset)&&(map.id!=='classic'||map.revision!==1||ruleset.endgame.forcedDecay||ruleset.economy.policy!=='legacy'||(ruleset.campaignOnly&&!CAMPAIGN_FOG_RULESET_IDS.includes(ruleset.id))||ruleset.authoredOnly))throw new Error('Experimental fog requires Classic open-ended Skirmish or an explicitly supported campaign mission');
    if(supportsCampaignControl(ruleset)&&(map.id!=='classic'||map.revision!==1))throw new Error('Campaign control requires Classic');
    if(supportsBridgeControl(ruleset)&&!Object.hasOwn(MAPS,map.id))throw new Error('Bridge income requires a Skirmish battlefield');
    if(supportsCitadelOptions(ruleset)&&ruleset.skirmishOnly&&!Object.hasOwn(MAPS,map.id))throw new Error('Citadel choices require a Skirmish battlefield');
    this.difficulty=['easy','normal','hard'].includes(difficulty)?difficulty:'normal';
    this.seed=seed>>>0; this.ai=ai;this.nextId=1;this.aiTimer=this.difficulty==='easy'?7:0;this.accumulator=0;this.tick=0;this.damageQueue=null;
    this.state={time:0,gold:[420,420],income:[5,5],bases:[{id:'base0',type:'base',side:0,hp:6000,maxHp:6000,cooldown:0,x:110,y:450},{id:'base1',type:'base',side:1,hp:6000,maxHp:6000,cooldown:0,x:map.width-110,y:450}],buildings:[],units:[],projectiles:[],effects:[],frontline:map.width/2,winner:null,spellCooldown:[0,0],overtime:false,stats:{kills:[0,0],built:[0,0],damage:[0,0]}};
    if(supportsBridgeControl(ruleset))this.state.bridgeControl=createBridgeControl(map);
    if(supportsCampaignControl(ruleset))this.state.campaignControl=createCampaignControl(map);
    if(supportsCitadelOptions(ruleset))this.state.citadelOptions=createCitadelOptions();
    if(supportsFog(ruleset))this.state.fog=createFog();
    for(let side=0;side<2;side++)this._place('barracks',worldX(map,side,410),map.lanes[map.startingLane],side);
    if(supportsFog(ruleset))refreshFog(this);
  }
  serialize(){return JSON.parse(JSON.stringify({...(this.schemaVersion===3?{version:3,rulesetId:this.ruleset.id,rulesetRevision:this.ruleset.revision,mapId:this.map.id,mapRevision:this.map.revision}:this.schemaVersion===1?{version:1}:{version:2,mapId:this.map.id,mapRevision:this.map.revision}),difficulty:this.difficulty,seed:this.seed,ai:this.ai,nextId:this.nextId,aiTimer:this.aiTimer,accumulator:this.accumulator,tick:this.tick,state:this.state}));}
  static restore(data){
    const {map,ruleset}=validateSave(data);
    const clean=JSON.parse(JSON.stringify(data));
    const game=new Game({difficulty:clean.difficulty,seed:clean.seed,ai:clean.ai,mapId:map.id,...(clean.version===3?{mapRevision:map.revision,rulesetId:ruleset.id,rulesetRevision:ruleset.revision}:{})});
    for(const key of ['difficulty','seed','ai','nextId','aiTimer','accumulator','tick','state'])game[key]=clean[key];
    return game;
  }
  canBuyCitadelOption(kind,side=0){return canBuyCitadelOption(this,kind,side);}
  buyCitadelOption(kind,side=0){const result=buyCitadelOption(this,kind,side);if(result.ok&&supportsFog(this.ruleset))refreshFog(this);return result;}
  upgradeCost(b){return Math.round(this.buildings[b.type].cost*(0.7+0.35*(b.level-1)));}
  get limitReason(){return this._limitFor(0);}
  _limitFor(dt){
    const limits=this.ruleset.limits;if(!limits.headroom)return null;
    const s=this.state,counters=[this.nextId,...s.gold,...s.stats.kills,...s.stats.built,...s.stats.damage];
    if(counters.some(n=>n>limits.maxCounter-limits.headroom))return 'This battle reached its supported counter limit. It is paused safely and can still be saved or exported.';
    let accumulator=this.accumulator+Math.min(dt,0.25),tick=this.tick,time=s.time;
    if(tick>=limits.maxTick||time>=limits.maxTime)return 'This battle reached the seven-day simulated-play limit. It is paused safely and can still be saved or exported.';
    while(dt>0&&accumulator>=0.05){tick++;time+=0.05;accumulator-=0.05;}
    if(tick>limits.maxTick||time>limits.maxTime)return 'This battle reached the seven-day simulated-play limit. It is paused safely and can still be saved or exported.';
    return null;
  }
  random(){this.seed=(Math.imul(this.seed,1664525)+1013904223)>>>0;return this.seed/4294967296;}
  canBuild(type,x,y,side=0){
    if(this.limitReason)return {ok:false,code:'save-safety-limit',reason:this.limitReason};
    if(typeof type!=='string'||!Object.hasOwn(this.buildings,type))return {ok:false,reason:'Unknown building.'};
    const s=this.state,d=this.buildings[type],bounds=buildBounds(this.map,side);
    if(s.winner!==null)return {ok:false,reason:'The battle has ended.'};
    if(typeof type!=='string'||!Object.hasOwn(this.buildings,type)||![0,1].includes(side))return {ok:false,reason:'Unknown building.'};
    if(!Number.isFinite(x)||!Number.isFinite(y)||x<bounds.minX||x>bounds.maxX||y<bounds.minY||y>bounds.maxY)return {ok:false,reason:'Build within your territory.'};
    if(this.map.id!=='classic'&&!isBuildSite(this.map,side,x,y))return {ok:false,reason:'Choose a marked building site.'};
    if(s.buildings.some(b=>b.hp>0&&Math.hypot(b.x-x,b.y-y)<108))return {ok:false,reason:'Too close to another building.'};
    if(type==='mint'&&s.buildings.filter(b=>b.side===side&&b.type==='mint').length>=3)return {ok:false,reason:'Maximum 3 gold mines per side.'};
    if(s.gold[side]<d.cost)return {ok:false,reason:`Need ${d.cost} gold.`};
    if(s.buildings.filter(b=>b.side===side).length>=this.map.buildLimit)return {ok:false,reason:`Building limit reached (${this.map.buildLimit}).`};
    return {ok:true};
  }
  build(type,x,y,side=0){const result=this.canBuild(type,x,y,side);if(!result.ok)return result;this.state.gold[side]-=this.buildings[type].cost;const building=this._place(type,x,y,side);if(supportsFog(this.ruleset))refreshFog(this);return {ok:true,building};}
  _place(type,x,y,side){const d=this.buildings[type];const b={id:this.nextId++,type,side,x,y,lane:laneFor(this.map,y),hp:d.hp,maxHp:d.hp,level:1,progress:d.unit?1-1.2/d.spawnTime:0,cooldown:0,invested:d.cost};if(supportsFlightOrders(this.ruleset)&&type==='aerie')b.flightPlan=b.lane;this.state.buildings.push(b);this.state.stats.built[side]++;this._effect(x,y,'build',side,0.7);return b;}
  setFlightPlan(id,toLane,side=0){
    if(this.limitReason)return {ok:false,code:'save-safety-limit',reason:this.limitReason};
    if(this.state.winner!==null)return {ok:false,reason:'The battle has ended.'};
    if(!supportsFlightOrders(this.ruleset))return {ok:false,reason:'Flight orders are not available under this battle’s rules.'};
    if(![0,1].includes(side))return {ok:false,reason:'Choose an owned gryphon aerie.'};
    const b=this.state.buildings.find(b=>b.id===id&&b.side===side&&b.type==='aerie'&&b.hp>0);
    if(!b)return {ok:false,reason:'Choose an owned gryphon aerie.'};
    if(!Number.isInteger(toLane)||toLane<0||toLane>=this.map.lanes.length||Math.abs(toLane-b.lane)>1)return {ok:false,reason:'Hold this road or choose an adjacent road.'};
    b.flightPlan=toLane;
    return {ok:true,building:b,reason:'Flight plan set for future launches. Airborne gryphons keep their orders.'};
  }
  upgrade(id,side=0){if(this.limitReason)return {ok:false,code:'save-safety-limit',reason:this.limitReason};const b=this.state.buildings.find(b=>b.id===id&&b.side===side&&b.hp>0);if(this.state.winner!==null||!b)return {ok:false,reason:'Select one of your buildings.'};if(b.level>=3)return {ok:false,reason:'Already at maximum level.'};const cost=this.upgradeCost(b);if(this.state.gold[side]<cost)return {ok:false,reason:`Need ${cost} gold.`};this.state.gold[side]-=cost;b.invested+=cost;b.level++;const hp=this.buildings[b.type].hp*(1+0.4*(b.level-1));b.hp+=hp-b.maxHp;b.maxHp=hp;this._effect(b.x,b.y,'upgrade',side,0.8);if(supportsFog(this.ruleset))refreshFog(this);return {ok:true,building:b};}
  sell(id,side=0){if(this.limitReason)return {ok:false,code:'save-safety-limit',reason:this.limitReason};const b=this.state.buildings.find(b=>b.id===id&&b.side===side&&b.hp>0);if(this.state.winner!==null||!b)return {ok:false,reason:'Select one of your buildings.'};const refund=Math.floor(b.invested*0.5*b.hp/b.maxHp);this.state.gold[side]+=refund;this.state.buildings=this.state.buildings.filter(a=>a!==b);this._effect(b.x,b.y,'sell',side,0.6);if(supportsFog(this.ruleset))refreshFog(this);return {ok:true,refund};}
  cast(x,y,side=0){if(this.limitReason)return {ok:false,code:'save-safety-limit',reason:this.limitReason};const s=this.state;if(s.winner!==null||![0,1].includes(side)||!Number.isFinite(x)||!Number.isFinite(y)||x<0||x>this.map.width||y<0||y>this.map.height)return {ok:false,reason:'Choose a point on the battlefield.'};if(supportsFog(this.ruleset)&&!isPointVisible(this,side,x,y))return {ok:false,code:'fog-hidden-aim',reason:'Volley needs a currently visible aim point.'};if(s.spellCooldown[side]>0)return {ok:false,reason:'Volley is recharging.'};if(s.gold[side]<SPELL.cost)return {ok:false,reason:`Need ${SPELL.cost} gold.`};s.gold[side]-=SPELL.cost;s.spellCooldown[side]=SPELL.cooldown;for(const u of s.units)if(u.side!==side&&Math.hypot(u.x-x,u.y-y)<SPELL.radius)this._damage(u,SPELL.damage,side);this._effect(x,y,'volley',side,1.1,SPELL.radius);if(supportsFog(this.ruleset))refreshFog(this);return {ok:true};}
  _effect(x,y,type,side,life=0.35,radius=30,fogSeen){if(supportsFog(this.ruleset)){appendFogEffect(this,{x,y,type,side,life,maxLife:life,radius,fogSeen:fogSeen??eventAudience(this,x,y)});return;}if(this.state.effects.length>=256)this.state.effects.shift();this.state.effects.push({x,y,type,side,life,maxLife:life,radius});}
  _spawn(b){const s=this.state;if(s.units.filter(u=>u.side===b.side&&u.hp>0).length>=70)return;const type=this.buildings[b.type].unit,d=this.units[type],mult=1+0.12*(b.level-1);const u={id:this.nextId++,type,flying:d.flying,side:b.side,x:b.x+(b.side?-48:48),y:this.map.lanes[b.lane]+(this.random()-0.5)*32,lane:b.lane,hp:d.hp*mult,maxHp:d.hp*mult,level:b.level,cooldown:this.random()*0.2,attack:0};if(supportsAutonomousAir(this.ruleset)&&d.flying)u.airTargetId=null;if(supportsFlightOrders(this.ruleset)&&type==='gryphon'&&b.flightPlan!=null&&b.flightPlan!==b.lane)u.airRoute={from:b.lane,to:b.flightPlan,phase:'approach',remaining:this.ruleset.movement.flightOrders.warningSeconds};s.units.push(u);this._effect(u.x,u.y,'spawn',u.side,0.45);}
  _advanceAirRoute(u,dt){
    if(!supportsFlightOrders(this.ruleset)||u.type!=='gryphon')return false;
    const route=u.airRoute;if(!route||route.phase==='done')return false;
    if(route.phase==='approach'){
      const gate=flightGateX(this.map,this.ruleset,u.side);
      if(Math.hypot(u.x-gate,u.y-this.map.lanes[route.from])>1e-8)return false;
      u.x=gate;u.y=this.map.lanes[route.from];
      route.phase='warning';route.remaining=this.ruleset.movement.flightOrders.warningSeconds;
    }
    u.attack=0;
    if(route.phase==='warning'){
      route.remaining=Math.max(0,route.remaining-dt);
      if(route.remaining<=1e-9){route.remaining=0;route.phase='transit';}
    }else {
      const y=this.map.lanes[route.to],distance=y-u.y,step=this.units[u.type].speed*dt;
      u.y+=Math.sign(distance)*Math.min(Math.abs(distance),step);
      if(Math.abs(distance)<=step){u.y=y;u.lane=route.to;route.phase='done';}
    }
    return true;
  }
  _damage(target,amount,side){if(this.damageQueue){this.damageQueue.push([target,amount,side]);return;}if(target.hp<=0)return;const seen=supportsFog(this.ruleset)&&amount>=target.hp?eventAudience(this,target.x,target.y):undefined;const damage=Math.min(target.hp,amount);target.hp=Math.max(0,target.hp-amount);this.state.stats.damage[side]+=damage;if(damage>0&&target.type==='base'&&supportsCitadelOptions(this.ruleset))this.state.citadelOptions.sides[target.side].lastDamageAt=this.state.time;target.hit=0.16;if(target.hp===0){if(supportsAutonomousAir(this.ruleset))for(const u of this.state.units)if(u.airTargetId===target.id)releaseAirTarget(u);if(this.units[target.type]){this.state.stats.kills[side]++;this.state.gold[side]+=2;}this._effect(target.x,target.y,'death',target.side,0.7,this.units[target.type]?18:52,seen);}}
  _fire(attacker,target,damage,type,citadelExtra=false){const s=this.state;attacker.attack=0.22;this._damage(target,damage,attacker.side);if(type!=='warrior'&&type!=='rootwarden'&&s.projectiles.length<256&&!supportsFog(this.ruleset))s.projectiles.push({x:attacker.x,y:attacker.y,sx:attacker.x,sy:attacker.y,tx:target.x,ty:target.y,side:attacker.side,type,sourceAir:!!this.units[attacker.type]?.flying,targetAir:!!this.units[target.type]?.flying,...(citadelExtra?{citadelExtra:true}:{}),...(supportsFog(this.ruleset)?{fogSeen:eventAudience(this,attacker.x,attacker.y)&eventAudience(this,target.x,target.y)}:{}),life:0.28,maxLife:0.28});else this._effect(target.x,target.y,'hit',attacker.side,0.2,16);}
  update(dt){if(!Number.isFinite(dt)||dt<=0||this.state.winner!==null||campaignControlEnded(this))return;const limit=this._limitFor(dt);if(limit)return {ok:false,code:'save-safety-limit',reason:limit};this.accumulator+=Math.min(dt,0.25);while(this.accumulator>=0.05){this._step(0.05);this.accumulator-=0.05;if(this.state.winner!==null||campaignControlEnded(this))break;}}
  _step(dt){
    if(campaignControlEnded(this))return;
    const s=this.state;this.tick++;this.damageQueue=[];s.time+=dt;s.overtime=s.time>=300;
    const fog=supportsFog(this.ruleset);if(fog)refreshFog(this);
    const contacts=fog?decisionSnapshot(this):null,canSee=(side,e)=>!contacts||contacts[side].has(e.id);
    const airViews=fog?[0,1].map(side=>({...this,state:{units:s.units.filter(u=>u.side===side||canSee(side,u))}})):null;
    for(let side=0;side<2;side++){s.income[side]=5+s.buildings.filter(b=>b.side===side&&b.type==='mint'&&b.hp>0).reduce((n,b)=>n+2.5*(1+0.5*(b.level-1)),0);s.gold[side]+=s.income[side]*dt;s.spellCooldown[side]=Math.max(0,s.spellCooldown[side]-dt);}
    for(const e of s.effects)e.life-=dt;s.effects=s.effects.filter(e=>e.life>0);
    for(const p of s.projectiles){p.life-=dt;const t=1-p.life/p.maxLife;p.x=p.sx+(p.tx-p.sx)*t;p.y=p.sy+(p.ty-p.sy)*t;}s.projectiles=s.projectiles.filter(p=>p.life>0);
    for(const b of (this.tick%2?s.buildings:[...s.buildings].reverse())){if(b.hp<=0)continue;b.hit=Math.max(0,(b.hit||0)-dt);const d=this.buildings[b.type];if(d.unit){b.progress+=dt*(1+0.22*(b.level-1))*(s.overtime?1.65:1)/d.spawnTime;if(b.progress>=1){b.progress-=1;this._spawn(b);}}
      if(d.range){b.cooldown=Math.max(-1,b.cooldown-dt);const enemies=s.units.filter(u=>u.side!==b.side&&u.hp>0&&canSee(b.side,u)&&Math.hypot(u.x-b.x,u.y-b.y)<d.range);enemies.sort((a,c)=>Math.hypot(a.x-b.x,a.y-b.y)-Math.hypot(c.x-b.x,c.y-b.y));if(enemies[0]&&b.cooldown<=0){const t=enemies[0];this._fire(b,t,d.damage*(1+0.3*(b.level-1))*(t.type==='warrior'?0.72:1),'tower');b.cooldown=0.85;}}
    }
    // Preserve the structure-first snapshot, then resolve all routes before unit combat.
    const flightOrders=supportsFlightOrders(this.ruleset),autoAir=supportsAutonomousAir(this.ruleset),routing=new Set();
    const airTargets=autoAir?new Map(s.units.map(u=>[u.id,u])):null;
    if(flightOrders)for(const u of s.units)if(u.hp>0&&this._advanceAirRoute(u,dt))routing.add(u.id);
    const pendingMoves=[];
    for(const u of (this.tick%2?s.units:[...s.units].reverse())){if(u.hp<=0)continue;const d=this.units[u.type],dir=u.side? -1:1;u.cooldown=Math.max(-1,u.cooldown-dt);u.attack=Math.max(0,u.attack-dt);u.hit=Math.max(0,(u.hit||0)-dt);
      if(routing.has(u.id))continue;
      let target=null,best=Infinity;
      const autonomousFlyer=autoAir&&d.flying;
      if(autonomousFlyer){
        target=autonomousAirTarget(fog?airViews[u.side]:this,u,fog?new Map([...airTargets].filter(([,e])=>canSee(u.side,e))):airTargets);
        if(target)best=Math.hypot(target.x-u.x,target.y-u.y);
      }
      if(!autonomousFlyer)for(const e of s.units){if(e.side===u.side||e.hp<=0||!canSee(u.side,e)||(e.lane!==u.lane&&!(autoAir&&d.canAttackAir&&this.units[e.type].flying)&&!(flightOrders&&d.canAttackAir&&e.type==='gryphon'&&e.airRoute?.phase==='transit'&&[e.airRoute.from,e.airRoute.to].includes(u.lane))&&Math.abs(u.x-(u.side?110:this.map.width-110))>220)||(this.units[e.type].flying&&!d.canAttackAir)||(!this.units[e.type].flying&&!d.canAttackGround)||(autoAir&&!d.flying&&this.units[e.type].flying&&Math.abs(e.y-this.map.lanes[u.lane])>d.range&&Math.hypot(e.x-u.x,e.y-u.y)>d.range))continue;const dist=Math.hypot(e.x-u.x,e.y-u.y);if(dist<best&&dist<Math.max(d.range+80,190)){target=e;best=dist;}}
      if(!target){for(const b of s.buildings){if(b.side===u.side||b.hp<=0||!canSee(u.side,b)||b.lane!==u.lane||(b.x-u.x)*dir < -90)continue;const dist=Math.hypot(b.x-u.x,b.y-u.y)-35;if(dist<best){target=b;best=dist;}}}
      if(!target){target=s.bases[1-u.side];best=Math.hypot(target.x-u.x,target.y-u.y)-55;}
      const structure=!this.units[target.type];
      if(best<=d.range&&canSee(u.side,target)){if(u.cooldown<=0){const troopDamage=d.damage*(1+0.12*(u.level-1));let damage=troopDamage;if(u.type==='archer'&&target.type==='warrior')damage*=0.55;if(u.type==='warrior'&&target.type==='archer')damage*=1.35;if(u.type==='archer'&&this.units[target.type]?.flying)damage*=1.5;if(u.type==='gryphon'&&structure)damage*=0.6;if(u.type==='siege'&&structure)damage*=3;if(s.overtime&&structure)damage*=1.75;this._fire(u,target,damage,u.type);if(u.type==='siege'||u.type==='wizard'){for(const e of s.units)if(e!==target&&e.side!==u.side&&e.hp>0&&!this.units[e.type].flying&&Math.hypot(e.x-target.x,e.y-target.y)<64)this._damage(e,troopDamage*(u.type==='wizard'?.65:.45),u.side);this._effect(target.x,target.y,u.type==='wizard'?'magic':'blast',u.side,0.45,55);}u.cooldown=d.attackTime;}}
      else if(flightOrders&&u.type==='gryphon'&&u.airRoute?.phase==='approach'){
        const dx=flightGateX(this.map,this.ruleset,u.side)-u.x,dy=this.map.lanes[u.lane]-u.y,length=Math.hypot(dx,dy)||1,step=Math.min(d.speed*dt,length);
        pendingMoves.push([u,u.x+dx/length*step,u.y+dy/length*step]);
      }
      else if(autoAir&&!d.flying&&this.units[target.type]?.flying){
        const dx=target.x-u.x,dy=this.map.lanes[u.lane]-u.y,length=Math.hypot(dx,dy)||1,step=Math.min(d.speed*dt,length);
        pendingMoves.push([u,clamp(u.x+dx/length*step,75,this.map.width-75),clamp(u.y+dy/length*step,180,720)]);
      }
      else {const targetY=target.type==='base'&&Math.abs(target.x-u.x)>180?this.map.lanes[u.lane]:target.y;let dx=target.x-u.x,dy=targetY-u.y;const length=Math.hypot(dx,dy)||1;pendingMoves.push([u,clamp(u.x+dx/length*d.speed*dt,75,this.map.width-75),clamp(u.y+dy/length*d.speed*dt,180,720)]);}
    }
    for(const [unit,x,y] of pendingMoves){unit.x=x;unit.y=y;if(autoAir&&this.units[unit.type].flying)unit.lane=laneFor(this.map,y);}
    for(const base of s.bases){
      base.cooldown=Math.max(-1,base.cooldown-dt);base.hit=Math.max(0,(base.hit||0)-dt);base.attack=Math.max(0,(base.attack||0)-dt);
      const nearby=s.units.filter(u=>u.side!==base.side&&canSee(base.side,u)&&(!supportsCitadelOptions(this.ruleset)||u.hp>0)&&Math.hypot(u.x-base.x,u.y-base.y)<310).sort((a,b)=>Math.hypot(a.x-base.x,a.y-base.y)-Math.hypot(b.x-base.x,b.y-base.y));
      if(base.cooldown<=0&&nearby[0]){
        const damage=s.overtime?18:32;this._fire(base,nearby[0],damage,'tower');
        if(supportsCitadelOptions(this.ruleset)&&s.citadelOptions.sides[base.side].choice==='arrows'&&nearby[1]){this._fire(base,nearby[1],damage*.5,'tower',true);s.citadelOptions.sides[base.side].extraShots++;}
        base.cooldown=1.15;
      }
    }
    const pendingDamage=this.damageQueue;this.damageQueue=null;for(const hit of pendingDamage)this._damage(...hit);
    s.units=s.units.filter(u=>u.hp>0);s.buildings=s.buildings.filter(b=>b.hp>0);
    if(autoAir)for(const u of s.units)if(this.units[u.type].flying&&u.airTargetId!==null&&!retainedAirTarget(this,u,airTargets))releaseAirTarget(u);
    if(supportsBridgeControl(this.ruleset)){
      // Sample living troops after simultaneous movement/damage. Income belongs
      // to this bound match, never to a mutable setup preference. AI can spend it.
      const paid=advanceBridgeControl(s.bridgeControl,this.map,s.units,dt,this.units),rates=bridgeIncome(this);
      for(const side of [0,1]){s.gold[side]+=paid[side];s.income[side]+=rates[side];}
    }
    if(s.units.length){const left=s.units.filter(u=>u.side===0),right=s.units.filter(u=>u.side===1);const a=left.length?Math.max(...left.map(u=>u.x)):110;const b=right.length?Math.min(...right.map(u=>u.x)):this.map.width-110;s.frontline=clamp((a+b)/2,110,this.map.width-110);}
    if(this.ruleset.endgame.forcedDecay&&s.time>420){for(const b of s.bases)b.hp=Math.max(0,b.hp-dt*(20+(s.time-420)*0.3));}
    if(s.bases[0].hp<=0||s.bases[1].hp<=0){if(s.bases[0].hp===0&&s.bases[1].hp===0)s.winner='draw';else s.winner=s.bases[0].hp<=0?1:0;if(fog)refreshFog(this);return;}
    if(supportsCampaignControl(this.ruleset)){
      // Core loss/win above takes precedence on the same tick. Never count after
      // mission termination, beyond its deadline, or in a rendering/evaluation call.
      const eligibleDt=Math.min(dt,Math.max(0,this.ruleset.campaignControl.timeLimit-(s.time-dt)));
      advanceCampaignControl(s.campaignControl,this.map,s.units,eligibleDt,this.units,this.ruleset.campaignControl);
      if(campaignControlEnded(this))return;
    }
    if(supportsCitadelOptions(this.ruleset))advanceCitadelRegeneration(this,dt);
    if(fog)refreshFog(this);
    if(this.ai){this.aiTimer-=dt;if(this.aiTimer<=0){this._ai();this.aiTimer=(this.difficulty==='easy'?14:this.difficulty==='hard'?3:5)+this.random()*3;}}
    if(fog)refreshFog(this);
  }
  _ai(side=1){
    if(![0,1].includes(side)||this.state.winner!==null||this.limitReason)return;
    const observation=supportsFog(this.ruleset)?observe(this,side):null;
    const strategyEnemies=observation?[...observation.state.buildings.filter(b=>b.side!==side),...observation.fog.memories]:null;
    if(supportsCitadelOptions(this.ruleset)){
      let choice=null;
      if(!observation)choice=chooseAICitadelOption(this,side);
      // Eligibility is an authoritative action guard; the choice uses only own state and contacts.
      else if(this.canBuyCitadelOption('arrows',side).ok){
        const ownBase=observation.state.bases[side],record=observation.state.citadelOptions.sides[side];
        if(observation.state.units.filter(u=>u.side!==side&&u.hp>0&&Math.hypot(u.x-ownBase.x,u.y-ownBase.y)<310).length>=2)choice='arrows';
        else if(ownBase.maxHp-ownBase.hp>=150&&(record.lastDamageAt===null||this.state.time>=record.lastDamageAt+this.ruleset.citadel.regenDelay-1e-8))choice='regen';
      }
      if(choice)this.buyCitadelOption(choice,side);
    }
    const home=x=>homeX(this.map,side,x);
    // Keep Classic's original arithmetic even at adjacent floating-point values
    // in historical non-grid saves. New maps use explicit home distances.
    const legacyX=x=>side===1?x:3200-x;
    const near=(x,distance)=>this.map.id==='classic'?legacyX(x)>3200-distance:home(x)<distance;
    const screened=x=>this.map.id==='classic'?legacyX(x)<2650:home(x)>550;
    const s=observation?{...this.state,units:observation.state.units}:this.state,hard=this.difficulty==='hard',easy=this.difficulty==='easy';
    // Only committed, visible launches project a threat; producer plans stay private.
    const incoming=(u,lane)=>supportsFlightOrders(this.ruleset)&&u.type==='gryphon'&&u.airRoute&&u.airRoute.phase!=='done'&&u.airRoute.to===lane;
    // Honest economy, but stronger rivals react earlier and reinforce threatened lanes.
    const actions=easy?1:hard?3:2;
    for(let action=0;action<actions;action++){
      const own=s.buildings.filter(b=>b.side===side),enemy=strategyEnemies??s.buildings.filter(b=>b.side!==side);
      const count=t=>own.filter(b=>b.type===t).length;
      const lanes=this.map.lanes.map((_,lane)=>{
        const buildings=own.filter(b=>b.lane===lane),foes=s.units.filter(u=>u.side!==side&&(u.lane===lane||incoming(u,lane)));
        const enemyProduction=enemy.filter(b=>b.lane===lane&&this.buildings[b.type].unit).length;
        const production=buildings.filter(b=>this.buildings[b.type].unit).length;
        // Normal's two-action opening must not count rear mine-row producers
        // as a nearby screen. Hard already fields three opening barracks.
        const coverage=this.difficulty==='normal'?buildings.filter(b=>this.buildings[b.type].unit&&screened(b.x)).length:production;
        return {lane,buildings,foes,production,enemyProduction,score:enemyProduction-coverage+foes.filter(u=>near(u.x,1550)||incoming(u,lane)).length*.35};
      }).sort((a,b)=>b.score-a.score||a.production-b.production||a.lane-b.lane);
      const target=lanes[0];let lane=target.lane,type='barracks';
      const local=t=>target.buildings.filter(b=>b.type===t).length;
      const pressure=target.foes.some(u=>near(u.x,1450))||target.enemyProduction>target.production;
      if(!easy&&s.time<5)type='barracks';
      else if(!easy&&target.foes.some(u=>this.units[u.type].flying)&&local('archery')<2)type='archery';
      else if(!easy&&target.foes.some(u=>near(u.x,1250))&&local('watchtower')<1&&target.production>0)type='watchtower';
      else if(local('barracks')<1||(this.difficulty==='normal'&&!target.buildings.some(b=>b.type==='barracks'&&screened(b.x))))type='barracks';
      else if(enemy.some(b=>b.type==='watchtower'&&b.lane===lane)&&local('foundry')<1)type='foundry';
      else if(!easy&&target.foes.filter(u=>u.type==='warrior').length>=3&&local('sanctum')<1)type='sanctum';
      else if(local('archery')<local('barracks'))type='archery';
      else if(!pressure&&count('mint')<(hard?3:2)&&s.time>35&&s.time<220&&own.length>4){type='mint';lane=Math.floor(this.random()*this.map.lanes.length);}
      else if(s.time>90&&local('sanctum')<1)type='sanctum';
      else if(s.time>110&&local('aerie')<1&&!enemy.some(b=>b.lane===lane&&b.type==='watchtower'))type='aerie';
      else if(s.time>130&&local('foundry')<1)type='foundry';
      const xs=type==='mint'?[270,410,550]:easy?[690,830,550,970,410,1110,270,1250]:type==='watchtower'?[1250,1110,970,830,690]:[1250,1110,970,830,690,550,410,270];
      let built=false;
      // Search the other lanes when the preferred lane has no legal space.
      for(const candidate of [lane,...lanes.map(l=>l.lane).filter(l=>l!==lane)]){
        for(const x of xs)if(this.build(type,worldX(this.map,side,x),this.map.lanes[candidate],side).ok){built=true;break;}
        if(built)break;
      }
      // Save for the selected counter if it is still affordable in principle.
      // At a full frontier, spend only on upgrades we can actually afford.
      if(!built&&(own.length>=this.map.buildLimit||s.gold[side]>=this.buildings[type].cost)){
        const upgrades=own.filter(b=>b.level<3&&this.upgradeCost(b)<=s.gold[side])
          .sort((a,b)=>(a.lane!==lane)-(b.lane!==lane)||a.level-b.level||a.id-b.id);
        if(upgrades[0])this.upgrade(upgrades[0].id,side);
      }
      if(!built)break;
    }
    if(!easy&&s.gold[side]>=SPELL.cost){const enemies=s.units.filter(u=>u.side!==side&&near(u.x,1650));let target=null,best=hard?2:3;for(const u of enemies){const n=enemies.filter(e=>Math.hypot(e.x-u.x,e.y-u.y)<SPELL.radius).length;if(n>best){best=n;target=u;}}if(target)this.cast(target.x,target.y,side);}
  }
}

/** Strict save validation. Nothing is evaluated or merged into prototypes. */
function validateSave(data){
  const fail=message=>{throw new Error('Invalid saved game: '+message);};
  let nodes=0;
  const plain=(v,path,depth=0)=>{
    if(++nodes>30000||depth>8)fail('data is too large or deeply nested');
    if(v===null||typeof v==='boolean')return;
    if(typeof v==='number'){if(!Number.isFinite(v))fail(path+' must be finite');return;}
    if(typeof v==='string'){if(v.length>100)fail(path+' is too long');return;}
    if(typeof v!=='object')fail(path+' is not JSON-compatible');
    if(Array.isArray(v)){if(v.length>256)fail(path+' exceeds its size limit');}
    else if(Object.getPrototypeOf(v)!==Object.prototype&&Object.getPrototypeOf(v)!==null)fail(path+' must be a plain object');
    const descriptors=Object.getOwnPropertyDescriptors(v),keys=Reflect.ownKeys(descriptors).filter(k=>!(Array.isArray(v)&&k==='length'));
    if(keys.length>256)fail(path+' has too many fields');
    if(Array.isArray(v)&&(keys.length!==v.length||keys.some((k,i)=>k!==String(i))))fail('array must be dense JSON');
    for(const key of keys){const descriptor=descriptors[key];if(typeof key!=='string'||['__proto__','constructor','prototype'].includes(key)||!Object.hasOwn(descriptor,'value')||!descriptor.enumerable)fail('unsafe property');plain(descriptor.value,path+'.'+key,depth+1);}
  };
  plain(data,'save');
  const obj=(v,p)=>{if(!v||typeof v!=='object'||Array.isArray(v))fail(p+' must be an object');};
  const num=(v,a,b,p,integer=false)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<a||v>b||(integer&&!Number.isInteger(v)))fail(p+' is outside its valid range');};
  const arr=(v,min,max,p)=>{if(!Array.isArray(v)||v.length<min||v.length>max)fail(p+' has an invalid length');};
  const pair=(v,p,integer=false,max=1e9)=>{arr(v,2,2,p);v.forEach(n=>num(n,0,max,p,integer));};
  obj(data,'save');if(![1,2,3].includes(data.version))fail('unsupported version');
  let map=MAPS.classic,ruleset=getRuleset();
  if(data.version<3&&['rulesetId','rulesetRevision','scenario','rules','ruleset'].some(key=>Object.hasOwn(data,key)))fail('legacy save cannot contain ruleset or scenario identity');
  if(data.version===1){if(Object.hasOwn(data,'mapId')||Object.hasOwn(data,'mapRevision'))fail('version 1 cannot contain map identity');}
  else if(data.version===2){
    if(typeof data.mapId!=='string'||!Object.hasOwn(MAPS,data.mapId)||data.mapId==='classic')fail('unknown version 2 battlefield');
    map=MAPS[data.mapId];if(data.mapRevision!==map.revision)fail('unsupported battlefield revision');
    const fields=['version','mapId','mapRevision','difficulty','seed','ai','nextId','aiTimer','accumulator','tick','state'];
    if(Object.keys(data).some(key=>!fields.includes(key)))fail('unknown version 2 field');
  }
  else {
    const fields=['version','rulesetId','rulesetRevision','mapId','mapRevision','difficulty','seed','ai','nextId','aiTimer','accumulator','tick','state'];
    if(Object.keys(data).some(key=>!fields.includes(key))||fields.some(key=>!Object.hasOwn(data,key)))fail('invalid version 3 fields');
    try{ruleset=getRuleset(data.rulesetId,data.rulesetRevision);map=getMap(data.mapId,data.mapRevision);}catch{fail('unknown or unsupported ruleset/battlefield identity');}
    strictStateFields(data.state,fail,ruleset);
  }
  if((map.id==='borrowed-yard')!==(ruleset.id===BORROWED_GROUND_RULESET_ID))fail('Borrowed Yard requires the Borrowed Ground campaign ruleset');
  const limits=ruleset.limits;
  if(!['easy','normal','hard'].includes(data.difficulty))fail('unknown difficulty');
  if(typeof data.ai!=='boolean')fail('ai must be boolean');
  num(data.seed,0,4294967295,'seed',true);num(data.nextId,1,limits.maxId,'nextId',true);num(data.tick,0,limits.maxTick,'tick',true);
  num(data.aiTimer,-1,30,'aiTimer');num(data.accumulator,0,.251,'accumulator');
  const s=data.state;obj(s,'state');num(s.time,0,limits.maxTime,'time');pair(s.gold,'gold',false,limits.maxCounter);pair(s.income,'income',false,supportsBridgeControl(ruleset)?20.5:20);pair(s.spellCooldown,'spellCooldown',false,SPELL.cooldown);
  if(supportsBridgeControl(ruleset)){
    if(!Object.hasOwn(MAPS,map.id))fail('bridge income requires a Skirmish battlefield');
    validateBridgeControl(s.bridgeControl,map,s.time,fail);
    for(const side of [0,1]){
      const share=s.bridgeControl.bridges.filter(b=>b.owner===side).length*.5/map.lanes.length;
      num(s.income[side],5,20+share,'bridge-mode total income');
    }
  }else if(Object.hasOwn(s,'bridgeControl'))fail('bridge control is outside this ruleset');
  if(supportsCampaignControl(ruleset)){
    // This fixed-tick mission must not admit an off-grid clock that can step
    // past its deadline. Historical identities retain their exact admission.
    if(Math.abs(s.time-data.tick*.05)>1e-7)fail('campaign control time does not match tick');
    validateCampaignControl(s.campaignControl,map,s.time,fail,ruleset.campaignControl);
  }
  else if(Object.hasOwn(s,'campaignControl'))fail('campaign control is outside this ruleset');
  if(supportsCitadelOptions(ruleset)){
    if(ruleset.skirmishOnly&&!Object.hasOwn(MAPS,map.id))fail('citadel choices require a Skirmish battlefield');
    validateCitadelOptions(s.citadelOptions,s.time,data.tick,fail);
  }else if(Object.hasOwn(s,'citadelOptions'))fail('citadel choices are outside this ruleset');
  if(supportsFog(ruleset))validateFog(s.fog,{map,ruleset,state:s,nextId:data.nextId},fail);
  else if(Object.hasOwn(s,'fog'))fail('fog knowledge is outside this ruleset');
  if(![null,0,1,'draw'].includes(s.winner))fail('unknown winner');if(typeof s.overtime!=='boolean')fail('overtime must be boolean');num(s.frontline,110,map.width-110,'frontline');
  obj(s.stats,'stats');pair(s.stats.kills,'kills',true,limits.maxCounter);pair(s.stats.built,'built',true,limits.maxCounter);pair(s.stats.damage,'damage',false,limits.maxCounter);
  arr(s.bases,2,2,'bases');arr(s.buildings,0,map.buildLimit*2,'buildings');arr(s.units,0,140,'units');arr(s.effects,0,256,'effects');arr(s.projectiles,0,256,'projectiles');
  const ids=new Set(),occupiedSites=new Set();
  function entity(e,p){obj(e,p);num(e.side,0,1,p+'.side',true);num(e.x,0,map.width,p+'.x');num(e.y,0,map.height,p+'.y');num(e.maxHp,1,10000,p+'.maxHp');num(e.hp,0,e.maxHp,p+'.hp');if(e.hit!==undefined)num(e.hit,0,1,p+'.hit');if(e.attack!==undefined)num(e.attack,0,1,p+'.attack');}
  s.bases.forEach((b,i)=>{entity(b,'base');if(b.type!=='base'||b.side!==i||b.id!=='base'+i||b.maxHp!==6000||b.x!==(i?map.width-110:110)||b.y!==450)fail('invalid base');num(b.cooldown,-1,2,'base.cooldown');});
  for(const [kind,entities,types] of [['building',s.buildings,ruleset.buildings],['unit',s.units,ruleset.units]])for(const e of entities){
    entity(e,kind);if(typeof e.type!=='string'||!Object.hasOwn(types,e.type))fail('unknown '+kind+' type');num(e.id,1,data.nextId-1,kind+'.id',true);if(ids.has(e.id))fail('duplicate entity id');ids.add(e.id);
    num(e.lane,0,map.lanes.length-1,kind+'.lane',true);num(e.level,1,3,kind+'.level',true);num(e.cooldown,-1,20,kind+'.cooldown');
    const maxHp=types[e.type].hp*(1+(kind==='building'?.4:.12)*(e.level-1));if(Math.abs(e.maxHp-maxHp)>.001)fail(kind+' health does not match its level');
    if(kind==='building'){if(supportsFlightOrders(ruleset)&&e.type==='aerie'){num(e.flightPlan,0,map.lanes.length-1,'flightPlan',true);if(Math.abs(e.flightPlan-e.lane)>1)fail('flight plan is not adjacent');}num(e.progress,0,1,'progress');num(e.invested,types[e.type].cost,2000,'invested');const bounds=buildBounds(map,e.side);num(e.x,bounds.minX,bounds.maxX,'building.x');num(e.y,bounds.minY,bounds.maxY,'building.y');if(e.lane!==laneFor(map,e.y))fail('building lane does not match position');if(map.id!=='classic'){if(!isBuildSite(map,e.side,e.x,e.y))fail('building is not on an owned site');const site=e.side+':'+e.x+':'+e.y;if(occupiedSites.has(site))fail('duplicate occupied building site');occupiedSites.add(site);}}
    else {if(e.flying!==types[e.type].flying)fail('unit flight does not match its type');num(e.attack,0,1,'unit.attack');num(e.x,75,map.width-75,'unit.x');num(e.y,180,720,'unit.y');if(supportsFlightOrders(ruleset))validateAirRoute(e);if(supportsAutonomousAir(ruleset)&&types[e.type].flying)validateAirTarget(e);}
  }
  function validateAirTarget(u){
    if(u.lane!==laneFor(map,u.y))fail('autonomous flyer lane does not match position');
    if(u.airTargetId===null)return;
    num(u.airTargetId,1,data.nextId-1,'airTargetId',true);
    const target=s.units.find(e=>e.id===u.airTargetId);
    if(!target||target.id===u.id||target.side===u.side||target.hp<=0)fail('invalid air target');
    const distance=Math.hypot(target.x-u.x,target.y-u.y);
    if(distance>ruleset.movement.autonomousAir.retention||
      (Math.abs(laneFor(map,target.y)-u.lane)>1&&distance>ruleset.units[u.type].range))fail('air target is outside local retention');
  }
  function validateAirRoute(u){
    if(!Object.hasOwn(u,'airRoute'))return;
    const r=u.airRoute;obj(r,'airRoute');
    strictFields(r,['from','to','phase','remaining'],[],fail);
    if(u.type!=='gryphon')fail('unexpected air route');
    num(r.from,0,map.lanes.length-1,'airRoute.from',true);num(r.to,0,map.lanes.length-1,'airRoute.to',true);
    if(Math.abs(r.from-r.to)!==1)fail('air route must connect adjacent roads');
    if(!['approach','warning','transit','done'].includes(r.phase))fail('unknown air route phase');
    const warning=ruleset.movement.flightOrders.warningSeconds,epsilon=1e-7;
    num(r.remaining,0,warning,'airRoute.remaining');
    if(u.lane!==(r.phase==='done'?r.to:r.from))fail('air route lane mismatch');
    if(r.phase==='approach'&&r.remaining!==warning)fail('approach timer mismatch');
    if(r.phase==='warning'&&r.remaining<=0)fail('warning timer has already expired');
    if(['transit','done'].includes(r.phase)&&r.remaining!==0)fail('completed warning timer mismatch');
    const home=homeX(map,u.side,u.x),gate=flightGateHome(map,ruleset),sourceY=map.lanes[r.from],destinationY=map.lanes[r.to];
    if(r.phase==='approach'&&(home>gate+epsilon||Math.abs(u.y-sourceY)>16+epsilon))fail('approach is outside its source-road gateway');
    if(['warning','transit'].includes(r.phase)&&Math.abs(home-gate)>epsilon)fail('air route is outside gateway');
    if(r.phase==='warning'&&Math.abs(u.y-sourceY)>epsilon)fail('warning is outside source road');
    if(r.phase==='transit'&&(u.y<Math.min(sourceY,destinationY)-epsilon||u.y>Math.max(sourceY,destinationY)+epsilon||Math.abs(u.y-destinationY)<epsilon))fail('transit position mismatch');
    if(['warning','transit'].includes(r.phase)&&u.attack!==0)fail('routing units cannot attack');
  }
  for(let side=0;side<2;side++){if(s.units.filter(u=>u.side===side).length>70||s.buildings.filter(b=>b.side===side).length>map.buildLimit||s.buildings.filter(b=>b.side===side&&b.type==='mint').length>3)fail('per-side entity limit exceeded');}
  for(const e of s.effects){obj(e,'effect');if(!['build','upgrade','sell','spawn','death','hit','blast','magic','volley'].includes(e.type))fail('unknown effect');num(e.side,0,1,'effect.side',true);num(e.x,0,map.width,'effect.x');num(e.y,0,map.height,'effect.y');num(e.maxLife,.01,2,'effect.maxLife');num(e.life,0,e.maxLife,'effect.life');num(e.radius,0,200,'effect.radius');if(supportsFog(ruleset))num(e.fogSeen,0,3,'effect.fogSeen',true);}
  for(const p of s.projectiles){obj(p,'projectile');if(supportsFog(ruleset))num(p.fogSeen,0,3,'projectile.fogSeen',true);if(Object.hasOwn(p,'citadelExtra')&&(!supportsCitadelOptions(ruleset)||p.citadelExtra!==true||p.type!=='tower'||s.citadelOptions.sides[p.side]?.choice!=='arrows'||s.citadelOptions.sides[p.side].extraShots<1||p.sx!==(p.side?map.width-110:110)||p.sy!==450))fail('invalid extra-arrow projectile');for(const field of ['sourceAir','targetAir'])if(p[field]!==undefined&&typeof p[field]!=='boolean')fail('projectile flight flags must be boolean');if(!['archer','siege','wizard','gryphon','tower'].includes(p.type))fail('unknown projectile');if(ruleset.campaignOnly&&p.type!=='tower'&&!Object.hasOwn(ruleset.units,p.type))fail('projectile is outside this campaign roster');num(p.side,0,1,'projectile.side',true);for(const k of ['x','sx','tx'])num(p[k],0,map.width,'projectile.'+k);for(const k of ['y','sy','ty'])num(p[k],0,map.height,'projectile.'+k);num(p.maxLife,.01,1,'projectile.maxLife');num(p.life,0,p.maxLife,'projectile.life');}
  if(s.winner==='draw'&&s.bases.some(b=>b.hp>0))fail('draw requires both cores to be destroyed');
  if(typeof s.winner==='number'&&s.bases[1-s.winner].hp>0)fail('winner has not destroyed the opposing base');
  return {map,ruleset};
}

/** Strict engine shape used by v3 restore and all playable-battle admission. */
export function validateEngineFields(data){
  const fail=message=>{throw new Error('Invalid saved game: '+message);};
  const fields=['version',...(data?.version===3?['rulesetId','rulesetRevision']:[]),...(data?.version>=2?['mapId','mapRevision']:[]),'difficulty','seed','ai','nextId','aiTimer','accumulator','tick','state'];
  strictFields(data,fields,[],fail);const ruleset=data.version===3?getRuleset(data.rulesetId,data.rulesetRevision):getRuleset();strictStateFields(data.state,fail,ruleset);
}
function strictFields(value,required,optional,fail){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!required.includes(k)&&!optional.includes(k))||required.some(k=>!Object.hasOwn(value,k)))fail('unknown field or missing required field');}
function strictStateFields(s,fail,ruleset){
  strictFields(s,['time','gold','income','bases','buildings','units','projectiles','effects','frontline','winner','spellCooldown','overtime','stats',...(supportsBridgeControl(ruleset)?['bridgeControl']:[]),...(supportsCampaignControl(ruleset)?['campaignControl']:[]),...(supportsCitadelOptions(ruleset)?['citadelOptions']:[]),...(supportsFog(ruleset)?['fog']:[])],[],fail);
  strictFields(s.stats,['kills','built','damage'],[],fail);
  const entity=['id','type','side','hp','maxHp','cooldown','x','y'],flight=supportsFlightOrders(ruleset),autoAir=supportsAutonomousAir(ruleset);
  for(const [name,required,optional] of [
    ['bases',entity,['hit','attack']],['buildings',[...entity,'lane','level','progress','invested'],['hit','attack']],
    ['units',[...entity,'lane','level','flying','attack'],['hit']],['effects',['x','y','type','side','life','maxLife','radius',...(supportsFog(ruleset)?['fogSeen']:[])],[]],
    ['projectiles',['x','y','sx','sy','tx','ty','side','type','life','maxLife',...(supportsFog(ruleset)?['fogSeen']:[])],['sourceAir','targetAir',...(supportsCitadelOptions(ruleset)?['citadelExtra']:[])]]
  ]){
    if(!Array.isArray(s[name]))fail('invalid entity collection');
    for(const e of s[name])strictFields(e,
      flight&&name==='buildings'&&e?.type==='aerie'?[...required,'flightPlan']:autoAir&&name==='units'&&ruleset.units[e?.type]?.flying?[...required,'airTargetId']:required,
      flight&&name==='units'&&e?.type==='gryphon'?[...optional,'airRoute']:optional,fail);
  }
}
