import { BUILDINGS, Game, SPELL, UNITS, upgradeCost } from './engine.js';

/** Read-only presentation data. This module never changes engine definitions. */
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/** Fixed, locale-independent formatting suitable for labels and screen readers. */
export function formatNumber(value, decimals = 2) {
  if (!Number.isFinite(value)) return '—';
  const precision = Number.isInteger(decimals) ? Math.max(0, Math.min(6, decimals)) : 2;
  return String(Number(value.toFixed(precision)));
}

export const formatSeconds = value => `${formatNumber(value)} s`;

// These mechanics are not engine exports. Executable codex tests pin them to
// actual combat/economy, so changes to either the rules or this copy must agree.
const RULES = freeze({
  archerVsWarrior: 0.55,
  warriorVsArcher: 1.35,
  archerVsAir: 1.5,
  gryphonVsStructure: 0.6,
  siegeVsStructure: 3,
  towerVsWarrior: 0.72,
  siegeSplash: 0.45,
  wizardSplash: 0.65,
  splashRadius: 64,
  towerAttackTime: 0.85,
  buildingTargetPadding: 35,
  firstSpawnSeconds: 1.2,
  unitLevelBonus: 0.12,
  productionLevelBonus: 0.22,
  buildingLevelBonus: 0.4,
  towerLevelBonus: 0.3,
  mineLevelBonus: 0.5,
  mineCap: 3,
  buildingCap: 24,
  unitCap: 70,
  maxLevel: 3,
  killBounty: 2,
  overtimeSeconds: 300,
  overtimeProduction: 1.65,
  overtimeStructureDamage: 1.75,
});

const num = formatNumber;
const percent = multiplier => `${num(multiplier * 100)}%`;
const upgradeCosts = type => [1, 2].map(level => upgradeCost({ type, level }));
const initial = new Game({ ai: false }).state;

const unitCopy = {
  warrior: {
    role: 'Shielded melee screen',
    silhouette: 'Helmet, broad shield and sword.',
    advantages: 'Absorbs archer fire and protects ranged troops. Extra damage against archers matters once it reaches them.',
    cautions: 'Cannot attack flyers. Wizard and siege hits bypass its arrow resistance; clustered warriors are exposed to ground splash.',
    mechanics: [
      `Takes ${percent(1 - RULES.archerVsWarrior)} less damage from archers: ${num(UNITS.archer.damage * RULES.archerVsWarrior)} per level-1 arrow.`,
      `Deals ${percent(RULES.warriorVsArcher - 1)} extra damage to archers: ${num(UNITS.warrior.damage * RULES.warriorVsArcher)} per level-1 hit.`,
      `Takes ${percent(1 - RULES.towerVsWarrior)} less damage from watchtowers. This reduction does not apply to citadel shots.`,
    ],
  },
  archer: {
    role: 'Ranged support and anti-air',
    silhouette: 'Hood and curved bow.',
    advantages: 'Shoots ground and air targets from behind a screen. Its anti-air bonus makes it useful against gryphons.',
    cautions: 'Low health and vulnerable to melee contact. Warrior shields reduce its arrows; splash can punish tightly packed archers.',
    mechanics: [
      `Deals ${percent(RULES.archerVsAir - 1)} extra damage to flyers: ${num(UNITS.archer.damage * RULES.archerVsAir)} per level-1 hit.`,
      `Deals only ${percent(RULES.archerVsWarrior)} of normal damage to warriors: ${num(UNITS.archer.damage * RULES.archerVsWarrior)} per level-1 hit.`,
    ],
  },
  siege: {
    role: 'Structure breaker and ground splash',
    silhouette: 'Wheeled wooden engine with a raised throwing arm.',
    advantages: 'Heavy structure damage. Can fire on a watchtower from outside its reach when no closer enemy draws its fire.',
    cautions: 'Slow movement and attacks. Cannot hit flyers and needs protection from troops that close the distance.',
    mechanics: [
      `Deals ${num(RULES.siegeVsStructure)}× damage to structures: ${num(UNITS.siege.damage * RULES.siegeVsStructure)} per level-1 hit before overtime.`,
      `Other enemy ground troops within ${num(RULES.splashRadius)} world units of the impact take ${percent(RULES.siegeSplash)} of troop damage: ${num(UNITS.siege.damage * RULES.siegeSplash)} at level 1. Flyers and other structures take no splash.`,
      `Building range is measured to an edge ${num(RULES.buildingTargetPadding)} world units from its center: ${num(UNITS.siege.range + RULES.buildingTargetPadding)} effective reach against a watchtower's ${num(BUILDINGS.watchtower.range)} center-based reach.`,
      'Structure and overtime bonuses do not increase splash damage.',
    ],
  },
  wizard: {
    role: 'Protected ground splash',
    silhouette: 'Pointed hat, long robe and glowing staff.',
    advantages: 'Full damage through warrior shields. Splash rewards keeping it behind a screen against clustered ground troops.',
    cautions: 'Cannot hit flyers. Archers have longer range and can focus it down; it is not a guaranteed archer counter.',
    mechanics: [
      `Hits a warrior for the full ${num(UNITS.wizard.damage)} damage at level 1; warrior arrow resistance does not apply.`,
      `Other enemy ground troops within ${num(RULES.splashRadius)} world units of the impact take ${percent(RULES.wizardSplash)} of troop damage: ${num(UNITS.wizard.damage * RULES.wizardSplash)} at level 1. Flyers and other structures take no splash.`,
      'Overtime structure damage does not increase splash damage.',
    ],
  },
  gryphon: {
    role: 'Flying raider',
    silhouette: 'Broad wings, hooked beak and a body held above its shadow.',
    advantages: 'Airborne: warriors, siege engines and wizards cannot target it. Attacks ground or air troops.',
    cautions: 'Archers receive an anti-air bonus. Watchtowers and citadels can also hit it. Reduced structure damage slows unsupported raids.',
    mechanics: [
      `Deals ${percent(RULES.gryphonVsStructure)} of normal damage to structures: ${num(UNITS.gryphon.damage * RULES.gryphonVsStructure)} per level-1 hit before overtime.`,
    ],
  },
};

