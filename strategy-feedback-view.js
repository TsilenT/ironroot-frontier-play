/** Read-only player feedback. The 70-slot limit is pinned to engine behavior by tests. */
export const ARMY_CAPACITY_RULES = 'Every troop uses one of 70 army slots. At capacity, waves cannot add recruits. Missed waves are not stored; recruitment resumes on a later wave with space.';

export function armyCapacityView(state) {
  const count = state.units.filter(unit => unit.side === 0 && unit.hp > 0).length;
  const full = count >= 70;
  return {count, full, label: `${count}/70`,
    warning: full ? 'Army full. Missed waves are not stored; recruits need a later wave with space.' : '',
    description: `${full ? 'Army full' : 'Army capacity'}: ${count} of 70 slots used. ${ARMY_CAPACITY_RULES}`};
}

// Called only when the result is shown. No tactical cause is inferred from a
// final snapshot, and no enemy roster or concealed encounter identity is read.
export function defeatFacts(state) {
  const enemy = state.bases[1];
  return [
    {label: 'Enemy citadel HP', value: `${Math.ceil(enemy.hp)} / ${Math.ceil(enemy.maxHp)}`},
    {label: 'Your surviving troops', value: String(armyCapacityView(state).count)},
    {label: 'Your unspent gold', value: String(Math.floor(state.gold[0]))},
  ];
}
