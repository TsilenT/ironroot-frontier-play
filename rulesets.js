import { BRIDGE_CONTROL, CAMPAIGN_CONTROL, RIVER_BETWEEN_CONTROL } from './bridge-control.js';
import { CITADEL_OPTIONS } from './citadel-options.js';
export const ROAD_WE_KNOW_RULESET_ID='frontier-campaign-road-we-know';
export const FALSE_QUIET_RULESET_IDS=Object.freeze(['frontier-campaign-false-quiet-a','frontier-campaign-false-quiet-b']);
export const RIVER_BETWEEN_RULESET_ID='frontier-campaign-river-between';
export const ONE_SIGNAL_RULESET_ID='frontier-campaign-one-signal';
export const SHARED_CROSSING_RULESET_ID='frontier-campaign-shared-crossing';
export const LANTERNS_RULESET_ID='frontier-campaign-lanterns';
export const CAMPAIGN_FOG_RULESET_IDS=Object.freeze([LANTERNS_RULESET_ID,...FALSE_QUIET_RULESET_IDS]);
export const BORROWED_GROUND_RULESET_ID='frontier-campaign-borrowed-ground';
export const FOG_RULESET_ID='frontier-fog-experimental-open';
export const FOG_SKIRMISH_RULESET_ID='frontier-fog-skirmish-open';
export const FOG=Object.freeze({policy:'known-terrain-fog-v1',ordinaryRadius:320,flyerRadius:420,baseRadius:360,maxMemories:64,maxEffectsPerSide:128});
/** Immutable whole-rule identities. Never mutate a bound game's definitions. */
export function deepFreeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(deepFreeze);Object.freeze(value);}return value;}
export const SPELL = deepFreeze({cost:75,cooldown:25,radius:170,damage:92});
export const UNITS = deepFreeze({
  warrior:{name:'Warrior',hp:180,damage:21,range:34,speed:64,attackTime:1.05,color:'#e8d9a5',radius:14,flying:false,canAttackAir:false,canAttackGround:true,description:'Shielded front line. Resists arrows; vulnerable to siege.'},
  archer:{name:'Archer',hp:65,damage:17,range:205,speed:58,attackTime:1.05,color:'#98d9bb',radius:11,flying:false,canAttackAir:true,canAttackGround:true,description:'Long-range support. Fragile when warriors close in.'},
  siege:{name:'Siege ram',hp:240,damage:30,range:220,speed:35,attackTime:2.1,color:'#e5af67',radius:20,flying:false,canAttackAir:false,canAttackGround:true,description:'Slow siege engine. Triple damage to structures; ground splash against shields.'},
  wizard:{name:'Wizard',hp:90,damage:24,range:180,speed:52,attackTime:1.8,color:'#c4a4ed',radius:12,flying:false,canAttackAir:false,canAttackGround:true,splash:64,description:'Arcane ground splash bypasses shields. Cannot strike flying enemies.'},
  gryphon:{name:'Gryphon',hp:125,damage:17,range:110,speed:84,attackTime:1.25,color:'#efd8b0',radius:18,flying:true,canAttackAir:true,canAttackGround:true,description:'Flies above warriors and siege. Archers counter it; weak against structures.'}
});
export const BUILDINGS = deepFreeze({
  barracks:{name:'Barracks',short:'BR',cost:140,hp:700,unit:'warrior',spawnTime:9,color:'#d2b07b',description:'Spawns shielded warriors. Absorbs arrows and protects your archers.',range:0,damage:0},
  archery:{name:'Archery range',short:'AR',cost:175,hp:470,unit:'archer',spawnTime:10,color:'#8fc6ac',description:'Spawns fragile ranged archers. Best behind a warrior screen.',range:0,damage:0},
  foundry:{name:'Siege foundry',short:'SF',cost:270,hp:650,unit:'siege',spawnTime:17,color:'#db9b59',description:'Slow siege engines crush towers and splash tightly packed troops.',range:0,damage:0},
  watchtower:{name:'Watchtower',short:'WT',cost:220,hp:1000,unit:null,spawnTime:0,range:240,damage:29,color:'#a6bacb',description:'Powerful defense, but no troops. Siege engines break its walls.'},
  mint:{name:'Gold mine',short:'GM',cost:190,hp:380,unit:null,spawnTime:0,income:2.5,range:0,damage:0,color:'#e6c56f',description:'Adds 2.5 gold per second. Fragile economy; maximum 3 mines.'},
  sanctum:{name:'Arcane sanctum',short:'AS',cost:230,hp:520,unit:'wizard',spawnTime:14,color:'#b898df',range:0,damage:0,description:'Spawns wizards. Ground splash ignores shields, but cannot target flyers.'},
  aerie:{name:'Gryphon aerie',short:'GA',cost:250,hp:550,unit:'gryphon',spawnTime:15,color:'#dfcc9c',range:0,damage:0,description:'Spawns flying gryphons. Evade melee and siege; vulnerable to archers.'}
});