/** Display order is intentional; portraitId is a Renderer.drawUnit unit type. */
export const UNIT_CODEX = freeze(Object.keys(unitCopy).map(id => {
  const unit = UNITS[id];
  const [buildingId, building] = Object.entries(BUILDINGS).find(([, value]) => value.unit === id);
  return {
    id, portraitId: id, name: unit.name, ...unitCopy[id],
    baseStats: {
      hp: unit.hp, damage: unit.damage, attackTime: unit.attackTime,
      range: unit.range, speed: unit.speed, flying: unit.flying,
      canAttackAir: unit.canAttackAir, canAttackGround: unit.canAttackGround,
    },
    production: {
      id: buildingId, name: building.name, cost: building.cost,
      hp: building.hp, spawnTime: building.spawnTime,
      upgradeCosts: upgradeCosts(buildingId),
    },
  };
}));

const mine = BUILDINGS.mint;
const tower = BUILDINGS.watchtower;
const mineLevels = [1, 2, 3].map(level => {
  const income = mine.income * (1 + RULES.mineLevelBonus * (level - 1));
  const marginalIncome = level === 1 ? income : mine.income * RULES.mineLevelBonus;
  const cost = level === 1 ? mine.cost : upgradeCost({ type: 'mint', level: level - 1 });
  return { level, income, marginalIncome, cost, bestCasePaybackSeconds: cost / marginalIncome };
});

/** Non-producing structures. Mine payback uses additional income only. */
export const STRUCTURE_CODEX = freeze([
  {
    id: 'watchtower', name: tower.name, role: 'Stationary defense',
    cost: tower.cost, hp: tower.hp, range: tower.range, damage: tower.damage,
    attackTime: RULES.towerAttackTime, upgradeCosts: upgradeCosts('watchtower'),
    advantages: 'Targets ground and air troops. Holds a position without waiting for reinforcements to walk there.',
    cautions: 'Produces no troops or income. Finite health and no map advance; a screened siege engine can break it from outside tower range.',
    mechanics: [
      `Level-1 arrows hit for ${num(tower.damage)} every ${formatSeconds(RULES.towerAttackTime)}; warriors take ${num(tower.damage * RULES.towerVsWarrior)}.`,
      `Range is ${num(tower.range)} world units measured from the tower's center.`,
    ],
  },
  {
    id: 'mint', name: mine.name, role: 'Vulnerable income investment',
    cost: mine.cost, hp: mine.hp, income: mine.income,
    upgradeCosts: upgradeCosts('mint'), levels: mineLevels,
    advantages: `Adds ${num(mine.income)} gold/s at level 1 without requiring troops to collect it.`,
    cautions: 'Cannot attack or produce troops. Gold spent here delays defense and production, and its income stops when destroyed or salvaged.',
    mechanics: [
      `Maximum ${RULES.mineCap} mines per side; each produces ${mineLevels.map(level => num(level.income)).join(' / ')} gold/s at levels 1 / 2 / 3.`,
      `New mine: ${mine.cost} gold ÷ ${num(mine.income)} additional gold/s = ${formatSeconds(mineLevels[0].bestCasePaybackSeconds)} best-case payback.`,
      `Level 2 upgrade: ${mineLevels[1].cost} gold ÷ ${num(mineLevels[1].marginalIncome)} additional gold/s = ${formatSeconds(mineLevels[1].bestCasePaybackSeconds)} best-case payback.`,
      `Level 3 upgrade: ${mineLevels[2].cost} gold ÷ ${num(mineLevels[2].marginalIncome)} additional gold/s = ${formatSeconds(mineLevels[2].bestCasePaybackSeconds)} best-case payback.`,
      'Payback is a mathematical best case assuming uninterrupted income. It ignores defense costs, destruction, lost tempo and salvage, and does not guarantee a good strategic choice.',
    ],
  },
]);

