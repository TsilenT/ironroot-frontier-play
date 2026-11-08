/** Optional Skirmish control contract. Positions are sampled once per engine tick. */
export const BRIDGE_CONTROL = Object.freeze({policy:'persistent-bridge-v1',width:210,height:130,captureSeconds:2,totalIncome:0.5});
export const BRIDGE_RULES_TEXT = 'Experimental bridge income: 0.5 gold/s across the whole map, divided equally between roads. Bridges start unowned. Ground troops capture after 2 continuous uncontested seconds. Any living opposing troop, including a flyer, interrupts capture and stops payment. Flyers deny but cannot capture. Ownership remains when empty, with no timeout. Enemies need the same 2 seconds to take it; if they withdraw early, the previous owner earns again. Both sides follow the same rules. No overtime bonus.';
export const CAMPAIGN_CONTROL = Object.freeze({policy:'cumulative-route-v1',requiredBridges:2,seconds:60,timeLimit:270});
export const CAMPAIGN_CONTROL_RULES_TEXT = 'Secure any two of the three bridges for 60 cumulative simulated seconds. Ground troops capture after 2 continuous uncontested seconds. Opposing troops, including flyers, interrupt capture and deny control time. Flyers cannot capture. Empty bridges retain their owner until captured. Both sides capture the same way, but only your supply route has a control victory; the enemy denies it. Falling below two clear bridges pauses your total without resetting it. Bridges grant no income or capture bounty. Destroying the enemy citadel also wins; losing yours fails. Time limit: 4:30.';
export const supportsCampaignControl = ruleset => ruleset?.campaignControl?.policy === CAMPAIGN_CONTROL.policy;
export const supportsBridgeControl = ruleset => ruleset?.economy?.policy === BRIDGE_CONTROL.policy;
export const bridgeZones = map => map.lanes.map((y,lane)=>({lane,x:map.width/2,y,width:BRIDGE_CONTROL.width,height:BRIDGE_CONTROL.height}));
export const createBridgeControl = map => ({bridges:map.lanes.map(()=>({owner:null,capturing:null,progress:0})),earned:[0,0]});

function presence(zone,units,unitTypes){
  const present=[false,false],ground=[false,false];
  for(const u of units){
    const type=Object.hasOwn(unitTypes,u.type)?unitTypes[u.type]:null;
    if(!type||!(u.hp>0)||![0,1].includes(u.side)||!Number.isFinite(u.x)||!Number.isFinite(u.y)||Math.abs(u.x-zone.x)>zone.width/2||Math.abs(u.y-zone.y)>zone.height/2)continue;
    present[u.side]=true;if(!type.flying)ground[u.side]=true;
  }
  return {present,ground};
}

/** Only eligible time AFTER capture earns gold. No capture bounty or retroactive pay. */
export function advanceBridgeControl(control,map,units,dt,unitTypes){
  const paid=[0,0],rate=BRIDGE_CONTROL.totalIncome/map.lanes.length;
  for(const zone of bridgeZones(map)){
    const b=control.bridges[zone.lane],{present,ground}=presence(zone,units,unitTypes);
    const candidate=ground[0]&&!present[1]?0:ground[1]&&!present[0]?1:null;
    let payingTime=dt;
    if(candidate!==null&&candidate!==b.owner){
      if(b.capturing!==candidate){b.capturing=candidate;b.progress=0;}
      const remaining=BRIDGE_CONTROL.captureSeconds-b.progress;
      if(dt+1e-9>=remaining){
        b.owner=candidate;b.capturing=null;b.progress=0;payingTime=Math.max(0,dt-remaining);
      }else{b.progress+=dt;payingTime=0;}
    }else{b.capturing=null;b.progress=0;}
    if(b.owner!==null&&!present[1-b.owner])paid[b.owner]+=rate*payingTime;
  }
  for(const side of [0,1])control.earned[side]+=paid[side];
  return paid;
}

export function bridgeStatus(game){
  if(!supportsBridgeControl(game.ruleset)&&!supportsCampaignControl(game.ruleset))return [];
  return bridgeZones(game.map).map(zone=>{
    const b=(supportsCampaignControl(game.ruleset)?game.state.campaignControl:game.state.bridgeControl).bridges[zone.lane],{present}=presence(zone,game.state.units,game.units);
    const blocked=present[0]&&present[1]||b.owner!==null&&present[1-b.owner];
    return {lane:zone.lane,...b,blocked,income:supportsBridgeControl(game.ruleset)&&b.owner!==null&&!blocked?BRIDGE_CONTROL.totalIncome/game.map.lanes.length:0};
  });
}
export function bridgeIncome(game){
  const income=[0,0];for(const b of bridgeStatus(game))if(b.owner!==null)income[b.owner]+=b.income;return income;
}
export function bridgeSummary(game){
  if(supportsCampaignControl(game.ruleset))return bridgeStatus(game).map(b=>`Road ${b.lane+1}: ${b.owner===null?'unowned':b.owner===0?'yours':'enemy owned'}${b.blocked?', contested':''}${b.capturing!==null?`, ${b.capturing===0?'you':'enemy'} capturing (${b.progress.toFixed(1)} of 2 seconds)`:''}`).join('. ');
  return bridgeStatus(game).map(b=>`Road ${b.lane+1}: ${b.owner===null?'unowned':b.owner===0?'yours':'enemy owned'}${b.blocked?', payment stopped':''}${b.capturing!==null?`, ${b.capturing===0?'you':'enemy'} capturing (${b.progress.toFixed(1)} of 2 seconds)`:''}${b.owner!==null&&!b.blocked?', earning':''}`).join('. ');
}