export const LEGACY_RULESET_ID='frontier-legacy';
export const DEFAULT_SKIRMISH_RULESET_ID='frontier-citadel-open';
const legacyLimits=deepFreeze({maxTime:10000,maxTick:1e7,maxCounter:1e9,maxId:1e9,headroom:0});
const longLimits=deepFreeze({maxTime:604800.01,maxTick:12096000,maxCounter:1e12,maxId:1e12,headroom:1e7});
const rootwardenUnits=deepFreeze({...UNITS,rootwarden:{name:'Rootwarden',hp:800,damage:8,range:34,speed:60,attackTime:1.5,color:'#91a177',radius:17,flying:false,canAttackAir:false,canAttackGround:true,description:'High-health, low-damage ground screen. No arrow resistance; cannot attack air.'}});
const rootwardenBuildings=deepFreeze({...BUILDINGS,wardenLodge:{name:'Warden lodge',short:'WL',cost:210,hp:650,unit:'rootwarden',spawnTime:12,color:'#91a177',description:'Durable melee screen. Low damage needs ranged support.',range:0,damage:0}});
const entry=(id,name,units,buildings,forcedDecay,limits)=>deepFreeze({id,revision:1,name,units,buildings,spell:SPELL,
  combat:{policy:'legacy',flyingCrossLanes:false},ai:{policy:'legacy'},economy:{policy:'legacy'},movement:{policy:'legacy'},
  endgame:{id:forcedDecay?'timed':'open-escalating',name:forcedDecay?'Sudden death':'Open-ended',escalationAt:300,productionMultiplier:1.65,structureDamageMultiplier:1.75,baseDamage:32,escalatedBaseDamage:18,forcedDecay,decayAt:forcedDecay?420:null},limits});
