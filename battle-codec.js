/** One pure admission boundary for Resume, backup and candidate saves. */
import { Game, MAPS, getMap, getRuleset, LEGACY_RULESET_ID, validateEngineFields } from './engine.js';
import { deepFreeze, FOG_SKIRMISH_RULESET_ID, LANTERNS_RULESET_ID, FALSE_QUIET_RULESET_IDS, BORROWED_GROUND_RULESET_ID, RIVER_BETWEEN_RULESET_ID } from './rulesets.js';
import * as campaign from './campaign.js';
import { getChallenge, challengeScenarioForGame, evaluateChallenge } from './challenges.js';
import { TRAINING_LESSONS } from './training.js';

export const MAX_BATTLE_BYTES=1024*1024;
const own=(value,key)=>Object.hasOwn(value,key);
export class BattleCodecError extends Error {constructor(message,code='invalid-battle'){super(message);this.name='BattleCodecError';this.code=code;}}
const fail=(message,code)=>{throw new BattleCodecError(message,code);};
function fields(value,allowed,required=allowed){
  if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail('Saved battle must contain plain objects.');
  const descriptors=Object.getOwnPropertyDescriptors(value);
  if(Reflect.ownKeys(descriptors).some(key=>typeof key!=='string'||!allowed.includes(key)||!own(descriptors[key],'value')||!descriptors[key].enumerable)||required.some(key=>!own(value,key)))fail('Saved battle contains an unknown field or is missing a required field.');
}
function bounded(value){
  let nodes=0;const ancestors=new Set();
  const visit=(v,depth)=>{
    if(++nodes>30000||depth>12)fail('Saved battle is too large or deeply nested.','too-large');
    if(v===null||typeof v==='boolean')return;
    if(typeof v==='number'){if(!Number.isFinite(v))fail('Saved battle numbers must be finite.');return;}
    if(typeof v==='string'){if(v.length>100)fail('Saved battle contains an overlong value.');return;}
    if(typeof v!=='object'||ancestors.has(v))fail('Saved battle must contain acyclic JSON data.');
    if(!Array.isArray(v)&&![Object.prototype,null].includes(Object.getPrototypeOf(v)))fail('Saved battle must contain plain objects.');
    const ds=Object.getOwnPropertyDescriptors(v),keys=Reflect.ownKeys(ds).filter(k=>!(Array.isArray(v)&&k==='length'));
    if(keys.length>256||(Array.isArray(v)&&(v.length>256||keys.length!==v.length||keys.some((k,i)=>k!==String(i)))))fail('Saved battle collection is too large or malformed.');
    ancestors.add(v);
    for(const key of keys){if(typeof key!=='string'||key.length>100||['__proto__','constructor','prototype'].includes(key)||!own(ds[key],'value')||!ds[key].enumerable)fail('Saved battle contains an unsafe or non-JSON property.');visit(ds[key].value,depth+1);}
    ancestors.delete(v);
  };visit(value,0);
}
export function battleByteLength(text){
  if(typeof text!=='string'||text.length>MAX_BATTLE_BYTES)fail('Saved battle exceeds the 1 MiB limit.','too-large');
  let bytes=0;for(let i=0;i<text.length;i++){const c=text.charCodeAt(i);if(c<128)bytes++;else if(c<2048)bytes+=2;else if(c>=0xd800&&c<=0xdbff&&i+1<text.length&&text.charCodeAt(i+1)>=0xdc00&&text.charCodeAt(i+1)<=0xdfff){bytes+=4;i++;}else bytes+=3;if(bytes>MAX_BATTLE_BYTES)fail('Saved battle exceeds the 1 MiB limit.','too-large');}return bytes;
}
export function scenarioForBattle(challengeId=null,campaignId=null,game=null){
  if(challengeId!==null&&campaignId!==null)fail('A battle cannot be both a trial and a campaign mission.');
  const ref=campaignId!==null?(game?campaign.campaignScenarioForGame(game,campaignId):{kind:'campaign',id:campaignId,revision:1}):challengeId!==null?(game?challengeScenarioForGame(game,challengeId):{kind:'trial',id:challengeId,revision:1}):{kind:'skirmish',id:'standard',revision:1};
  resolveScenario(ref);return ref;
}
const scenarioCache=new Map();
export function resolveScenario(ref){
  fields(ref,['kind','id','revision']);
  if(typeof ref.kind!=='string'||!['skirmish','campaign','trial','lesson'].includes(ref.kind)||typeof ref.id!=='string'||!Number.isSafeInteger(ref.revision)||ref.revision<1||(!['campaign','trial'].includes(ref.kind)&&ref.revision!==1))fail('This save needs a compatible scenario version.','unsupported-identity');
  const key=`${ref.kind}/${ref.id}@${ref.revision}`;
  if(scenarioCache.has(key))return scenarioCache.get(key);
  let mission;
  if(ref.kind==='skirmish'){if(ref.id!=='standard')fail('Unknown skirmish scenario.','unsupported-identity');}
  else {
    if(ref.kind==='campaign'){
      try{mission=campaign.getCampaignMission(ref.id,ref.revision);}catch{fail('This save needs a compatible scenario version.','unsupported-identity');}
    }else if(ref.kind==='trial'){
      try{mission=getChallenge(ref.id,ref.revision);}catch{fail('This save needs a compatible scenario version.','unsupported-identity');}
    }else mission=TRAINING_LESSONS.find(item=>item.id===ref.id);
    if(!mission||(mission.scenarioRevision??1)!==ref.revision)fail('This save needs a compatible scenario version.','unsupported-identity');
  }
  const descriptor=deepFreeze({...ref,...(mission?{mapId:mission.mapId??'classic',mapRevision:mission.mapRevision??1,rulesetId:mission.rulesetId??LEGACY_RULESET_ID,rulesetRevision:mission.rulesetRevision??1,mission:JSON.parse(JSON.stringify(mission))}:{})});
  scenarioCache.set(key,descriptor);return descriptor;
}
function identityRef(ref,label){fields(ref,['id','revision']);if(typeof ref.id!=='string'||!Number.isSafeInteger(ref.revision)||ref.revision<1)fail(`Invalid ${label} identity.`);}
export function validateBattleIdentity(identity){
  fields(identity,['ruleset','map','scenario']);identityRef(identity.ruleset,'ruleset');identityRef(identity.map,'battlefield');
  let rules,map;try{rules=getRuleset(identity.ruleset.id,identity.ruleset.revision);map=getMap(identity.map.id,identity.map.revision);}catch{fail('This save needs a compatible ruleset or battlefield version.','unsupported-identity');}
  if(rules.qaOnly)fail('This experimental ruleset is available only in the isolated QA shell, not profile saves or backups.','qa-only-ruleset');
  const scenario=resolveScenario(identity.scenario);
  // The campaign yard and its rules cannot be relabelled as another scenario,
  // including identity-only history rows that never instantiate a Game.
  if((map.id==='borrowed-yard'||rules.id===BORROWED_GROUND_RULESET_ID||scenario.id==='borrowed-ground')&&
    (map.id!=='borrowed-yard'||map.revision!==1||rules.id!==BORROWED_GROUND_RULESET_ID||rules.revision!==1||scenario.kind!=='campaign'||scenario.id!=='borrowed-ground'||scenario.revision!==1))
    fail('Borrowed Ground requires its exact campaign, Borrowed Yard and ruleset identities.','unsupported-identity');
  // Compound control must retain its exact identity even in history-only rows.
  if((rules.id===RIVER_BETWEEN_RULESET_ID||scenario.id==='a-river-between-us')&&
    (rules.id!==RIVER_BETWEEN_RULESET_ID||rules.revision!==1||map.id!=='classic'||map.revision!==1||scenario.kind!=='campaign'||scenario.id!=='a-river-between-us'||scenario.revision!==1))
    fail('A River Between Us requires its exact campaign, Classic and ruleset identities.','unsupported-identity');
  if((FALSE_QUIET_RULESET_IDS.includes(rules.id)||scenario.id==='false-quiet')&&
    (!FALSE_QUIET_RULESET_IDS.includes(rules.id)||rules.revision!==1||map.id!=='classic'||map.revision!==1||scenario.kind!=='campaign'||scenario.id!=='false-quiet'||scenario.revision!==1))
    fail('False Quiet requires an exact campaign layout, Classic and ruleset identity.','unsupported-identity');
  if((rules.id==='frontier-campaign-road-we-know'||scenario.id==='the-road-we-know')&&
    (rules.id!=='frontier-campaign-road-we-know'||rules.revision!==1||map.id!=='twin-span'||map.revision!==1||scenario.kind!=='campaign'||scenario.id!=='the-road-we-know'||scenario.revision!==1))
    fail('The Road We Know requires its exact campaign, Twin Span and ruleset identities.','unsupported-identity');
  if((rules.id==='frontier-campaign-salt-stores'||scenario.id==='salt-in-the-stores')&&
    (rules.id!=='frontier-campaign-salt-stores'||rules.revision!==1||map.id!=='classic'||map.revision!==1||scenario.kind!=='campaign'||scenario.id!=='salt-in-the-stores'||scenario.revision!==1))
    fail('Salt in the Stores requires its exact campaign, ruleset and Classic identity.');
  if((rules.id==='frontier-campaign-archers-quay'||scenario.id==='the-archers-quay')&&
    (rules.id!=='frontier-campaign-archers-quay'||rules.revision!==1||map.id!=='classic'||map.revision!==1||scenario.kind!=='campaign'||scenario.id!=='the-archers-quay'||scenario.revision!==1))
    fail('The Archer’s Quay requires its exact campaign, ruleset and map identity.','campaign-identity');
  if((rules.id==='frontier-campaign-reed-beds'||scenario.id==='through-the-reed-beds')&&
    (rules.id!=='frontier-campaign-reed-beds'||rules.revision!==1||map.id!=='classic'||map.revision!==1||scenario.kind!=='campaign'||scenario.id!=='through-the-reed-beds'||scenario.revision!==1))
    fail('Through the Reed Beds requires its exact campaign, Classic and ruleset identities.','unsupported-identity');
  // Apply the supported fog scope here, not only in Game.restore: identity-only
  // history rows and backups must obey the same Classic standard-Skirmish contract.
  if(rules.id===FOG_SKIRMISH_RULESET_ID&&(rules.revision!==1||map.id!=='classic'||map.revision!==1||scenario.kind!=='skirmish'||scenario.id!=='standard'||scenario.revision!==1))fail('Fog is supported only for Classic standard Skirmish.','unsupported-identity');
  // Campaign fog is one authored identity, never an unlock for older missions.
  if(rules.id===LANTERNS_RULESET_ID&&(rules.revision!==1||map.id!=='classic'||map.revision!==1||scenario.kind!=='campaign'||scenario.id!=='lanterns-on-the-water'||scenario.revision!==1))fail('Campaign fog is supported only for Lanterns on the Water on Classic.','unsupported-identity');
  if(scenario.kind==='skirmish'){if(rules.campaignOnly||rules.authoredOnly)fail('This roster is only available in its authored scenario.');if(!own(MAPS,map.id))fail('This battlefield is only available in its authored scenario.');}
  else {if(map.id!==scenario.mapId||map.revision!==scenario.mapRevision)fail(`Authored missions require the ${getMap(scenario.mapId,scenario.mapRevision).name} battlefield.`);if(rules.revision!==scenario.rulesetRevision||(scenario.kind==='campaign'?!campaign.campaignRulesetAllowed(scenario.id,scenario.revision,rules.id):rules.id!==scenario.rulesetId))fail('Saved battle does not match its scenario rules.');}
  return deepFreeze({ruleset:{id:rules.id,revision:rules.revision},map:{id:map.id,revision:map.revision},scenario:{kind:scenario.kind,id:scenario.id,revision:scenario.revision}});
}
export function identityOf(game,scenario=scenarioForBattle()){
  return validateBattleIdentity({ruleset:{id:game.ruleset.id,revision:game.ruleset.revision},map:{id:game.map.id,revision:game.map.revision},scenario});
}
export function decodeBattle(value,{campaignProgress=campaign.createCampaignProgress()}={}){
  if(typeof value==='string'){battleByteLength(value);try{value=JSON.parse(value);}catch{fail('Saved battle is not valid JSON.');}}
  bounded(value);battleByteLength(JSON.stringify(value));
  let data=value,scenario=scenarioForBattle();
  if(value&&typeof value==='object'&&own(value,'format')){
    if(value.format!=='ironroot-save')fail('Saved battle has an invalid format.');
    if(![1,2,3].includes(value.version))fail('This save needs a compatible game version.','unsupported-version');
    if(value.version===3){fields(value,['format','version','scenario','game']);scenario=value.scenario;if(value.game?.version!==3)fail('Version-3 battles require an explicit engine identity.');}
    else {fields(value,['format','version','challengeId','campaignId','game'],['format','version','game']);try{scenario=scenarioForBattle(own(value,'challengeId')?value.challengeId:null,own(value,'campaignId')?value.campaignId:null);}catch(error){fail(error.message);}if(value.version===1&&scenario.kind==='campaign')fail('Version-1 saves cannot contain campaign missions.');if(![1,2].includes(value.game?.version))fail('Legacy envelopes cannot contain new-format engine data.');}
    data=value.game;
  }else if(![1,2].includes(value?.version))fail('New-format engine data requires a scenario envelope.');
  let game;try{validateEngineFields(data);game=Game.restore(data);}catch(error){fail('Saved battle contains invalid or incompatible engine data: '+error.message);}
  const identity=identityOf(game,scenario),resolved=resolveScenario(identity.scenario);
  if(resolved.kind==='lesson')fail('Practice lessons are not resumable saves.');
  if(game.state.winner!==null||game.state.bases.some(base=>base.hp<=0))fail('Saved battle has already ended.','ended-battle');
  if(resolved.mission){
    const mission=resolved.mission;
    if(game.difficulty!==mission.difficulty||game.ai!==(mission.ai===true))fail('Saved battle does not match its mission rules.');
    if(resolved.kind==='campaign'){
      if(!campaign.isMissionUnlocked(campaignProgress,resolved.id,resolved.revision))fail('Saved campaign battle is locked by campaign progress.','locked-mission');
      if(!campaign.canUseCampaignRuleset(campaignProgress,resolved.id,resolved.revision,game.ruleset.id))fail('Saved campaign roster has not been earned by this profile.','locked-roster');
    }
    const result=resolved.kind==='campaign'?campaign.evaluateCampaignMission(game,resolved.id,resolved.revision):evaluateChallenge(game,resolved.id);
    if(result.completed||result.failed)fail('Saved mission has already ended.','ended-battle');
  }
  return {game,scenario:identity.scenario,identity,challengeId:resolved.kind==='trial'?resolved.id:null,campaignId:resolved.kind==='campaign'?resolved.id:null};
}
export function encodeBattle(game,scenario=scenarioForBattle(),options={}){
  // Validate the supplied object before selecting fields; never normalize away
  // unknown scenario properties or invoke an unvalidated accessor.
  identityOf(game,scenario);if(scenario.kind==='lesson')fail('Practice lessons are not saved.');
  const data=game.serialize(),ref={kind:scenario.kind,id:scenario.id,revision:scenario.revision};
  const value=data.version===3?{format:'ironroot-save',version:3,scenario:ref,game:data}:{format:'ironroot-save',version:2,challengeId:ref.kind==='trial'?ref.id:null,campaignId:ref.kind==='campaign'?ref.id:null,game:data};
  decodeBattle(value,options);return value;
}