/** Explicit extension admitted only by the two immutable bridge rulesets. */
export function validateBridgeControl(control,map,time,fail){
  const shape=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
  if(!shape(control,['bridges','earned'])||!Array.isArray(control.bridges)||control.bridges.length!==map.lanes.length)fail('invalid bridge control shape');
  for(const b of control.bridges){
    if(!shape(b,['owner','capturing','progress'])||![null,0,1].includes(b.owner)||![null,0,1].includes(b.capturing)||!Number.isFinite(b.progress)||b.progress<0||b.progress>=BRIDGE_CONTROL.captureSeconds||b.progress>time+1e-7)fail('invalid bridge capture');
    if((b.capturing===null)!==(b.progress===0)||b.capturing!==null&&b.capturing===b.owner)fail('inconsistent bridge capture');
    if(b.owner!==null&&time+1e-7<BRIDGE_CONTROL.captureSeconds)fail('bridge owned before capture is possible');
  }
  const cap=Math.max(0,time-BRIDGE_CONTROL.captureSeconds)*BRIDGE_CONTROL.totalIncome;
  if(!Array.isArray(control.earned)||control.earned.length!==2||[0,1].some(side=>!Number.isFinite(control.earned[side])||control.earned[side]<0||control.earned[side]>cap+1e-5)||control.earned[0]+control.earned[1]>cap+1e-5)fail('bridge earnings exceed the map-wide cap');
}


/** Campaign-only state. No economy fields or extensions to the published bridge schema. */
export const createCampaignControl = map => ({bridges:map.lanes.map(()=>({owner:null,capturing:null,progress:0})),heldSeconds:0});

/** Sampled positions apply for this simulation tick, as in Skirmish bridge control.
 * Each bridge contributes an eligible interval [capture boundary, dt]. The second
 * earliest start is when ANY TWO become eligible, including partial-tick captures.
 * Opposing presence immediately denies the owner, even during an aborted takeover.
 * Empty ownership persists. Only player route time accumulates; AI denies this goal.
 */
export function advanceCampaignControl(control,map,units,dt,unitTypes,rule=CAMPAIGN_CONTROL){
  if(!(dt>0)||!Number.isFinite(dt)||control.heldSeconds>=rule.seconds)return 0;
  const eligible=[];
  for(const zone of bridgeZones(map)){
    const b=control.bridges[zone.lane],{present,ground}=presence(zone,units,unitTypes);
    const candidate=ground[0]&&!present[1]?0:ground[1]&&!present[0]?1:null;
    let start=0;
    if(candidate!==null&&candidate!==b.owner){
      if(b.capturing!==candidate){b.capturing=candidate;b.progress=0;}
      const remaining=Math.max(0,BRIDGE_CONTROL.captureSeconds-b.progress);
      if(dt+1e-9>=remaining){b.owner=candidate;b.capturing=null;b.progress=0;start=Math.min(dt,remaining);}
      else {b.progress+=dt;start=dt;}
    }else {b.capturing=null;b.progress=0;}
    if(b.owner===0&&!present[1])eligible.push(start);
  }
  eligible.sort((a,b)=>a-b);
  const credit=eligible.length>=rule.requiredBridges?Math.max(0,dt-eligible[rule.requiredBridges-1]):0;
  const before=control.heldSeconds;
  control.heldSeconds=Math.min(rule.seconds,before+credit);
  // Deterministic floating-point cleanup only at the goal, not per-tick rounding.
  if(rule.seconds-control.heldSeconds<1e-9)control.heldSeconds=rule.seconds;
  return control.heldSeconds-before;
}
export function campaignControlStatus(game){
  if(!supportsCampaignControl(game.ruleset))return null;
  const rule=game.ruleset.campaignControl,seconds=game.state.campaignControl.heldSeconds;
  const count=bridgeStatus(game).filter(b=>b.owner===0&&!b.blocked).length;
  const complete=seconds>=rule.seconds;
  return {seconds,target:rule.seconds,count,required:rule.requiredBridges,complete,
    advancing:!complete&&game.state.winner===null&&game.state.bases.every(b=>b.hp>0)&&game.state.time+1e-7<rule.timeLimit&&count>=rule.requiredBridges};
}
/** A completed mission is terminal even though a control victory is not a core kill. */
export function campaignControlEnded(game){
  if(!supportsCampaignControl(game.ruleset))return false;
  return game.state.campaignControl.heldSeconds>=game.ruleset.campaignControl.seconds||game.state.time+1e-7>=game.ruleset.campaignControl.timeLimit||game.state.bases.some(b=>b.hp<=0);
}
export function validateCampaignControl(control,map,time,fail,rule=CAMPAIGN_CONTROL){
  if(!control||typeof control!=='object'||Array.isArray(control)||Object.keys(control).length!==2||!Object.hasOwn(control,'bridges')||!Object.hasOwn(control,'heldSeconds'))fail('invalid campaign control shape');
  if(map.id!=='classic'||map.revision!==1)fail('campaign control requires Classic');
  validateBridgeControl({bridges:control.bridges,earned:[0,0]},map,time,fail);
  if(!Number.isFinite(control.heldSeconds)||control.heldSeconds<0||control.heldSeconds>rule.seconds||control.heldSeconds>Math.max(0,time-BRIDGE_CONTROL.captureSeconds)+1e-7||time>rule.timeLimit+1e-7)fail('invalid campaign control time');
}
