/** Post-contact presentation only. The engine has already applied the hit. */
export const COMBAT_FEEDBACK_TIMERS = Object.freeze({ attack: 0.22, hit: 0.16 });

const remaining = (value, duration) =>
  Number.isFinite(value) ? Math.max(0, Math.min(1, value / duration)) : 0;
const settle = amount => amount * amount * (3 - 2 * amount);

/**
 * No clocks, random state, retained events, or simulated windup. A fresh timer
 * starts at contact/recoil and settles monotonically to the unchanged idle art.
 * A hit takes pose priority, as it does for Rootwarden; attacks are never queued.
 * Reduced motion holds one useful pose for each live state, without oscillation.
 */
export function sampleCombatFeedback(unit, reducedMotion = false) {
  const hit = remaining(unit?.hit, COMBAT_FEEDBACK_TIMERS.hit);
  const attack = remaining(unit?.attack, COMBAT_FEEDBACK_TIMERS.attack);
  return {
    state: hit > 0 ? 'hit' : attack > 0 ? 'contact' : 'idle',
    contact: hit > 0 ? 0 : reducedMotion && attack > 0 ? 0.7 : settle(attack),
    recoil: reducedMotion && hit > 0 ? 0.7 : settle(hit),
  };
}
