import {Game, BUILDINGS, LANES, LEGACY_RULESET_ID} from './engine.js';
import { AUTHORED_AIR_RULESET_ID, deepFreeze } from './rulesets.js';

/** Authored battles use the normal economy, combat and save format. */
export const CHALLENGES = [
  {
    id:'shieldbreaker', name:'Shieldbreaker', subtitle:'Break a shield wall',
    description:'Three barracks feed a single, crowded battle line. Protect your ranged troops and break the production behind it.',
    objective:'Destroy all 3 enemy barracks within 3:30, or destroy the enemy citadel.',
    hint:'Warriors buy time for wizards to splash the shield wall. Archers alone struggle against shields.',
    difficulty:'normal', seed:117, mode:'destroy', timeLimit:210, startingGold:520, startingHealth:6000,
    briefing:['520 starting gold', '3 enemy barracks in the middle lane', 'Fixed enemy formation; no new enemy buildings'],
    playerBuildings:[['barracks',690,1]],
    enemyBuildings:[['barracks',1950,1],['barracks',2090,1],['barracks',2230,1]],
    markedTargets:[{type:'barracks',x:1950,lane:1},{type:'barracks',x:2090,lane:1},{type:'barracks',x:2230,lane:1}],
  },
  {
    id:'skyguard', name:'Skyguard', subtitle:'Fight on two fronts',
    description:'Veteran gryphon aeries raid both outer lanes. Ground-only troops cannot shoot back. Split your air defense before committing to a push.',
    objective:'Destroy both enemy aeries within 3:30, or destroy the enemy citadel.',
    hint:'Archery ranges in both outer lanes counter the flyers. Watchtowers can cover a lane while you invest elsewhere.',
    difficulty:'normal', seed:231, mode:'destroy', timeLimit:210, startingGold:525, startingHealth:4500,
    briefing:['525 starting gold; citadel starts at 4,500 HP', '2 level-3 aeries, one in each outer lane', 'Fixed enemy formation; no new enemy buildings'],
    playerBuildings:[['barracks',690,0]],
    enemyBuildings:[['aerie',1950,0,3],['aerie',2230,2,3]],
    markedTargets:[{type:'aerie',x:1950,lane:0},{type:'aerie',x:2230,lane:2}],
  },
  {
    id:'siegecraft', name:'Siegecraft', subtitle:'Crack the fortress',
    description:'Three fortified watchtowers lock down the middle lane. Bring siege engines into range and protect them while they fire.',
    objective:'Destroy all 3 watchtowers within 4:00, or destroy the enemy citadel.',
    hint:'Siege engines can outrange towers and deal triple damage to structures. A warrior screen keeps enemy infantry away.',
    difficulty:'normal', seed:349, mode:'destroy', timeLimit:240, startingGold:500, startingHealth:6000,
    briefing:['500 starting gold', '3 level-2 towers and a barracks in the middle lane', 'Fixed enemy formation; no new enemy buildings'],
    playerBuildings:[['barracks',690,1]],
    enemyBuildings:[['watchtower',1950,1,2],['watchtower',2090,1,2],['watchtower',2230,1,2],['barracks',2510,1]],
    markedTargets:[{type:'watchtower',x:1950,lane:1},{type:'watchtower',x:2090,lane:1},{type:'watchtower',x:2230,lane:1}],
  },
  {
    id:'goldrush', name:'Gold Rush', subtitle:'Invest under pressure',
    description:'Your citadel is damaged. Build mines behind your defenses and upgrade them to fund the fight.',
    objective:'Have at least 15 gold/sec when the clock reaches 2:30, with your citadel alive. Destroying the enemy citadel also wins.',
    hint:'Two watchtowers can hold the outer lanes. Three mines plus two mine upgrades reach 15 gold/sec. Keep mines behind your defenses.',
    difficulty:'normal', seed:463, mode:'economy', timeLimit:150, incomeTarget:15, startingGold:500, startingHealth:3500,
    briefing:['500 starting gold; citadel starts at 3,500 HP', 'Outer-lane warriors and middle-lane archers', 'Income is checked at 2:30, not when first reached'],
    playerBuildings:[['barracks',690,1]],
    enemyBuildings:[['barracks',2370,0],['barracks',2370,2],['archery',2650,1]],
    markedTargets:[],
  },
  {
    id:'holdfast', name:'Holdfast', subtitle:'Hold a broken line',
    description:'The citadel has only 1,800 health. Infantry attacks every lane, with archers in the middle and gryphons in the north. Cover all three lanes.',
    objective:'Keep your citadel alive for 2:20, or destroy the enemy citadel.',
    hint:'Defend all three lanes before spending on mines. Towers hold ground; archers answer the northern flyers. Save an arrow volley for a breakthrough.',
    difficulty:'hard', seed:587, mode:'survive', timeLimit:140, startingGold:650, startingHealth:1800,
    briefing:['650 starting gold; citadel starts at 1,800 HP', '3 barracks, a middle-lane archery range and a northern aerie', 'Survive 2:20; fixed enemy formation'],
    playerBuildings:[['barracks',690,1]],
    enemyBuildings:[['barracks',1950,0],['barracks',1950,1],['barracks',1950,2],['archery',2090,1],['aerie',2090,0]],
    markedTargets:[],
  },
];

