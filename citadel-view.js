import { citadelOptionStatus } from './citadel-options.js';
export function skirmishRulesetId(endgame, bridges = false) {
  const suffix = endgame === 'frontier-air-local-timed' ? 'timed' : 'open';
  return `frontier-citadel-${bridges ? 'bridge-' : ''}${suffix}`;
}
export function citadelStatusText(game,side=0,{paused=false}={}) {
  const s=citadelOptionStatus(game,side);
  if(!s.enabled)return '';
  if(s.ended)return `${s.label || 'Citadel'} · battle ended.`;
  if(!s.choice)return s.canBuy?'Choose one option · 190 gold.':`Choose one option · ${s.reason}`;
  if(s.choice==='arrows')return `Extra Arrow · ${s.extraShots} extra shots fired. Needs a second enemy in range.`;
  const restored=`${Math.floor(s.healedTotal)} HP restored.`;
  if(s.blockedByDecay)return `Regeneration stopped during timed decay. ${restored}`;
  if(s.regenWait>0){
    const damaged=game.state.citadelOptions.sides[side].lastDamageAt;
    return `${damaged!==null&&damaged>=s.purchasedAt?'Regeneration interrupted':'Regeneration waiting'} · ${Math.ceil(s.regenWait)}s remaining. ${restored}`;
  }
  if(s.fullHealth)return `Regeneration · full health. ${restored}`;
  return `${paused?'Ready to recover':'Recovering'} · +3 HP/sec. ${restored}`;
}
