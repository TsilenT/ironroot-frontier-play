/** Evaluate authored objectives after every simulation tick, not after a fast-render batch. */
export function advanceObjectiveBattle(
  game,
  delta,
  evaluate,
  timeLimit = Infinity,
) {
  let outcome = evaluate(game);
  if (outcome.completed || outcome.failed) return outcome;
  let remaining = Number.isFinite(delta)
    ? Math.max(0, Math.min(0.25, delta))
    : 0;
  while (remaining > 1e-9) {
    const untilDeadline = Math.max(0, timeLimit - game.state.time);
    const step = Math.min(0.05, remaining, untilDeadline);
    if (step <= 1e-9) return evaluate(game);
    game.update(step);
    remaining -= step;
    outcome = evaluate(game);
    if (outcome.completed || outcome.failed) return outcome;
  }
  return outcome;
}