export const ECONOMY_GUIDE = freeze({
  scope: 'Level-1 skirmish baseline on Classic, before upgrades or overtime. Twin Span has a lower 16-building cap; other maps retain these limits. Campaigns and field trials can change starting gold, health, buildings and building levels; read their briefings.',
  counterCaveat: 'These are damage rules and useful matchups, not guaranteed wins. Numbers, range, positioning, level and supporting troops all matter.',
  startingGold: initial.gold[0],
  baseIncome: initial.income[0],
  citadelHp: initial.bases[0].maxHp,
  startingBuildings: initial.buildings.filter(building => building.side === 0).map(building => ({
    id: building.type, name: BUILDINGS[building.type].name, level: building.level,
  })),
  killBounty: RULES.killBounty,
  mineCap: RULES.mineCap,
  buildingCap: RULES.buildingCap,
  unitCap: RULES.unitCap,
  maxLevel: RULES.maxLevel,
  rallyStrike: { ...SPELL },
  notes: [
    `Both skirmish sides start with ${initial.gold[0]} spendable gold, ${num(initial.income[0])} gold/s and one free level-1 barracks. AI difficulty changes decisions, not prices or base income.`,
    `Defeating an enemy troop awards ${RULES.killBounty} gold. Structures award no kill gold.`,
    'Production buildings charge once, then create troops automatically without a per-troop gold cost.',
    `Spawn intervals are nominal repeat intervals. New level-1 producers have a head start: their first troop appears after about ${formatSeconds(RULES.firstSpawnSeconds)}.`,
    `Each side can field ${RULES.unitCap} living troops and ${RULES.buildingCap} buildings, including at most ${RULES.mineCap} mines. At the troop cap, production cycles can finish without spawning a troop.`,
    'Ranges and speeds use world units, not screen pixels. Attacks resolve on simulation ticks; listed cooldowns are nominal intervals, not a damage-per-second guarantee.',
    'Salvage returns half of total invested gold, scaled by remaining building health and rounded down. Protected campaign structures cannot be salvaged from the interface.',
  ],
  upgrades: [
    `Buildings reach level ${RULES.maxLevel}. The two listed upgrade prices are level 1 → 2 and level 2 → 3, paid separately.`,
    `Each level above 1 adds ${percent(RULES.buildingLevelBonus)} of base building health and increases production rate by ${percent(RULES.productionLevelBonus)} of the base rate.`,
    `New troops gain ${percent(RULES.unitLevelBonus)} of base health and damage per production-building level above 1. Existing troops keep their birth level; range, speed and attack cooldown do not improve.`,
    `Watchtowers gain ${percent(RULES.towerLevelBonus)} of base damage per level above 1. Mines gain ${percent(RULES.mineLevelBonus)} of base income per level above 1.`,
  ],
  overtime: {
    startSeconds: RULES.overtimeSeconds,
    productionMultiplier: RULES.overtimeProduction,
    unitStructureDamageMultiplier: RULES.overtimeStructureDamage,
    description: `At 5:00, production runs at ${num(RULES.overtimeProduction)}× its current rate and troops deal ${num(RULES.overtimeStructureDamage)}× damage to structures. Splash does not gain the structure bonus. Citadel retaliation also weakens; after 7:00 both citadels suffer escalating damage.`,
  },
});