// A new optional trial joins only the current catalog; published trials stay intact.
const ASHEN_CROSSROADS = {
  id:'ashen-crossroads', name:'Ashen Crossroads', subtitle:'Choose where the line breaks',
  description:'Three garrisons guard the burnt crossroads. Take two positions to open a passage, choosing between a forward tower, a crowded barracks and a distant gryphon roost.',
  objective:'Destroy any 2 of the 3 named positions within 4:00, or destroy the enemy citadel. The third position may remain standing.',
  hint:'Siege can reach Pinewatch from safety; splash helps at Stonegate, while archers can answer Ember Roost. Keep enough cover on the road you leave behind.',
  difficulty:'normal', seed:719, mode:'destroy', requiredTargets:2, timeLimit:240, startingGold:650, startingHealth:6000,
  briefing:['650 starting gold; one allied barracks on each road',
    'North · Pinewatch: forward level-2 tower, with archers behind it',
    'Middle · Stonegate: veteran level-3 barracks',
    'South · Ember Roost: distant level-2 aerie',
    'Fixed enemy formation; no new enemy buildings'],
  playerBuildings:[['barracks',690,0],['barracks',690,1],['barracks',690,2]],
  enemyBuildings:[['watchtower',1950,0,2],['archery',2370,0],['barracks',2090,1,3],['aerie',2230,2,2]],
  markedTargets:[{name:'Pinewatch',type:'watchtower',x:1950,lane:0},{name:'Stonegate',type:'barracks',x:2090,lane:1},{name:'Ember Roost',type:'aerie',x:2230,lane:2}],
};

