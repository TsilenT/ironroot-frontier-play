import { BUILDINGS, buildSites } from './engine.js';
import { currentIncome } from './campaign.js';
import { supportsAutonomousAir } from './autonomous-air.js';

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
export function campaignTeaching(id, { resumed = false, completed = false, learnedBasics = false, flightOrders = false, autonomousAir = false } = {}) {
  if (resumed || completed) return null;
  if (autonomousAir && ['wings-of-ash', 'stonegate'].includes(id)) return {
    title: id === 'wings-of-ash' ? 'Watch the neighboring roads' : 'Cover the siege engines',
    text: (id === 'wings-of-ash' ? 'Against the veteran flyers, lead with archers. ' : 'For the middle defenses, bring siege with troops ahead. ') +
      'Gryphons spot nearby enemies on their own, including on an adjacent road, and fly toward them to fight at their normal range. Archers stay on their road; archers and towers can hit flyers within range. Rootwardens cannot attack air.',
  };
  if (flightOrders && ['wings-of-ash', 'stonegate'].includes(id)) return {
    title: id === 'wings-of-ash' ? 'Take control of the sky' : 'Find a way past the towers',
    text: (id === 'wings-of-ash' ? 'Against the veteran flyers, lead with archers. ' : 'For the middle defenses, bring siege. ') +
      'Select an aerie to send future gryphons to an adjacent road, with a two-second warning before each crossing. They cannot attack while changing roads, so holding their road may better protect the troops below. Plan your approach before starting.',
  };
  const lessons = {
    'roadside-watch': ['Build your first army', 'Place a barracks on a green site to send warriors down the road, with an archery range behind it for ranged support.'],
    'shield-at-the-fork': ['Plan for both roads', 'Your new Warden lodges train durable Rootwardens who benefit from archers behind them to make up for their low damage. Cover the other road too, with watchtowers ahead of production and gold mines toward the rear.'],
    'open-three-roads': ['Choose a force for each road', 'With all eight buildings available, you can choose your route: archers can answer the northern gryphons, while siege with a troop screen can reach the middle tower. Rootwardens cannot hit flyers, and the south road still needs a force of its own.'],
    'first-watch': ['Build your first army', 'A barracks on a green site sends warriors down the road to fight on their own, with support from any archery range you build behind it.'],
    'forked-road': ['Plan for both roads', 'Supply both roads with troops, using mines to fund reinforcements and towers to defend nearby ground. The towers cannot march on enemy camps for you.'],
    'emberwatch': ['Add ranged support', 'Add an archery range behind your existing barracks to support the advancing warriors.'],
    'three-roads': ['Defense and attack', 'Place a tower ahead of your troop buildings to hold nearby ground while your armies clear the marked camps on both outer roads.'],
    'winter-stores': ['Fund the relief', 'Keep both marked mines standing as you add and upgrade mines to reach the income goal, leaving enough gold for troops to defend them.'],
  };
  if (!Object.hasOwn(lessons, id) || (id === 'emberwatch' && learnedBasics)) return null;
  return { title: lessons[id][0], text: lessons[id][1] + (id === 'open-three-roads' && autonomousAir
    ? ' Gryphons also spot nearby enemies on an adjacent road and fly over to engage on their own. Archers stay on their road and shoot only when flyers are within range.' : ''),
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
        : 'This forward tower can defend nearby ground while troops on the same road push toward the enemy.';
    } else if (type === 'mint') {
      preferredX = 270;
      explanation = 'A mine at the rear still needs protection, but leaves forward sites free for troops and defenses.';
    } else if (support && anchor) {
      sites = sites.filter(p => p.x < anchor.x);
      preferredX = anchor.x - 140;
      explanation = 'Behind your frontline producer, reinforcements have a chance to form up behind its troops.';
    }
    if (support && !anchor) explanation = 'Without a barracks or Warden lodge ahead on this road, these support troops may need a screen before they advance.';
    if (!sites.length) continue;
    const danger = p => game.state.units.filter(u => u.side === 1 && u.hp > 0 && u.lane === p.lane && Math.abs(u.x-p.x) < 240).length;
    sites.sort((a,b) => danger(a)-danger(b) || Math.abs(a.x-preferredX)-Math.abs(b.x-preferredX) || a.x-b.x);
    const site = sites[0];
    const road = game.map.lanes.length === 1 ? 'the road' : `${['first', 'second', 'third'][site.lane]} road`;
    if (preferredLane !== null && site.lane !== preferredLane) explanation = `With no suitable free site on the requested road, this suggestion uses the ${road}. ` + explanation;
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
  const automaticAir = supportsAutonomousAir(game.ruleset);
  const own = game.state.buildings.filter(b => b.side === 0 && b.hp > 0);
  const build = (type, title, text, preferredLane = null) => {
    const recommendation = recommendCampaignSite(game, type, preferredLane);
    const selected = choice.build === type;
    return { key: `build-${type}`, buildType: type, preferredLane, title,
      text: selected ? (recommendation.site
        ? `Suggested site (${recommendation.road}): ${recommendation.explanation} You can also choose another green site, instead of the gold ring.`
        : recommendation.reason) : text,
      control: `[data-type="${type}"]`, site: selected ? recommendation.site : null };
  };
  const goal = () => {
    if (id === 'first-watch' || id === 'roadside-watch') {
      if (!own.some(b => b.type === 'barracks'))
        return build('barracks', 'Build a barracks', 'Choose Barracks and a green site to send warriors down the road on their own.');
      if (!own.some(b => b.type === 'archery'))
        return build('archery', 'Add archers', 'Place an Archery range behind your barracks so its archers can fire from behind the warriors.');
      return { key: 'front', title: 'Follow your army', text: 'Use Front to follow your troops as they advance toward the marked enemy barracks you need to clear.', control: '#front' };
    }
    if (id === 'shield-at-the-fork') {
      if (!own.some(b => b.type === 'wardenLodge'))
        return build('wardenLodge', 'Give the archers cover', 'Build a Warden lodge toward the front of the north road to train Rootwardens who take hits but deal little damage.', 0);
      if (!own.some(b => b.type === 'archery' && b.lane === 0))
        return build('archery', 'Add damage behind the screen', 'Place an archery range behind the northern Warden lodge to add damage while the Rootwardens hold the front.', 0);
      if (!own.some(b => b.lane === 1 && definitions[b.type]?.unit))
        return build('barracks', 'Watch the other road', 'Build a force on the south road to meet the troops still coming from that camp.', 1);
      if (!own.some(b => b.type === 'mint'))
        return build('mint', 'Fund reinforcements', 'Build a gold mine behind your front line to fund more troop buildings as the battle goes on.', 1);
      return { key: 'fork-front', title: 'Keep both roads supplied', text: 'Keep both the northern screen and the south road supplied to win access to siege, wizards and gryphons. You can collect the optional bonus stars on a replay.', control: '#front' };
    }
    if (id === 'open-three-roads') {
      if (!own.some(b => b.lane === 0 && (game.units || {})[definitions[b.type]?.unit]?.canAttackAir))
        return build('archery', 'Answer the northern flyers', 'Place an archery range on the north road to hit the flyers that Rootwardens cannot reach.' + (automaticAir ? ' Gryphons may also approach enemies on the neighboring road; archers stay on their own road and need the flyer within range.' : ''), 0);
      if (!own.some(b => ['foundry','aerie'].includes(b.type) && b.lane === 1))
        return build('foundry', 'Reach the middle fortifications', 'Try a foundry with a troop screen to break structures, or choose a different route if you prefer.', 1);
      if (!own.some(b => b.lane === 2 && definitions[b.type]?.unit))
        return build('barracks', 'Cover the south road', 'Leave a force on the south road to stop infantry reaching your citadel while you fight elsewhere.', 2);
      return { key: 'company-front', title: 'Choose where to push', text: 'Use any of the eight buildings to break the marked camps or reach the enemy citadel; either victory lets you continue without collecting three stars.', control: '#front' };
    }
    if (id === 'forked-road') {
      const uncovered = game.map.lanes.findIndex((_, lane) => !own.some(b => b.lane === lane && definitions[b.type]?.unit));
      if (uncovered >= 0)
        return build('barracks', uncovered === 0 ? 'Cover the first road' : 'Cover the other road',
          'Start each road with a barracks and add archers for support, or choose another force that can cover both roads.', uncovered);
      if (!own.some(b => b.type === 'mint'))
        return build('mint', 'Build a gold mine', 'Build a mine behind your troops to add 2.5 gold per second for later reinforcements.');
      if (!own.some(b => b.type === 'watchtower'))
        return build('watchtower', 'Hold a road', 'Place a watchtower ahead of production to fire at nearby enemies, but use marching troops to clear a distant camp.');
      return { key: 'roads', title: 'Watch both roads', text: 'Check both roads on the minimap as your troops move toward the marked barracks.', control: '#front' };
    }
    if (id === 'emberwatch') {
      if (!own.some(b => b.type === 'barracks'))
        return build('barracks', 'Raise a barracks', 'Choose Barracks below and a green site to train warriors who will march on their own.');
      if (!own.some(b => b.type === 'archery'))
        return build('archery', 'Add ranged support', 'Choose Archery below and place it behind the barracks that is already sending out warriors.');
      return { key: 'front', title: 'Follow your army', text: 'Keep building as your troops march and fight on their own, using Front to follow them toward the gold-marked target.', control: '#front' };
    }
    if (id === 'three-roads') {
      if (!own.some(b => b.type === 'watchtower'))
        return build('watchtower', 'Hold nearby ground', 'Try a watchtower to hold nearby ground while your troops push down both outer roads.');
      return { key: 'roads', title: 'Check both roadblocks', text: 'Look ahead by dragging the battlefield or tapping the minimap, and build troops on each outer road to reach both marked barracks.', control: '#front' };
    }
    if (id === 'winter-stores') {
      if (own.filter(b => b.type === 'mint').length < 3)
        return build('mint', 'Build up your income', 'Add a third mine and upgrade your mines to reach 15 gold/sec, keeping both marked starting mines alive.');
      if (currentIncome(game) < 15) {
        const mine = own.filter(b => b.type === 'mint' && b.level < 3).sort((a,b) => a.level - b.level)[0];
        if (mine) return { key: `upgrade-${mine.id}`, title: 'Grow your income', text: choice.selected === mine.id
          ? 'Choose Upgrade in the building details to pay the displayed gold and increase this mine’s income.'
          : 'Tap the gold-ringed mine and choose Upgrade to work toward 15 gold/sec before the deadline.', control: choice.selected === mine.id ? '#upgrade' : '#battle', buildingId: mine.id };
      }
      return { key: 'protect', title: 'Keep the supply mines alive', text: 'With your income ready, defend both marked starting mines until the clock runs out.', control: '#front' };
    }
    if (id === 'wings-of-ash') {
      const lane = [0, game.map.lanes.length - 1].find(lane => !own.some(b => b.lane === lane && (game.units || {})[definitions[b.type]?.unit]?.canAttackAir));
      if (lane !== undefined) return build('archery', 'Answer the flyers', 'Cover both outer roads with archers to hit the gryphons that ground-only troops cannot stop.' + (automaticAir ? ' Gryphons choose nearby enemies themselves and may approach from a neighboring road. Archers and towers can intercept them within range.' : ''), lane);
    }
    if (id === 'stonegate' && !own.some(b => b.type === 'foundry'))
      return build('foundry', 'Bring siege support', 'Choose Foundry below for siege engines that outrange towers, keeping warriors ahead to protect them.');
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

