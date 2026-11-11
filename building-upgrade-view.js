// Read-only upgrade preview. Keep these values pinned to real engine outcomes
// by tests; the simulation and saved battle identities remain unchanged.
const number = value => String(Number(value.toFixed(2)));

export function buildingUpgradeView(game, building) {
  if (building.level >= 3) return {title: 'Maximum level reached', rows: [], note: ''};
  const d = game.buildings[building.type], nextLevel = building.level + 1;
  const maxHp = d.hp * (1 + 0.4 * (nextLevel - 1));
  const rows = [{label: 'Building HP', before: `${Math.ceil(building.hp)} / ${Math.ceil(building.maxHp)}`,
    after: `${Math.ceil(building.hp + (maxHp - building.maxHp))} / ${Math.ceil(maxHp)}`}];
  let note = '';
  if (d.unit) {
    const unit = game.units[d.unit], current = 1 + 0.12 * (building.level - 1), next = 1 + 0.12 * building.level;
    const interval = level => (d.spawnTime / (1 + 0.22 * (level - 1)) / (game.state.overtime ? 1.65 : 1)).toFixed(1) + 's';
    rows.push({label: 'Wave interval', before: interval(building.level), after: interval(nextLevel)},
      {label: 'Recruit HP', before: number(unit.hp * current), after: number(unit.hp * next)},
      {label: 'Recruit damage', before: number(unit.damage * current), after: number(unit.damage * next)});
    note = 'Future recruits only. Damage before target modifiers.';
  } else if (d.range) {
    rows.push({label: 'Shot damage', before: number(d.damage * (1 + 0.3 * (building.level - 1))),
      after: number(d.damage * (1 + 0.3 * building.level))});
    note = 'Damage before target modifiers. Range and firing speed stay the same.';
  } else if (building.type === 'mint') {
    rows.push({label: 'Gold / second', before: number(2.5 * (1 + 0.5 * (building.level - 1))),
      after: number(2.5 * (1 + 0.5 * building.level))});
  }
  return {title: `Upgrade to level ${nextLevel}`, rows, note};
}