/** Omitted counts retain the original all-targets rule. Reject malformed authored counts. */
export function requiredChallengeTargets(challenge) {
  const count = Object.hasOwn(challenge, 'requiredTargets') ? challenge.requiredTargets : challenge.markedTargets.length;
  if (challenge.mode === 'destroy' && (!Number.isInteger(count) || count < 1 || count > challenge.markedTargets.length ||
    new Set(challenge.markedTargets.map(t => `${t.type}/${t.x}/${t.lane}`)).size !== challenge.markedTargets.length))
    throw new RangeError('Invalid required trial target count or repeated target.');
  return count;
}
export const CURRENT_CHALLENGE_REVISION=2;
// Published revision 1 remains untouched. Fresh attempts select this whole identity.
export const CURRENT_CHALLENGES=deepFreeze([...CHALLENGES, ASHEN_CROSSROADS].map(challenge=>({
  ...JSON.parse(JSON.stringify(challenge)),scenarioRevision:CURRENT_CHALLENGE_REVISION,
  rulesetId:AUTHORED_AIR_RULESET_ID,rulesetRevision:1,mapId:'classic',mapRevision:1
})));
export function getChallenge(id,revision=1) {
  const list=revision===1?CHALLENGES:revision===CURRENT_CHALLENGE_REVISION?CURRENT_CHALLENGES:null;
  if(!list)throw new RangeError('Unsupported challenge revision: '+String(revision));
  const challenge=list.find(c=>c.id===id);
  if(!challenge)throw new RangeError('Unknown challenge: '+String(id));
  return challenge;
}
export function challengeScenarioForGame(game,id) {
  const revision=game?.ruleset?.id===AUTHORED_AIR_RULESET_ID?CURRENT_CHALLENGE_REVISION:
    game?.ruleset?.id===LEGACY_RULESET_ID?1:null;
  if(revision===null||game.ruleset.revision!==1||game.map.id!=='classic'||game.map.revision!==1)
    throw new Error('This game does not match a supported trial identity.');
  getChallenge(id,revision);
  return {kind:'trial',id,revision};
}
export const getChallengeForGame=(game,id)=>getChallenge(id,challengeScenarioForGame(game,id).revision);
export const createCurrentChallenge=id=>createChallenge(id,CURRENT_CHALLENGE_REVISION);
export function restartChallenge(game,id) {
  const revision=challengeScenarioForGame(game,id).revision;
  return makeChallenge(getChallenge(id,revision),game.schemaVersion===3);
}
// The one-argument historical factory deliberately retains its original schema.
export function createChallenge(id,revision=1) {
  return makeChallenge(getChallenge(id,revision),revision!==1);
}
function makeChallenge(challenge,explicitIdentity) {
  requiredChallengeTargets(challenge);
  const game=new Game({difficulty:challenge.difficulty,seed:challenge.seed,ai:false,
    ...(explicitIdentity?{rulesetId:challenge.rulesetId??LEGACY_RULESET_ID,rulesetRevision:challenge.rulesetRevision??1}:{} )});
  const state=game.state;
  state.buildings=[];state.effects=[];state.stats.built=[0,0];state.gold=[10000,10000];
  for(const [side,placements] of [[0,challenge.playerBuildings],[1,challenge.enemyBuildings]]) {
    for(const [type,x,lane,level=1] of placements) {
      const placed=game.build(type,x,LANES[lane],side);
      if(!placed.ok)throw new Error('Invalid challenge formation: '+placed.reason);
      for(let i=1;i<level;i++) {
        const upgraded=game.upgrade(placed.building.id,side);
        if(!upgraded.ok)throw new Error('Invalid challenge upgrade: '+upgraded.reason);
      }
    }
  }
  state.gold=[challenge.startingGold,0];state.bases[0].hp=challenge.startingHealth;
  return game;
}

/** Target identity uses authored positions, so evaluation also works after restore. */
export function getChallengeTargets(game,id) {
  return getChallengeForGame(game,id).markedTargets.map(target=>({
    ...target,
    building:game.state.buildings.find(b=>b.side===1&&b.hp>0&&b.type===target.type&&b.x===target.x&&b.lane===target.lane)||null,
  }));
}

export function evaluateChallenge(game,id) {
  const challenge=getChallengeForGame(game,id),s=game.state;
  const duration=Math.max(0,Math.min(1,s.time/challenge.timeLimit));
  // Read buildings rather than the cached HUD income, which updates on the next tick.
  const income=5+s.buildings.filter(b=>b.side===0&&b.type==='mint'&&b.hp>0)
    .reduce((total,b)=>total+BUILDINGS.mint.income*(1+0.5*(b.level-1)),0);
  const targets=getChallengeTargets(game,id),destroyed=targets.filter(t=>!t.building).length;
  const required=requiredChallengeTargets(challenge);
  let progress=challenge.mode==='destroy'?Math.min(1,destroyed/required):challenge.mode==='economy'?Math.min(duration,income/challenge.incomeTarget):duration;
  const atDeadline=s.time+1e-7>=challenge.timeLimit;
  const defeated=s.winner===1||s.bases[0].hp<=0;
  const coreVictory=s.winner===0||s.bases[1].hp<=0;
  const objectiveMet=challenge.mode==='destroy'?destroyed>=required:atDeadline&&(challenge.mode==='survive'||income>=challenge.incomeTarget);
  const completed=!defeated&&(coreVictory||objectiveMet);
  const failed=defeated||(!completed&&atDeadline);
  let label;
  if(defeated)label='Your citadel fell.';
  else if(coreVictory)label='Enemy citadel destroyed.';
  else if(challenge.mode==='destroy')label=`${Math.min(destroyed,required)}/${required} targets destroyed${challenge.requiredTargets && completed?' · Complete.':''}${failed?' · Time expired.':''}`;
  else if(challenge.mode==='economy')label=`${income.toFixed(1)}/${challenge.incomeTarget} gold/sec${failed?' · Time expired.':completed?' · Citadel held.':''}`;
  else label=completed?'Citadel held for 2:20.':`${Math.min(Math.floor(s.time),challenge.timeLimit)}/${challenge.timeLimit}s survived`;
  if(completed)progress=1;
  return {completed,failed,progress,label};
}
