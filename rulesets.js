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
export const DEFAULT_SKIRMISH_RULESET_ID='frontier-rootwarden-open';
const legacyLimits=deepFreeze({maxTime:10000,maxTick:1e7,maxCounter:1e9,maxId:1e9,headroom:0});
const longLimits=deepFreeze({maxTime:604800.01,maxTick:12096000,maxCounter:1e12,maxId:1e12,headroom:1e7});
const rootwardenUnits=deepFreeze({...UNITS,rootwarden:{name:'Rootwarden',hp:800,damage:8,range:34,speed:60,attackTime:1.5,color:'#91a177',radius:17,flying:false,canAttackAir:false,canAttackGround:true,description:'High-health, low-damage ground screen. No arrow resistance; cannot attack air.'}});
const rootwardenBuildings=deepFreeze({...BUILDINGS,wardenLodge:{name:'Warden lodge',short:'WL',cost:210,hp:650,unit:'rootwarden',spawnTime:12,color:'#91a177',description:'Durable melee screen. Low damage needs ranged support.',range:0,damage:0}});
const entry=(id,name,units,buildings,forcedDecay,limits)=>deepFreeze({id,revision:1,name,units,buildings,spell:SPELL,
  combat:{policy:'legacy',flyingCrossLanes:false},ai:{policy:'legacy'},economy:{policy:'legacy'},movement:{policy:'legacy'},
  endgame:{id:forcedDecay?'timed':'open-escalating',name:forcedDecay?'Sudden death':'Open-ended',escalationAt:300,productionMultiplier:1.65,structureDamageMultiplier:1.75,baseDamage:32,escalatedBaseDamage:18,forcedDecay,decayAt:forcedDecay?420:null},limits});
export const RULESETS=deepFreeze({
  'frontier-legacy':entry('frontier-legacy','Classic · Sudden death',UNITS,BUILDINGS,true,legacyLimits),
  'frontier-rootwarden-timed':entry('frontier-rootwarden-timed','Rootwarden · Sudden death',rootwardenUnits,rootwardenBuildings,true,longLimits),
  'frontier-rootwarden-open':entry('frontier-rootwarden-open','Rootwarden · Open-ended',rootwardenUnits,rootwardenBuildings,false,longLimits)
});
export function getRuleset(id=LEGACY_RULESET_ID,revision=1){if(typeof id!=='string'||!Object.hasOwn(RULESETS,id))throw new Error('Unknown ruleset: '+String(id));const rules=RULESETS[id];if(revision!==rules.revision)throw new Error('Unsupported ruleset revision');return rules;}
