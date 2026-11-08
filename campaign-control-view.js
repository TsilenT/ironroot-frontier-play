/** Presentation only; the engine owns capture and accumulated supply time. */
export function controlProgressLabel(status, post = null) {
  const seconds = Math.min(status.target, Math.max(0, status.seconds));
  const clear = Math.min(status.required, Math.max(0, status.count));
  return `${Math.floor(seconds + 1e-7)}/${status.target}s · ${clear}/${status.required} clear` + (post ? ` · ${post.name}: ${post.destroyed ? "destroyed" : "standing"}` : "");
}

export function controlProgressDescription(status, post = null) {
  if (post) {
    const supply = status.complete ? `Supply goal met: ${status.target} seconds secured. This alone does not win the mission.` : controlProgressDescription(status);
    return `${supply} ${post.name}: ${post.destroyed ? "original destroyed" : "original still standing"}. Complete both goals in either order, or destroy the enemy citadel. Your citadel must survive. Replacements do not count.`;
  }
  const seconds = Math.min(status.target, Math.max(0, status.seconds)).toFixed(1);
  if (status.complete) return `Supply route secured: ${status.target} seconds accumulated. No bridge income was awarded.`;
  return `${seconds} of ${status.target} seconds secured. ${status.count} uncontested bridge${status.count === 1 ? '' : 's'} owned; ${status.required} required. ` +
    (status.advancing ? 'Supply progress advances while the battle runs.' : 'Supply progress is paused; the time already secured is kept.') +
    ' Empty bridges stay owned until captured. Bridges award no gold in this mission.';
}

export const CONTROL_MAP_LEGEND = 'Map labels: Y = you, E = enemy, — = unowned, X = contested. An arrow points to the side attempting a ground capture. Roads run north, middle, south from top to bottom.';
