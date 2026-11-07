import { BUILDINGS, buildSites } from './engine.js';
import { currentIncome } from './campaign.js';

// Presentation only: no technology locks or new fields in campaign/battle saves.
// Optional opening missions use smaller presentation defaults.
// It does not define mission IDs, rulesets, maps, or technology availability.
export const CAMPAIGN_BUILD_INTRODUCTIONS = Object.freeze({
  'first-watch': ['barracks', 'archery'],
  'forked-road': ['barracks', 'archery', 'watchtower', 'mint'],
});
for (const choices of Object.values(CAMPAIGN_BUILD_INTRODUCTIONS)) Object.freeze(choices);

export function campaignBuildChoices(id, { expanded = false, resumed = false, buildings = BUILDINGS } = {}) {
  const available = Object.keys(buildings);
  return !expanded && !resumed && Object.hasOwn(CAMPAIGN_BUILD_INTRODUCTIONS, id)
    ? CAMPAIGN_BUILD_INTRODUCTIONS[id].filter(type => Object.hasOwn(buildings, type))
    : available;
}

export function guidancePointVisible(renderer, game, point) {
  if (!point) return false;
  const x = renderer.width / 2 + (point.x - renderer.camera) * renderer.scale;
  const y = renderer.height / 2 + (point.y + 18 - game.map.height / 2) * renderer.scale;
  const rx = 67 * renderer.scale, ry = 37 * renderer.scale;
  return x - rx >= 0 && x + rx <= renderer.width && y - ry >= 0 && y + ry <= renderer.height;
}

/** Draw only a suggestion over the normal renderer; the engine stays unchanged. */
export function drawCampaignGuidance(renderer, game, ui) {
  const point = ui.coachSite || game.state.buildings.find(b => b.id === ui.coachBuilding && b.hp > 0);
  if (!point || !guidancePointVisible(renderer, game, point)) return;
  const { c, dpr, width, height, scale, camera } = renderer;
  c.save();
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.strokeStyle = '#ffe2a0';
  c.lineWidth = Math.max(2, 4 * scale);
  c.beginPath();
  c.ellipse(width / 2 + (point.x - camera) * scale, height / 2 + (point.y + 18 - game.map.height / 2) * scale,
    67 * scale, 37 * scale, 0, 0, Math.PI * 2);
  c.stroke();
  c.restore();
}

/** Fresh openings pause for teaching, never for a mid-battle hint.
 * Roadside Watch enters building directly and starts after its first paid barracks.
 * UI-only state: restored saves and completed replays run normally. */
export function campaignTeaching(id, { resumed = false, completed = false, learnedBasics = false, flightOrders = false } = {}) {
  if (resumed || completed) return null;
  if (flightOrders && ['wings-of-ash', 'stonegate'].includes(id)) return {
    title: id === 'wings-of-ash' ? 'Take control of the sky' : 'Find a way past the towers',
    text: (id === 'wings-of-ash' ? 'Archers can stop the veteran flyers. ' : 'Siege can break the middle defenses. ') +
      'If you build an aerie, select it to send future gryphons to an adjacent road. They give a two-second warning before crossing and cannot attack while changing roads. Holding their road may protect the troops below. Plan your approach, then start when ready.',
  };
  const lessons = {
    'roadside-watch': ['Build your first army', 'One road, two choices. Choose Barracks in the build bar, then a green site. An archery range behind the barracks adds ranged support. Spend what you want, then start the battle.'],
    'shield-at-the-fork': ['Plan for both roads', 'Warden lodges, gold mines and watchtowers have joined the company. Rootwardens take hits but deal little damage. Add archers behind their lodge, and keep troops on the other road. Towers belong ahead of production; mines belong toward the rear.'],
    'open-three-roads': ['Choose a force for each road', 'All eight buildings are available. Archers can hit the northern gryphons; Rootwardens cannot. Siege can reach the middle tower, but needs troops ahead of it. Keep a force on the south road too. Choose your own route.'],
    'first-watch': ['Build your first army', 'Choose Barracks, then a green site on the road. Warriors march and fight on their own. Add an archery range behind them for support.'],
    'forked-road': ['Plan for both roads', 'Each road needs troops. Mines fund later reinforcements; towers defend nearby ground but cannot march to the enemy camps.'],
    'emberwatch': ['Add ranged support', 'Your barracks is already built. An archery range behind it adds support while warriors advance.'],
    'three-roads': ['Defense and attack', 'A tower can hold nearby ground. Place it ahead of your troop buildings, and send troops down both outer roads to clear the marked camps.'],
    'winter-stores': ['Fund the relief', 'Keep both marked mines standing. Add income and upgrade mines to reach the goal; leave gold for troops to defend them.'],
  };
  if (!Object.hasOwn(lessons, id) || (id === 'emberwatch' && learnedBasics)) return null;
  return { title: lessons[id][0], text: lessons[id][1],
    ...(id === 'roadside-watch' ? { startAfterBuild: 'barracks' } : {}) };
}

