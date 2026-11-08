import { citadelOptionStatus } from './citadel-options.js';
import { FOG_SKIRMISH_RULESET_ID } from './fog.js';
export const fogSetupAllowed = (map, endgame, bridges = false) =>
  map === 'classic' && endgame === 'frontier-air-local-open' && !bridges;
export function skirmishRulesetId(endgame, bridges = false, fog = false) {
  if (fog) {
    if (!fogSetupAllowed('classic', endgame, bridges)) throw new Error('Fog requires Classic, open endgame and bridge income off.');
    return FOG_SKIRMISH_RULESET_ID;
  }
  const suffix = endgame === 'frontier-air-local-timed' ? 'timed' : 'open';
  return `frontier-citadel-${bridges ? 'bridge-' : ''}${suffix}`;
}
/** This formatter accepts only a detached observation, never a Game. */
export function observedEnemyCitadelText(view) {
  if (!view?.fog) throw new Error('A side observation is required.');
  const side = 1 - view.fog.side, base = view.state.bases[side];
  const visible = Number.isFinite(base.hp);
  const choice = visible ? view.state.citadelOptions?.sides?.[side]?.choice : view.fog.rememberedCitadel?.choice;
  const label = choice === 'arrows' ? 'Extra Arrow' : choice === 'regen' ? 'Regeneration' : null;
  if (!visible) return label
    ? `Scout the enemy citadel for its current health and upgrade (last seen: ${label}).`
    : 'Scout the enemy citadel to see its health and upgrade.';
  return `The enemy citadel has ${Math.ceil(base.hp)} / ${base.maxHp} HP ${label ? `with the ${label} upgrade` : 'with no upgrade observed'}.`;
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
