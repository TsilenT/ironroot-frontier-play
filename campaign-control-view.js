/** Presentation only; the engine owns capture and accumulated supply time. */
export function controlProgressLabel(status) {
  const seconds = Math.min(status.target, Math.max(0, status.seconds));
  const clear = Math.min(status.required, Math.max(0, status.count));
  return `${Math.floor(seconds + 1e-7)}/${status.target}s · ${clear}/${status.required} clear`;
}

export function controlProgressDescription(status) {
  const seconds = Math.min(status.target, Math.max(0, status.seconds)).toFixed(1);
  if (status.complete) return `Supply route secured: ${status.target} seconds accumulated. No bridge income was awarded.`;
  return `${seconds} of ${status.target} seconds secured. ${status.count} uncontested bridge${status.count === 1 ? '' : 's'} owned; ${status.required} required. ` +
    (status.advancing ? 'Supply progress advances while the battle runs.' : 'Supply progress is paused; the time already secured is kept.') +
    ' Empty bridges stay owned until captured. Bridges award no gold in this mission.';
}

export const CONTROL_MAP_LEGEND = 'Map labels: Y = you, E = enemy, — = unowned, X = contested. An arrow points to the side attempting a ground capture. Roads run north, middle, south from top to bottom.';