/** Paid, engine-valid suggestions. A tower needs forward coverage; if that is
 * unavailable, explain it instead of silently highlighting a rear site. */
export function recommendCampaignSite(game, type, preferredLane = null) {
  const definitions = game.buildings || BUILDINGS;
  if (!Object.hasOwn(definitions, type)) return { reason: 'This building is unavailable in this battle.' };
  const own = game.state.buildings.filter(b => b.side === 0 && b.hp > 0);
  const enemies = game.state.buildings.filter(b => b.side === 1 && b.hp > 0);
  const middle = Math.floor(game.map.lanes.length / 2);
  const lanes = game.map.lanes.map((_, lane) => {
    const producers = own.filter(b => b.lane === lane && definitions[b.type]?.unit);
    const front = Math.max(0, ...producers.map(b => b.x));
    const pressure = game.state.units.filter(u => u.side === 1 && u.hp > 0 && u.lane === lane)
      .reduce((n, u) => n + Math.max(0, 2 - u.x / 1320), 0);
    const threat = enemies.filter(b => b.lane === lane && definitions[b.type]?.unit).length;
    return { lane, front, pressure, threat, producers };
  });
  const laneOrder = [...lanes].sort((a, b) =>
    preferredLane !== null ? Math.abs(a.lane - preferredLane) - Math.abs(b.lane - preferredLane) :
    type === 'watchtower' ? b.pressure - a.pressure || b.threat - a.threat || b.producers.length - a.producers.length || Math.abs(a.lane-middle)-Math.abs(b.lane-middle) :
    type === 'mint' ? b.producers.length - a.producers.length || a.pressure - b.pressure || Math.abs(a.lane-middle)-Math.abs(b.lane-middle) :
    Math.abs(a.lane-middle)-Math.abs(b.lane-middle));
  const legal = buildSites(game.map, 0).filter(p => game.canBuild(type, p.x, p.y).ok);
  if (!legal.length) return { reason: game.state.gold[0] < definitions[type].cost
    ? `You need ${definitions[type].cost} gold. Choose an affordable building, or earn more income.`
    : 'No legal site is available for this building. Check the mine/building limit, upgrade, or choose another type.' };
  for (const lane of laneOrder) {
    let sites = legal.filter(p => p.lane === lane.lane);
    const support = ['archery', 'foundry', 'sanctum'].includes(type);
    const anchor = lane.producers.filter(b => b.type === 'barracks' || b.type === 'wardenLodge')
      .sort((a,b) => b.x-a.x)[0];
    let preferredX = 970, explanation = 'A forward troop building shortens the march; leave room ahead for defense.';
    if (type === 'watchtower') {
      sites = sites.filter(p => p.x > lane.front && p.x >= (lane.front ? lane.front + 108 : 970));
      preferredX = Math.max(970, lane.front + 140);
      explanation = lane.front ? 'Ahead of your troop buildings, this tower can intercept enemies before they reach production.'
        : 'This forward tower defends nearby ground. Add troops on this road to push toward the enemy.';
    } else if (type === 'mint') {
      preferredX = 270;
      explanation = 'A rear mine leaves forward sites for troops and defense. It still needs protection.';
    } else if (support && anchor) {
      sites = sites.filter(p => p.x < anchor.x);
      preferredX = anchor.x - 140;
      explanation = 'Behind your frontline producer, reinforcements have a chance to form up behind its troops.';
    }
    if (support && !anchor) explanation = 'There is no barracks or Warden lodge ahead on this road yet. Add a frontline producer ahead if these troops need a screen.';
    if (!sites.length) continue;
    const danger = p => game.state.units.filter(u => u.side === 1 && u.hp > 0 && u.lane === p.lane && Math.abs(u.x-p.x) < 240).length;
    sites.sort((a,b) => danger(a)-danger(b) || Math.abs(a.x-preferredX)-Math.abs(b.x-preferredX) || a.x-b.x);
    const site = sites[0];
    const road = game.map.lanes.length === 1 ? 'the road' : `${['first', 'second', 'third'][site.lane]} road`;
    if (preferredLane !== null && site.lane !== preferredLane) explanation = `The requested road has no suitable free site. This is on the ${road}. ` + explanation;
    if (danger(site)) explanation += ' Enemies are already close: this placement is exposed.';
    return { site, explanation, road };
  }
  return { reason: type === 'watchtower'
    ? 'No free forward tower site remains. A rear tower only guards a fallback line; choose one yourself, upgrade, or use troops instead.'
    : 'No free site remains behind your frontline producer. Choose another road or place support yourself, accepting a more exposed position.' };
}