// Each campaign tier is a whole, immutable battle identity. A later unlock never
// mutates a running battle, and absent buildings/units fail ordinary engine admission.
export const CAMPAIGN_RULESET_IDS=deepFreeze(['frontier-campaign-watch','frontier-campaign-fork','frontier-campaign-open']);
const campaignBuildings=types=>deepFreeze(Object.fromEntries(types.map(type=>[type,rootwardenBuildings[type]])));
const campaignUnits=buildings=>deepFreeze(Object.fromEntries([...new Set(Object.values(buildings).map(b=>b.unit).filter(Boolean))].map(type=>[type,rootwardenUnits[type]])));
const watchBuildings=campaignBuildings(['barracks','archery']);
const forkBuildings=campaignBuildings(['barracks','archery','watchtower','mint','wardenLodge']);
const campaignEntry=(id,name,buildings)=>deepFreeze({...entry(id,name,campaignUnits(buildings),buildings,false,longLimits),campaignOnly:true});
// Flight orders are additive immutable identities, never a mutation of a saved roster.
const flightEntry=(id,name,forcedDecay,campaignOnly=false)=>deepFreeze({
  ...entry(id,name,rootwardenUnits,rootwardenBuildings,forcedDecay,longLimits),
  ...(campaignOnly?{campaignOnly:true}:{}),
  combat:{policy:'legacy',flyingCrossLanes:true},
  movement:{policy:'flight-orders-v1',flightOrders:{gateCenterOffset:200,warningSeconds:2,adjacentOnly:true,maxCrossings:1}}
});
// Fresh battles use local autonomous air combat; all published identities remain frozen.
export const AUTHORED_AIR_RULESET_ID='frontier-authored-air-local';
export const AUTONOMOUS_AIR_RULESET_IDS=deepFreeze(['frontier-air-local-open','frontier-air-local-timed','frontier-campaign-air-local']);
const autonomousAirEntry=(id,name,forcedDecay,campaignOnly=false)=>deepFreeze({
  ...entry(id,name,rootwardenUnits,rootwardenBuildings,forcedDecay,longLimits),
  ...(campaignOnly?{campaignOnly:true}:{}),
  combat:{policy:'legacy',flyingCrossLanes:true},
  movement:{policy:'autonomous-air-local-v1',autonomousAir:{perception:300,retention:420,adjacentOnly:true}}
});
const bridgeEntry=(id,forcedDecay)=>deepFreeze({
  ...autonomousAirEntry(id,`Bridge income · ${forcedDecay?'Sudden death':'Open-ended'}`,forcedDecay),
  skirmishOnly:true,economy:BRIDGE_CONTROL
});
const citadelEntry=(id,forcedDecay,bridge=false)=>deepFreeze({
  ...(bridge?bridgeEntry(id,forcedDecay):autonomousAirEntry(id,`Citadel choices · ${forcedDecay?'Sudden death':'Open-ended'}`,forcedDecay)),
  name:`Citadel choices${bridge?' + bridge income':''} · ${forcedDecay?'Sudden death':'Open-ended'}`,
  skirmishOnly:true,citadel:CITADEL_OPTIONS
});
export const CITADEL_CAMPAIGN_RULESET_IDS=deepFreeze(['frontier-campaign-citadel-watch','frontier-campaign-citadel-fork','frontier-campaign-citadel-open']);
export const AUTHORED_CITADEL_RULESET_ID='frontier-authored-citadel';
const authoredAirEntry=id=>deepFreeze({
  ...entry(id,'Field trials and practice · Automatic flyers',UNITS,BUILDINGS,true,legacyLimits),
  authoredOnly:true,combat:{policy:'legacy',flyingCrossLanes:true},
  movement:{policy:'autonomous-air-local-v1',autonomousAir:{perception:300,retention:420,adjacentOnly:true}}
});
export const RULESETS=deepFreeze({
  [ROAD_WE_KNOW_RULESET_ID]:deepFreeze({...autonomousAirEntry(ROAD_WE_KNOW_RULESET_ID,'Campaign · The Road We Know',false,true),citadel:CITADEL_OPTIONS}),
  ...Object.fromEntries(FALSE_QUIET_RULESET_IDS.map(id=>[id,deepFreeze({...autonomousAirEntry(id,'Campaign · False Quiet',false,true),citadel:CITADEL_OPTIONS,fog:FOG})])),
  [RIVER_BETWEEN_RULESET_ID]:deepFreeze({...autonomousAirEntry(RIVER_BETWEEN_RULESET_ID,'Campaign · A River Between Us',false,true),citadel:CITADEL_OPTIONS,campaignControl:RIVER_BETWEEN_CONTROL}),
  [BORROWED_GROUND_RULESET_ID]:deepFreeze({...autonomousAirEntry(BORROWED_GROUND_RULESET_ID,'Campaign · Borrowed Ground',false,true),citadel:CITADEL_OPTIONS}),
  [LANTERNS_RULESET_ID]:deepFreeze({...autonomousAirEntry(LANTERNS_RULESET_ID,'Campaign · Lanterns on the Water',false,true),citadel:CITADEL_OPTIONS,fog:FOG}),
  [ONE_SIGNAL_RULESET_ID]:deepFreeze({...autonomousAirEntry(ONE_SIGNAL_RULESET_ID,'Campaign · One Signal Is Enough',false,true),citadel:CITADEL_OPTIONS}),
  [SHARED_CROSSING_RULESET_ID]:deepFreeze({...autonomousAirEntry(SHARED_CROSSING_RULESET_ID,'Campaign · Shared Crossing',false,true),citadel:CITADEL_OPTIONS,campaignControl:CAMPAIGN_CONTROL}),
  [FOG_RULESET_ID]:deepFreeze({...citadelEntry(FOG_RULESET_ID,false),name:'Fog of war (experimental) · Open-ended',experimental:true,qaOnly:true,fog:FOG}),
  [FOG_SKIRMISH_RULESET_ID]:deepFreeze({...citadelEntry(FOG_SKIRMISH_RULESET_ID,false),name:'Fog of war (experimental) · Open-ended',experimental:true,fog:FOG}),
  [CITADEL_CAMPAIGN_RULESET_IDS[0]]:deepFreeze({...campaignEntry(CITADEL_CAMPAIGN_RULESET_IDS[0],'Campaign · First company + citadel choices',watchBuildings),citadel:CITADEL_OPTIONS}),
  [CITADEL_CAMPAIGN_RULESET_IDS[1]]:deepFreeze({...campaignEntry(CITADEL_CAMPAIGN_RULESET_IDS[1],'Campaign · Warden company + citadel choices',forkBuildings),citadel:CITADEL_OPTIONS}),
  [CITADEL_CAMPAIGN_RULESET_IDS[2]]:deepFreeze({...autonomousAirEntry(CITADEL_CAMPAIGN_RULESET_IDS[2],'Campaign · Automatic flyers + citadel choices',false,true),citadel:CITADEL_OPTIONS}),
  [AUTHORED_CITADEL_RULESET_ID]:deepFreeze({...authoredAirEntry(AUTHORED_CITADEL_RULESET_ID),name:'Field trials and introductory campaign · Citadel choices',citadel:CITADEL_OPTIONS}),
  'frontier-citadel-open':citadelEntry('frontier-citadel-open',false),
  'frontier-citadel-timed':citadelEntry('frontier-citadel-timed',true),
  'frontier-citadel-bridge-open':citadelEntry('frontier-citadel-bridge-open',false,true),
  'frontier-citadel-bridge-timed':citadelEntry('frontier-citadel-bridge-timed',true,true),
  'frontier-bridge-open':bridgeEntry('frontier-bridge-open',false),
  'frontier-bridge-timed':bridgeEntry('frontier-bridge-timed',true),
  'frontier-legacy':entry('frontier-legacy','Classic · Sudden death',UNITS,BUILDINGS,true,legacyLimits),
  'frontier-rootwarden-timed':entry('frontier-rootwarden-timed','Rootwarden · Sudden death',rootwardenUnits,rootwardenBuildings,true,longLimits),
  'frontier-rootwarden-open':entry('frontier-rootwarden-open','Rootwarden · Open-ended',rootwardenUnits,rootwardenBuildings,false,longLimits),
  'frontier-campaign-watch':campaignEntry('frontier-campaign-watch','Campaign · First company',watchBuildings),
  'frontier-campaign-fork':campaignEntry('frontier-campaign-fork','Campaign · Warden company',forkBuildings),
  'frontier-campaign-open':campaignEntry('frontier-campaign-open','Campaign · Full company',rootwardenBuildings),
  'frontier-flight-open':flightEntry('frontier-flight-open','Flight orders · Open-ended',false),
  'frontier-flight-timed':flightEntry('frontier-flight-timed','Flight orders · Sudden death',true),
  'frontier-campaign-flight':flightEntry('frontier-campaign-flight','Campaign · Flight orders',false,true),
  'frontier-air-local-open':autonomousAirEntry('frontier-air-local-open','Automatic flyers · Open-ended',false),
  'frontier-air-local-timed':autonomousAirEntry('frontier-air-local-timed','Automatic flyers · Sudden death',true),
  'frontier-campaign-air-local':autonomousAirEntry('frontier-campaign-air-local','Campaign · Automatic flyers',false,true),
  [AUTHORED_AIR_RULESET_ID]:authoredAirEntry(AUTHORED_AIR_RULESET_ID)
});
export function getRuleset(id=LEGACY_RULESET_ID,revision=1){if(typeof id!=='string'||!Object.hasOwn(RULESETS,id))throw new Error('Unknown ruleset: '+String(id));const rules=RULESETS[id];if(revision!==rules.revision)throw new Error('Unsupported ruleset revision');return rules;}
