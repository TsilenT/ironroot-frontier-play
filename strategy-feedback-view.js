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

// Observe committed player commands only, never the continuously changing
// balance. Stable command identities suppress duplicate presentation callbacks.
export function createGoldFeedbackLedger() {
  let current = null, seen = new Set();
  return {
    reset() { current = null; seen.clear(); },
    record(context, identity, before, after) {
      if (!context || typeof identity !== 'string' || !identity ||
          !Number.isFinite(before) || !Number.isFinite(after) || before < 0 || after < 0) return null;
      const delta = after - before, amount = Math.round(Math.abs(delta));
      // These purchase/refund commands use whole gold, even when income leaves
      // a fractional balance. Do not turn passive fractions into a transaction.
      if (!Number.isSafeInteger(amount) || amount < 1 || Math.abs(Math.abs(delta) - amount) > 1e-6) return null;
      if (context !== current) { current = context; seen = new Set(); }
      if (seen.has(identity)) return null;
      seen.add(identity);
      return {text: `${delta < 0 ? '−' : '+'}${amount.toLocaleString('en-US')}`,
        kind: delta < 0 ? 'spent' : 'refund', amount};
    },
  };
}
