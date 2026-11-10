/** Immutable Last Engine identity and reviewed physical/combat constants. */
export const COLOSSUS_IDS = Object.freeze(['frontier-campaign-last-engine-r2']);
export const COLOSSUS = Object.freeze({
  name: 'The Last Engine', hp: 10000, damage: 140, range: 38, speed: 26,
  attackTime: 2.4, color: '#bf7752', radius: 210, flying: false,
  canAttackAir: true, canAttackGround: true,
  description: 'An enormous last weapon. All three roads can attack its body. It marches through defenders.'
});
export const ENCOUNTER = Object.freeze({triggerHp: 600, emergeTicks: 60, pulseRadius: 310, coreDamage: 1200, approachSpeed: 78, siegeBoundary: 1600});
