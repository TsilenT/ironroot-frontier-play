import { supportsMinorReserve, minorReserveStatus } from './minor-reserve.js';

// Read-only presentation. The engine owns the trigger, warning clock, capacity
// queue and release ledger. Neither opening this view nor focusing it advances
// the contingent or changes its original post identity.
export const MINOR_RESERVE_SCOUTING_TEXT = 'Destroy the enemy citadel by 10:00 while yours survives; 1 HP is enough. All roads are fully visible. The original North Command Post is an optional north-road watchtower at x 2230. Destroying it gives a six-second warning, then releases one finite contingent of 4 warriors and 2 archers from the north entry at x 3050. These are ordinary level-1 troops; the 70-unit enemy cap can delay their arrival. Rebuilding the post does not reset the reserve. Paid enemy building and factory production continue. No post, road or reserve kill is required. Normal 5:00 escalation applies. The 3:00 and 4,500-HP stars are optional.';

export function minorReserveView(game, { ended = false } = {}) {
  if (!supportsMinorReserve(game?.ruleset)) return null;
  const status = minorReserveStatus(game);
  if (!status) return null;
  const post = game.state.buildings.find(building => building.id === status.postId);
  const released = 6 - status.remaining;
  const warning = Math.max(0, Math.ceil(status.warningSeconds));
  const focus = Object.freeze({
    x: status.phase === 'armed' ? post?.x ?? 2230 : 3050,
    y: game.map.lanes[0],
    label: status.phase === 'armed' ? 'optional North Command Post' : 'north reserve entry',
  });
  const title = status.phase === 'armed' ? 'Optional North Command Post'
    : status.phase === 'warning' ? `NORTH RESERVE · ${warning}s`
      : status.phase === 'arriving' ? 'NORTH RESERVE · queued'
        : 'NORTH RESERVE · released';
  const detail = status.phase === 'armed' ? 'Standing · triggers one wave'
    : status.phase === 'warning' ? '4 warriors + 2 archers · once'
      : status.phase === 'arriving' ? `${released}/6 released · capacity delay`
        : '6/6 released · once only';
  const description = status.phase === 'armed'
    ? 'Optional original North Command Post, north road. Destroying it triggers a six-second warning and one contingent of 4 warriors and 2 archers. It is not a victory requirement.'
    : status.phase === 'warning'
      ? `North reserve arriving in ${warning} seconds: one contingent of 4 warriors and 2 archers. The enemy unit cap can delay arrival.`
      : status.phase === 'arriving'
        ? `North reserve: ${released} of 6 troops released. The enemy unit cap is delaying the remaining ${status.remaining}. No reserve kills are required to win.`
        : 'The single north reserve contingent has been released. Released does not mean defeated. No more reserves will arrive; ordinary enemy production continues. No reserve kills are required to win.';
  return Object.freeze({
    phase: status.phase, title, detail, description, focus,
    ended: ended || game.state.winner !== null,
    landmark: status.phase === 'armed' && post
      ? Object.freeze({ id: post.id, x: post.x, y: post.y, label: 'North Command Post · optional' }) : null,
  });
}
