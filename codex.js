import { BUILDINGS as LEGACY_BUILDINGS, Game, SPELL, UNITS as LEGACY_UNITS, upgradeCost as legacyUpgradeCost, supportsAutonomousAir } from './engine.js';

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
/** Build a frozen catalogue for one game or immutable ruleset; defaults stay legacy. */
export function createCodex(context = null) {
  const ruleset = context?.ruleset || (context?.units && context?.buildings ? context : null);
  const baseline = new Game({ ai: false, ...(ruleset ? { rulesetId: ruleset.id, rulesetRevision: ruleset.revision } : {}), ...(context?.map ? { mapId: context.map.id, mapRevision: context.map.revision } : {}) });
  const UNITS = baseline.units || LEGACY_UNITS;
  const BUILDINGS = baseline.buildings || LEGACY_BUILDINGS;
  const upgradeCost = building => baseline.upgradeCost ? baseline.upgradeCost(building) : legacyUpgradeCost(building);
  const upgradeCosts = type => [1, 2].map(level => upgradeCost({ type, level }));
  const initial = baseline.state;
  const buildingCap = baseline.map.buildLimit;
  const endgame = baseline.ruleset?.endgame;
  const automaticAir = supportsAutonomousAir(baseline.ruleset);

  const unitCopy = {
    get warrior() { return {
      role: 'Shielded melee screen',
      silhouette: 'Helmet, broad shield and sword.',
      advantages: 'Shields ranged troops from archer fire and deals extra damage to enemy archers once it reaches them.',
      cautions: 'Wizard and siege hits ignore arrow resistance and can splash onto clustered warriors; flyers are also beyond a warrior’s reach.',
      mechanics: [
        `Takes ${percent(1 - RULES.archerVsWarrior)} less damage from archers: ${num(UNITS.archer.damage * RULES.archerVsWarrior)} per level-1 arrow.`,
        `Deals ${percent(RULES.warriorVsArcher - 1)} extra damage to archers: ${num(UNITS.warrior.damage * RULES.warriorVsArcher)} per level-1 hit.`,
        `Takes ${percent(1 - RULES.towerVsWarrior)} less damage from watchtowers. This reduction does not apply to citadel shots.`,
      ],
    }; },
    get archer() { return {
      role: 'Ranged support and anti-air',
      silhouette: 'Hood and curved bow.',
      advantages: 'Shoots both ground and air targets from behind a screen, with bonus damage against gryphons.',
      cautions: 'Keep archers spread out and clear of close attackers; their low health makes them vulnerable, and warrior shields reduce their arrow damage.',
      mechanics: [
        `Deals ${percent(RULES.archerVsAir - 1)} extra damage to flyers: ${num(UNITS.archer.damage * RULES.archerVsAir)} per level-1 hit.`,
        `Deals only ${percent(RULES.archerVsWarrior)} of normal damage to warriors: ${num(UNITS.archer.damage * RULES.archerVsWarrior)} per level-1 hit.`,
        ...(automaticAir ? ['Archers stay on their road, but can shoot a flyer between roads when it comes within range.'] : []),
      ],
    }; },
    get siege() { return {
      role: 'Structure breaker and ground splash',
      silhouette: 'Wheeled wooden engine with a raised throwing arm.',
      advantages: 'Can fire on a watchtower from beyond its reach for heavy structure damage, provided no closer enemy draws its fire.',
      cautions: 'Keep other troops ahead of this slow-moving, slow-firing engine to block enemies that get close; it cannot hit flyers.',
      mechanics: [
        `Deals ${num(RULES.siegeVsStructure)}× damage to structures: ${num(UNITS.siege.damage * RULES.siegeVsStructure)} per level-1 hit before overtime.`,
        `Other enemy ground troops within ${num(RULES.splashRadius)} world units of the impact take ${percent(RULES.siegeSplash)} of troop damage: ${num(UNITS.siege.damage * RULES.siegeSplash)} at level 1. Flyers and other structures take no splash.`,
        `Building range is measured to an edge ${num(RULES.buildingTargetPadding)} world units from its center: ${num(UNITS.siege.range + RULES.buildingTargetPadding)} effective reach against a watchtower's ${num(BUILDINGS.watchtower.range)} center-based reach.`,
        'Structure and overtime bonuses do not increase splash damage.',
      ],
    }; },
    get wizard() { return {
      role: 'Protected ground splash',
      silhouette: 'Pointed hat, long robe and glowing staff.',
      advantages: 'From behind other troops, a wizard can hit groups of enemies with splash damage and deal full damage through warrior shields.',
      cautions: 'Archers outrange the wizard and can kill it before it gets close enough to fire, and flyers are beyond its reach altogether.',
      mechanics: [
        `Hits a warrior for the full ${num(UNITS.wizard.damage)} damage at level 1; warrior arrow resistance does not apply.`,
        `Other enemy ground troops within ${num(RULES.splashRadius)} world units of the impact take ${percent(RULES.wizardSplash)} of troop damage: ${num(UNITS.wizard.damage * RULES.wizardSplash)} at level 1. Flyers and other structures take no splash.`,
        'Overtime structure damage does not increase splash damage.',
      ],
    }; },
    get rootwarden() { return {
      role: 'High-health, low-damage ground screen',
      silhouette: 'Broad wooden shield, rooted feet and a leaf-crested hood.',
      advantages: 'High health buys time for ranged support, though its slower damage makes it an alternative to warriors rather than a replacement for every matchup.',
      cautions: 'A Rootwarden relies on health rather than armor or arrow resistance and cannot hit flyers. Arrow volleys and ground splash can still hit archers behind it.',
      mechanics: [
        'Takes full damage from archers and watchtowers; its durability comes from health, not armor.',
        'Deals single-target melee damage to ground troops and structures. It has no projectile, splash or anti-air attack.',
      ],
    }; },
    get gryphon() { return {
      role: 'Flying raider',
      silhouette: 'Broad wings, hooked beak and a body held above its shadow.',
      advantages: automaticAir
        ? 'Seeks nearby enemies on its own, including troops on an adjacent road, while staying out of reach of warriors, siege engines and wizards.'
        : 'Attacks ground and air troops while flying out of reach of warriors, siege engines and wizards.',
      cautions: 'Bring support when attacking buildings: gryphons deal reduced structure damage, archers have an anti-air bonus, and watchtowers and citadels can also hit them.',
      mechanics: [
        `Deals ${percent(RULES.gryphonVsStructure)} of normal damage to structures: ${num(UNITS.gryphon.damage * RULES.gryphonVsStructure)} per level-1 hit before overtime.`,
        ...(automaticAir ? [
          `Notices troops within ${num(baseline.ruleset.movement.autonomousAir.perception)} world units on its current or a neighboring road, then flies into its normal ${num(UNITS.gryphon.range)} attack range.`,
          `Keeps pursuing a living nearby target up to ${num(baseline.ruleset.movement.autonomousAir.retention)} world units away; after losing it, seeks another nearby enemy or advances along the nearest road.`,
          'A detour can reach an exposed enemy or draw the gryphon away from the army it was supporting; archers and towers can hit it throughout the flight.',
        ] : []),
      ],
    }; },
  };

  /** Display order is intentional; portraitId is a Renderer.drawUnit unit type. */
  const UNIT_CODEX = freeze(Object.keys(UNITS).map(id => {
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
  const mineLevels = mine ? [1, 2, 3].map(level => {
    const income = mine.income * (1 + RULES.mineLevelBonus * (level - 1));
    const marginalIncome = level === 1 ? income : mine.income * RULES.mineLevelBonus;
    const cost = level === 1 ? mine.cost : upgradeCost({ type: 'mint', level: level - 1 });
    return { level, income, marginalIncome, cost, bestCasePaybackSeconds: cost / marginalIncome };
  }) : [];

  /** Non-producing structures. Mine payback uses additional income only. */
  const STRUCTURE_CODEX = freeze([
    ...(tower ? [{
      id: 'watchtower', name: tower.name, role: 'Stationary defense',
      cost: tower.cost, hp: tower.hp, range: tower.range, damage: tower.damage,
      attackTime: RULES.towerAttackTime, upgradeCosts: upgradeCosts('watchtower'),
      advantages: 'Holds a position against ground and air troops without waiting for reinforcements to walk there.',
      cautions: 'An immobile defense that produces no troops or income, and can fall to a screened siege engine firing from beyond its range.',
      mechanics: [
        `Level-1 arrows hit for ${num(tower.damage)} every ${formatSeconds(RULES.towerAttackTime)}; warriors take ${num(tower.damage * RULES.towerVsWarrior)}.`,
        `Range is ${num(tower.range)} world units measured from the tower's center.`,
      ],
    }] : []),
    ...(mine ? [{
      id: 'mint', name: mine.name, role: 'Gold income',
      cost: mine.cost, hp: mine.hp, income: mine.income,
      upgradeCosts: upgradeCosts('mint'), levels: mineLevels,
      advantages: `Adds ${num(mine.income)} gold/s at level 1 automatically.`,
      cautions: 'Mine spending leaves less gold for troops and defense, and the mine cannot attack or train troops itself. Its income stops if it is destroyed or salvaged.',
      mechanics: [
        `Maximum ${RULES.mineCap} mines per side; each produces ${mineLevels.map(level => num(level.income)).join(' / ')} gold/s at levels 1 / 2 / 3.`,
        `New mine: ${mine.cost} gold ÷ ${num(mine.income)} additional gold/s = ${formatSeconds(mineLevels[0].bestCasePaybackSeconds)} best-case payback.`,
        `Level 2 upgrade: ${mineLevels[1].cost} gold ÷ ${num(mineLevels[1].marginalIncome)} additional gold/s = ${formatSeconds(mineLevels[1].bestCasePaybackSeconds)} best-case payback.`,
        `Level 3 upgrade: ${mineLevels[2].cost} gold ÷ ${num(mineLevels[2].marginalIncome)} additional gold/s = ${formatSeconds(mineLevels[2].bestCasePaybackSeconds)} best-case payback.`,
        'These payback times assume the mine keeps working. They exclude defense costs, destruction and salvage. Consider whether you need troops sooner.',
      ],
    }] : []),
  ]);

  const ECONOMY_GUIDE = freeze({
    scope: baseline.ruleset.campaignOnly ? `Level-1 reference for this campaign roster, before upgrades. This battlefield allows ${buildingCap} buildings per side. Starting resources and forces come from the mission briefing, not the reference values below.` : context?.map ? `Level-1 skirmish baseline on ${baseline.map.name}, before upgrades or overtime. This map allows ${buildingCap} buildings per side. Campaigns and field trials can change starting gold, health, buildings and building levels; read their briefings.` : 'Level-1 skirmish baseline on Classic, before upgrades or overtime. Twin Span has a lower 16-building cap; other maps retain these limits. Campaigns and field trials can change starting gold, health, buildings and building levels; read their briefings.',
    counterCaveat: 'These matchups help you choose troops. Army size, range, position, upgrades and support can still decide the fight.',
    startingGoldLabel: baseline.ruleset.campaignOnly ? 'Reference gold' : 'Starting gold',
    startingGold: initial.gold[0],
    baseIncome: initial.income[0],
    citadelHp: initial.bases[0].maxHp,
    startingBuildings: initial.buildings.filter(building => building.side === 0).map(building => ({
      id: building.type, name: BUILDINGS[building.type].name, level: building.level,
    })),
    killBounty: RULES.killBounty,
    mineCap: mine ? RULES.mineCap : 0,
    buildingCap,
    unitCap: RULES.unitCap,
    maxLevel: RULES.maxLevel,
    rallyStrike: { ...SPELL },
    notes: [
      baseline.ruleset.campaignOnly ? `Gold arrives at ${num(initial.income[0])} per second before working mines. Your mission briefing gives the actual starting gold and forces.` : `Both sides start a skirmish with ${initial.gold[0]} gold, ${num(initial.income[0])} gold/s and one free level-1 barracks. AI difficulty changes decisions, not prices or base income.`,
      `Defeating an enemy troop awards ${RULES.killBounty} gold. Structures award no kill gold.`,
      'Pay once for a troop building that keeps training troops automatically at no extra gold cost.',
      `Training intervals show the usual time between troops. A new level-1 building trains its first troop sooner, after about ${formatSeconds(RULES.firstSpawnSeconds)}.`,
      `Each side can field ${RULES.unitCap} living troops and ${buildingCap} buildings, ${mine ? 'including at most ' + RULES.mineCap + ' mines' : 'with no gold mines available in this roster'}. At the troop cap, a training cycle can finish without adding a troop.`,
      'Range and speed use world units regardless of screen size. Since attacks happen on game ticks, listed cooldowns are approximate and do not guarantee damage per second.',
      'Salvage returns half of total invested gold, scaled by remaining building health and rounded down. You cannot salvage protected campaign buildings.',
    ],
    upgrades: [
      `Buildings reach level ${RULES.maxLevel}. The two listed upgrade prices are level 1 → 2 and level 2 → 3, paid separately.`,
      `Each level above 1 adds ${percent(RULES.buildingLevelBonus)} of base building health and increases production rate by ${percent(RULES.productionLevelBonus)} of the base rate.`,
      `New troops gain ${percent(RULES.unitLevelBonus)} of base health and damage per production-building level above 1. Existing troops keep their original level. Upgrades do not change range, speed or attack cooldown.`,
      ...(tower && mine ? [`Watchtowers gain ${percent(RULES.towerLevelBonus)} of base damage per level above 1. Mines gain ${percent(RULES.mineLevelBonus)} of base income per level above 1.`] : []),
    ],
    overtime: {
      startSeconds: endgame?.escalationAt ?? RULES.overtimeSeconds,
      productionMultiplier: endgame?.productionMultiplier ?? RULES.overtimeProduction,
      unitStructureDamageMultiplier: endgame?.structureDamageMultiplier ?? RULES.overtimeStructureDamage,
      forcedDecay: endgame?.forcedDecay ?? true,
      decayAt: endgame?.decayAt ?? null,
      description: `At 5:00, production runs at ${num(RULES.overtimeProduction)}× its current rate and troops deal ${num(RULES.overtimeStructureDamage)}× damage to structures. Splash does not gain the structure bonus. Citadel retaliation also weakens; ${endgame?.forcedDecay === false ? 'this open-ended ruleset has no automatic citadel decay.' : 'after 7:00 both citadels suffer escalating damage.'}`,
    },
  });

  return freeze({ UNIT_CODEX, STRUCTURE_CODEX, ECONOMY_GUIDE });
}

// Compatibility exports intentionally describe only the released legacy roster.
export const { UNIT_CODEX, STRUCTURE_CODEX, ECONOMY_GUIDE } = createCodex();