/** Infer hints from the real battle, including after a reload. Never mutate it. */
export function campaignCoach(game, id, choice = {}) {
  if (!['roadside-watch','shield-at-the-fork','open-three-roads','first-watch','forked-road','emberwatch','three-roads','winter-stores','wings-of-ash','stonegate'].includes(id)) return null;
  const definitions = game.buildings || BUILDINGS;
  const own = game.state.buildings.filter(b => b.side === 0 && b.hp > 0);
  const build = (type, title, text, preferredLane = null) => {
    const recommendation = recommendCampaignSite(game, type, preferredLane);
    const selected = choice.build === type;
    return { key: `build-${type}`, buildType: type, preferredLane, title,
      text: selected ? (recommendation.site
        ? `The gold ring suggests ${recommendation.road}. ${recommendation.explanation} Other green sites remain available.`
        : recommendation.reason) : text,
      control: `[data-type="${type}"]`, site: selected ? recommendation.site : null };
  };
  const goal = () => {
    if (id === 'first-watch' || id === 'roadside-watch') {
      if (!own.some(b => b.type === 'barracks'))
        return build('barracks', 'Build a barracks', 'Choose Barracks, then a green site. Warriors will march out on their own.');
      if (!own.some(b => b.type === 'archery'))
        return build('archery', 'Add archers', 'Choose Archery and place it behind your barracks. Archers fire from behind your warriors.');
      return { key: 'front', title: 'Follow your army', text: 'Use Front to follow your troops. Clear the marked enemy barracks to win.', control: '#front' };
    }
    if (id === 'shield-at-the-fork') {
      if (!own.some(b => b.type === 'wardenLodge'))
        return build('wardenLodge', 'Give the archers cover', 'Choose Warden lodge and place it toward the front of the north road. Rootwardens take hits but deal little damage.', 0);
      if (!own.some(b => b.type === 'archery' && b.lane === 0))
        return build('archery', 'Add damage behind the screen', 'Build an archery range behind the northern Warden lodge. Archers provide the damage while Rootwardens hold the front.', 0);
      if (!own.some(b => b.lane === 1 && definitions[b.type]?.unit))
        return build('barracks', 'Watch the other road', 'The southern camp keeps sending troops. Build a force on that road too.', 1);
      if (!own.some(b => b.type === 'mint'))
        return build('mint', 'Fund reinforcements', 'A gold mine pays for more troops over time. Keep it behind your front line.', 1);
      return { key: 'fork-front', title: 'Keep both roads supplied', text: 'Watch your northern screen and the southern road. A win adds siege, wizards and gryphons; the bonus stars are optional.', control: '#front' };
    }
    if (id === 'open-three-roads') {
      if (!own.some(b => b.lane === 0 && (game.units || {})[definitions[b.type]?.unit]?.canAttackAir))
        return build('archery', 'Answer the northern flyers', 'Archers can hit air. Rootwardens cannot. Place an archery range on the north road.', 0);
      if (!own.some(b => ['foundry','aerie'].includes(b.type) && b.lane === 1))
        return build('foundry', 'Reach the middle fortifications', 'A foundry trains siege units that hit structures hard. Give them a screen, or try a different route.', 1);
      if (!own.some(b => b.lane === 2 && definitions[b.type]?.unit))
        return build('barracks', 'Cover the south road', 'The southern infantry can reach your citadel while you fight elsewhere. Leave a force to meet them.', 2);
      return { key: 'company-front', title: 'Choose where to push', text: 'All eight buildings are available. Break the marked camps or reach the enemy citadel. You do not need three stars to continue.', control: '#front' };
    }
    if (id === 'forked-road') {
      const uncovered = game.map.lanes.findIndex((_, lane) => !own.some(b => b.lane === lane && definitions[b.type]?.unit));
      if (uncovered >= 0)
        return build('barracks', uncovered === 0 ? 'Cover the first road' : 'Cover the other road',
          'Build troops on both roads. A barracks is a good start; archers can support it.', uncovered);
      if (!own.some(b => b.type === 'mint'))
        return build('mint', 'Build a gold mine', 'A mine adds 2.5 gold per second. Place it behind your troops.');
      if (!own.some(b => b.type === 'watchtower'))
        return build('watchtower', 'Hold a road', 'A watchtower fires at nearby enemies. Put it ahead of production; it cannot clear a distant camp on its own.');
      return { key: 'roads', title: 'Watch both roads', text: 'Use the minimap to check each road. Keep troops moving toward both marked barracks.', control: '#front' };
    }
    if (id === 'emberwatch') {
      if (!own.some(b => b.type === 'barracks'))
        return build('barracks', 'Raise a barracks', 'Choose Barracks below, then a green site. Warriors spawn and march on their own.');
      if (!own.some(b => b.type === 'archery'))
        return build('archery', 'Add ranged support', 'Your barracks already sends warriors. Choose Archery below, then place it behind the barracks.');
      return { key: 'front', title: 'Follow your army', text: 'Troops march and fight on their own. Use Front to follow them toward the gold-marked target. Keep building while they advance.', control: '#front' };
    }
    if (id === 'three-roads') {
      if (!own.some(b => b.type === 'watchtower'))
        return build('watchtower', 'Hold nearby ground', 'A watchtower holds nearby ground. Choose it below to try one, then send troops down both outer roads.');
      return { key: 'roads', title: 'Check both roadblocks', text: 'Drag the battlefield or tap the minimap to look ahead. Build troops on each outer road to reach both marked barracks.', control: '#front' };
    }
    if (id === 'winter-stores') {
      if (own.filter(b => b.type === 'mint').length < 3)
        return build('mint', 'Build up your income', 'Two marked mines are already working. Add a third mine, then upgrade mines to reach 15 gold/sec. Keep the marked mines alive.');
      if (currentIncome(game) < 15) {
        const mine = own.filter(b => b.type === 'mint' && b.level < 3).sort((a,b) => a.level - b.level)[0];
        if (mine) return { key: `upgrade-${mine.id}`, title: 'Grow your income', text: choice.selected === mine.id
          ? 'Choose Upgrade in the building details. It costs the displayed gold and increases this mine’s income.'
          : 'Tap the gold-ringed mine, then choose Upgrade. Aim for 15 gold/sec before the deadline.', control: choice.selected === mine.id ? '#upgrade' : '#battle', buildingId: mine.id };
      }
      return { key: 'protect', title: 'Keep the supply mines alive', text: 'Your income is ready. Defend both marked starting mines until the clock runs out.', control: '#front' };
    }
    if (id === 'wings-of-ash') {
      const lane = [0, game.map.lanes.length - 1].find(lane => !own.some(b => b.lane === lane && (game.units || {})[definitions[b.type]?.unit]?.canAttackAir));
      if (lane !== undefined) return build('archery', 'Answer the flyers', 'Archers can hit gryphons. Cover both outer roads; ground-only troops cannot stop the air attack.', lane);
    }
    if (id === 'stonegate' && !own.some(b => b.type === 'foundry'))
      return build('foundry', 'Bring siege support', 'Siege engines outrange towers. Choose Foundry below and keep warriors ahead of its engines.');
    return null;
  };
  const hint = goal();
  // The current lesson retains its chosen road when its tool is selected.
  // Another troop producer can cover that road too; all choices remain optional.
  if (choice.build && Object.hasOwn(definitions, choice.build) && hint?.buildType !== choice.build) {
    const lane = definitions[choice.build].unit && definitions[hint?.buildType]?.unit ? hint?.preferredLane : null;
    return build(choice.build, `Place ${definitions[choice.build].name}`, '', lane);
  }
  return hint;
}

