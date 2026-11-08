/** Presentation policy for the immutable chart, not a second fog-memory store. */
export function hasChartedIntelligence(mission) {
  return !!mission && mission.id === 'lanterns-on-the-water' && mission.scenarioRevision === 1
    && mission.rulesetId === 'frontier-campaign-lanterns' && mission.rulesetRevision === 1
    && mission.intelligence === 'charted-customs-posts';
}

const roadName = (lane, count) => count === 2 ? ['North', 'South'][lane]
  : count === 3 ? ['North', 'Middle', 'South'][lane] : `Road ${lane + 1}`;
const sameSite = (a, b) => a.type === b.type && a.x === b.x && a.lane === b.lane;
const inSight = (view, x, y) => !view.fog.enabled
  || view.fog.observers.some(o => (x - o.x) ** 2 + (y - o.y) ** 2 <= o.radius ** 2);
const seenTime = time => `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, '0')}`;
function chartedOriginalTarget(chart, originalTargets) {
  const original = originalTargets.find(target => target.kind === 'destroy' && sameSite(target, chart));
  if (!original || !Number.isSafeInteger(original.originalId) || original.originalId <= 0
      || !Object.hasOwn(original, 'building') || original.building === undefined)
    throw new Error('A charted objective requires its original campaign identity.');
  return original;
}

/**
 * Dispatch-confirmed destruction supersedes a stale original-post sighting.
 * Filter only the detached presentation observation, never the engine's fog
 * record. A replacement at the same site keeps its independent memory ID.
 * Unchanged observations retain their identity; changed ones share unaffected
 * data and own a new fog wrapper and memory array.
 */
export function chartedObjectiveObservation(mission, observation, originalTargets) {
  if (!hasChartedIntelligence(mission)) return observation;
  if (!observation?.fog || !Array.isArray(observation.fog.memories))
    throw new Error('Charted objectives require a side observation.');
  if (!observation.fog.enabled || !observation.fog.memories.length) return observation;
  if (!Array.isArray(originalTargets)) throw new Error('Original campaign target identities are required.');
  const confirmed = new Set();
  for (const chart of mission.markedTargets) {
    const original = chartedOriginalTarget(chart, originalTargets);
    if (original.building === null) confirmed.add(original.originalId);
  }
  if (!observation.fog.memories.some(memory => confirmed.has(memory.id))) return observation;
  return { ...observation, fog: { ...observation.fog,
    memories: observation.fog.memories.filter(memory => !confirmed.has(memory.id)),
  } };
}

/**
 * The chart discloses only authored names/sites/types. Dispatch additionally
 * confirms an original post's destruction, even outside sight. The original
 * target's raw building is therefore used ONLY as a null/existence signal.
 * Health comes exclusively from current contacts; stale level/time comes
 * exclusively from observed memory. Never spread either source into controls.
 */
export function chartedObjectiveTargets(mission, view, originalTargets) {
  if (!hasChartedIntelligence(mission)) return [];
  if (!view?.fog || !Array.isArray(view.fog.observers) || !Array.isArray(view.state?.buildings))
    throw new Error('Charted objectives require a side observation.');
  if (!Array.isArray(originalTargets)) throw new Error('Original campaign target identities are required.');
  return Object.freeze(mission.markedTargets.map(chart => {
    const original = chartedOriginalTarget(chart, originalTargets);
    const originalId = original.originalId, y = view.map.lanes[chart.lane];
    const confirmedDestroyed = original.building === null;
    const visible = !confirmedDestroyed && inSight(view, chart.x, y)
      ? view.state.buildings.find(b => b.id === originalId && b.side === 1 && b.y === y && sameSite(b, chart)) : null;
    const memory = !confirmedDestroyed && !visible
      ? view.fog.memories?.find(m => m.id === originalId && m.y === y && sameSite(m, chart)
        && Number.isInteger(m.level) && m.level >= 1 && m.level <= 3
        && Number.isFinite(m.observedAt) && m.observedAt >= 0 && m.observedAt <= view.state.time) : null;
    const percent = visible && Number.isFinite(visible.hp) && Number.isFinite(visible.maxHp) && visible.maxHp > 0
      ? Math.ceil(Math.max(0, Math.min(1, visible.hp / visible.maxHp)) * 100) : null;
    const status = confirmedDestroyed ? 'destroyed' : visible ? 'visible' : memory ? 'last-seen' : 'charted';
    const statusText = confirmedDestroyed ? 'Cleared · destruction confirmed'
      : visible ? `Visible · ${percent === null ? 'health unknown' : `${percent}% HP`}`
      : memory ? `Last seen L${memory.level} at ${seenTime(memory.observedAt)} · health unknown`
      : 'Charted · health unknown';
    return Object.freeze({
      originalId, label: chart.name, type: chart.type, x: chart.x, y, lane: chart.lane,
      road: roadName(chart.lane, view.map.lanes.length), status, statusText, percent, confirmedDestroyed,
    });
  }));
}
