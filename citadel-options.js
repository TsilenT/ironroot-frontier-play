/** Immutable, one-purchase citadel choice contract for current battle identities. */
export const CITADEL_OPTIONS = Object.freeze({policy:'citadel-choice-v1',cost:190,readyAt:90,readyTick:1800,extraDamageMultiplier:0.5,regenRate:3,regenDelay:8});
export const CITADEL_OPTIONS_RULES_TEXT = 'Citadel choices: from 1:30, spend 190 gold once on Extra Arrow or Regeneration. Choose only one for this battle. Extra Arrow adds one half-damage shot at a different enemy in the existing range on each firing cycle (16 damage, then 9 after 5:00). Regeneration restores 3 HP/s after 8 seconds without citadel damage and after the purchase wait, up to normal maximum health. No instant heal. Regeneration stops while timed citadel decay is active. Both sides pay the same cost.';
export const CITADEL_RULES_TEXT = CITADEL_OPTIONS_RULES_TEXT;
export const CITADEL_AI_TEXT = 'The enemy checks at its normal decision times. If eligible and able to pay 190 gold, it chooses Extra Arrow with at least two enemies in citadel range; otherwise it considers Regeneration when missing at least 150 HP after 8 quiet seconds, before timed decay. It does not reserve gold or receive extra resources.';
export const supportsCitadelOptions = ruleset => ruleset?.citadel?.policy === CITADEL_OPTIONS.policy;
export const createCitadelOptions = () => ({sides:[0,1].map(()=>({choice:null,purchasedAt:null,purchasedTick:null,lastDamageAt:null,healedTotal:0,extraShots:0}))});
const validSide = side => side === 0 || side === 1;
const remainingWait = value => value<=1e-8?0:value;
const readyWait = game => remainingWait(Math.max(0,CITADEL_OPTIONS.readyAt-game.state.time,(CITADEL_OPTIONS.readyTick-game.tick)*0.05));
const quietWait = (game,record) => record.lastDamageAt === null ? 0 : remainingWait(Math.max(0,record.lastDamageAt+CITADEL_OPTIONS.regenDelay-game.state.time));
export function canBuyCitadelOption(game,kind,side=0){
  const no=(code,reason)=>({ok:false,code,reason});
  if(!supportsCitadelOptions(game.ruleset))return no('citadel-disabled','Citadel choices are not enabled for this battle.');
  if(!validSide(side)||!['arrows','regen'].includes(kind))return no('invalid-citadel-choice','Choose Extra Arrow or Regeneration for your citadel.');
  if(game.limitReason)return no('save-safety-limit',game.limitReason);
  if(game.state.winner!==null||game.state.bases.some(b=>b.hp<=0))return no('battle-ended','The battle has ended.');
  if(game.state.citadelOptions.sides[side].choice!==null)return no('citadel-already-chosen','This citadel already has its one choice for this battle.');
  if(game.tick<CITADEL_OPTIONS.readyTick||game.state.time<CITADEL_OPTIONS.readyAt-1e-8)return no('citadel-too-early',`Available in ${Math.ceil(readyWait(game))}s, at 1:30 battle time.`);
  if(game.state.gold[side]<CITADEL_OPTIONS.cost)return no('insufficient-gold',`Need ${CITADEL_OPTIONS.cost} gold.`);
  return {ok:true,cost:CITADEL_OPTIONS.cost,reason:'Ready: choose one citadel option for 190 gold.'};
}
export function buyCitadelOption(game,kind,side=0){
  const result=canBuyCitadelOption(game,kind,side);if(!result.ok)return result;
  const record=game.state.citadelOptions.sides[side];
  game.state.gold[side]-=CITADEL_OPTIONS.cost;record.choice=kind;record.purchasedAt=game.state.time;record.purchasedTick=game.tick;
  // Preserve last damage and the ordinary firing cooldown. No heal or shot here.
  return {...result,reason:kind==='arrows'?'Extra Arrow chosen. It needs a different second target.':'Regeneration chosen. Its 8-second purchase wait has started.'};
}
export function citadelOptionStatus(game,side=0){
  const enabled=supportsCitadelOptions(game?.ruleset)&&validSide(side),record=enabled?game.state.citadelOptions.sides[side]:null;
  const choice=record?.choice??null,base=game?.state?.bases?.[side],ended=game?.state?.winner!==null||!base||game.state.bases.some(b=>b.hp<=0);
  const decayActive=!!game?.ruleset?.endgame?.forcedDecay&&game.state.time>420;
  const wait=choice==='regen'?remainingWait(Math.max(0,Math.max(record.purchasedAt,record.lastDamageAt??0)+CITADEL_OPTIONS.regenDelay-game.state.time)):0;
  const availability=enabled?canBuyCitadelOption(game,'arrows',side):{ok:false,code:'citadel-disabled',reason:'Citadel choices are not enabled for this battle.'};
  return {enabled,choice,label:choice==='arrows'?'Extra Arrow':choice==='regen'?'Regeneration':'No choice yet',cost:CITADEL_OPTIONS.cost,
    readyWait:enabled?readyWait(game):0,regenWait:wait,quietWait:record?quietWait(game,record):0,
    healingActive:enabled&&choice==='regen'&&!ended&&!decayActive&&!game.limitReason&&wait<=1e-8&&base.hp<base.maxHp,
    healedTotal:record?.healedTotal??0,extraShots:record?.extraShots??0,purchasedAt:record?.purchasedAt??null,
    canBuy:availability.ok,code:availability.code??null,reason:availability.reason,blockedByDecay:decayActive,decayActive,ended,fullHealth:!!base&&base.hp>=base.maxHp};
}
export function advanceCitadelRegeneration(game,dt){
  if(!supportsCitadelOptions(game.ruleset)||game.state.winner!==null||game.state.bases.some(b=>b.hp<=0)||(game.ruleset.endgame.forcedDecay&&game.state.time>420))return;
  for(const side of [0,1]){
    const record=game.state.citadelOptions.sides[side],base=game.state.bases[side];
    if(record.choice!=='regen')continue;
    const start=Math.max(record.purchasedAt,record.lastDamageAt??0)+CITADEL_OPTIONS.regenDelay;
    // Heal only a complete fixed step that starts after the quiet/purchase wait.
    if(game.state.time-dt<start-1e-8)continue;
    const missing=base.maxHp-base.hp,step=CITADEL_OPTIONS.regenRate*dt;
    const amount=missing<=step+1e-8?missing:step;
    base.hp+=amount;record.healedTotal+=amount;
  }
}
export function chooseAICitadelOption(game,side){
  if(!canBuyCitadelOption(game,'arrows',side).ok)return null;
  const base=game.state.bases[side],nearby=game.state.units.filter(u=>u.side!==side&&u.hp>0&&Math.hypot(u.x-base.x,u.y-base.y)<310);
  if(nearby.length>=2)return 'arrows';
  const record=game.state.citadelOptions.sides[side];
  if(base.maxHp-base.hp>=150&&quietWait(game,record)<=1e-8&&!(game.ruleset.endgame.forcedDecay&&game.state.time>420))return 'regen';
  return null;
}
export function validateCitadelOptions(control,time,tick,fail){
  const shape=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
  const number=(n,min,max)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
  if(!shape(control,['sides'])||!Array.isArray(control.sides)||control.sides.length!==2)fail('invalid citadel choices');
  for(const r of control.sides){
    if(!shape(r,['choice','purchasedAt','purchasedTick','lastDamageAt','healedTotal','extraShots'])||![null,'arrows','regen'].includes(r.choice))fail('invalid citadel choice shape');
    if(r.lastDamageAt!==null&&!number(r.lastDamageAt,0,time))fail('invalid citadel damage time');
    if(!number(r.healedTotal,0,3*Math.max(0,time-98)+1e-5)||!Number.isSafeInteger(r.extraShots)||r.extraShots<0)fail('invalid citadel counters');
    if(r.choice===null){if(r.purchasedAt!==null||r.purchasedTick!==null||r.healedTotal!==0||r.extraShots!==0)fail('unchosen citadel has purchase or effect data');continue;}
    if(!number(r.purchasedAt,90-1e-8,time)||!Number.isSafeInteger(r.purchasedTick)||r.purchasedTick<1800||r.purchasedTick>tick||Math.abs(r.purchasedAt-r.purchasedTick*.05)>.01)fail('invalid citadel purchase time');
    if(r.choice==='arrows'&&(r.healedTotal!==0||r.extraShots>Math.floor(Math.max(0,time-r.purchasedAt)/1.15+1e-5)+1))fail('invalid extra-arrow counters');
    if(r.choice==='regen'&&(r.extraShots!==0||r.healedTotal>3*Math.max(0,time-r.purchasedAt-8)+1e-5))fail('invalid regeneration counters');
  }
}
