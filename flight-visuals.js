/** Original flight-order waymarks. Presentation only: no clock, state cache or RNG. */
import { supportsFlightOrders, flightGateX } from './flight-orders.js';
import { flightWarningTime } from './flight-orders-view.js';

const INK = '#142a28';
const PAPER = '#fff2cf';
const NEXT = '#efd18e';
const TEAMS = ['#b4e3c3', '#edbb92'];
const PHASES = new Set(['approach', 'warning', 'transit']);
const finite = Number.isFinite;
const scaleOf = scale => finite(scale) && scale > 0 ? scale : 1;
const validLane = (map, lane) => Number.isInteger(lane) && lane >= 0 && lane < map.lanes.length;
const adjacent = (map, from, to) => validLane(map, from) && validLane(map, to) && Math.abs(from - to) === 1;

/** Bounds use world coordinates. Null means no culling, not an empty viewport. */
export function flightViewport(renderer, map) {
  const scale = scaleOf(renderer?.scale);
  if (![renderer?.camera, renderer?.width, renderer?.height].every(finite) || renderer.width <= 0 || renderer.height <= 0) return null;
  return {
    minX: renderer.camera - renderer.width / (2 * scale),
    maxX: renderer.camera + renderer.width / (2 * scale),
    minY: map.height / 2 - renderer.height / (2 * scale),
    maxY: map.height / 2 + renderer.height / (2 * scale),
  };
}

export function flightBoundsVisible(bounds, viewport) {
  return !viewport || (bounds.maxX >= viewport.minX && bounds.minX <= viewport.maxX &&
    bounds.maxY >= viewport.minY && bounds.minY <= viewport.maxY);
}

/** Shared gate helper, never a duplicated Classic-only gate constant. */
export function flightRouteGeometry(map, ruleset, side, from, to) {
  if (!supportsFlightOrders(ruleset) || ![0, 1].includes(side) || !adjacent(map, from, to)) return null;
  const x = flightGateX(map, ruleset, side), fromY = map.lanes[from], toY = map.lanes[to];
  if (![x, fromY, toY].every(finite)) return null;
  return { x, fromY, toY, direction: Math.sign(toY - fromY), midY: (fromY + toY) / 2 };
}

const routeBounds = (route, pad) => ({ minX: route.x - pad, maxX: route.x + pad,
  minY: Math.min(route.fromY, route.toY) - pad, maxY: Math.max(route.fromY, route.toY) + pad });

/**
 * Detached scalar projection of launched routes. World defaults to warning/transit;
 * minimap includes committed approaches. Only the selected, owned aerie is read
 * for a future plan. No enemy building's flightPlan is inspected.
 */
export function buildFlightSignals(game, { selected = null, viewport = null, scale = 1, includeApproach = false } = {}) {
  const result = { routes: [], preview: null };
  if (!supportsFlightOrders(game?.ruleset)) return result;
  const { map, ruleset, state } = game, groups = new Map(), pad = 12 / scaleOf(scale);
  for (const unit of state.units) {
    const route = unit.airRoute;
    if (unit.type !== 'gryphon' || !(unit.hp > 0) || ![0, 1].includes(unit.side) ||
      !finite(unit.x) || !finite(unit.y) || !route || !PHASES.has(route.phase) ||
      (!includeApproach && route.phase === 'approach')) continue;
    const geometry = flightRouteGeometry(map, ruleset, unit.side, route.from, route.to);
    if (!geometry || !flightBoundsVisible(routeBounds(geometry, pad), viewport)) continue;
    if (route.phase === 'warning' && (!finite(route.remaining) || route.remaining < 0 ||
      route.remaining > ruleset.movement.flightOrders.warningSeconds)) continue;
    const key = `${unit.side}:${route.from}:${route.to}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, side: unit.side, from: route.from, to: route.to, ...geometry,
        approachCount: 0, warningCount: 0, transitCount: 0, remaining: null, transitY: null };
      groups.set(key, group);
    }
    group[`${route.phase}Count`]++;
    if (route.phase === 'warning') group.remaining = group.remaining === null ? route.remaining : Math.min(group.remaining, route.remaining);
    if (route.phase === 'transit') {
      const y = Math.max(Math.min(group.fromY, group.toY), Math.min(Math.max(group.fromY, group.toY), unit.y));
      group.transitY = group.transitY === null ? y : group.direction > 0 ? Math.max(group.transitY, y) : Math.min(group.transitY, y);
    }
  }
  result.routes = [...groups.values()].sort((a, b) => a.side - b.side || a.from - b.from || a.to - b.to);
  const aerie = selected == null ? null : state.buildings.find(b => b.id === selected && b.side === 0 && b.type === 'aerie' && b.hp > 0);
  if (aerie && finite(aerie.x) && finite(aerie.y)) {
    const geometry = flightRouteGeometry(map, ruleset, 0, aerie.lane, aerie.flightPlan);
    if (geometry) {
      // Clear the aerie's 83-world-pixel flag plus a fixed-pixel label gap.
      const sourceX = aerie.x, sourceY = aerie.y - 90 - 12 / scaleOf(scale);
      const sourceBounds = { minX: aerie.x - 52, maxX: aerie.x + 52, minY: aerie.y - 83, maxY: aerie.y + 48 };
      const showSource = flightBoundsVisible(sourceBounds, viewport) ||
        flightBoundsVisible({ minX: sourceX - 38 / scaleOf(scale), maxX: sourceX + 38 / scaleOf(scale),
          minY: sourceY - 12 / scaleOf(scale), maxY: sourceY + 12 / scaleOf(scale) }, viewport);
      const showGate = flightBoundsVisible(routeBounds(geometry, pad), viewport);
      if (showGate || showSource) result.preview = { side: 0, from: aerie.lane, to: aerie.flightPlan,
        ...geometry, sourceX, sourceY, sourceBounds, showSource, showGate };
    }
  }
  return result;
}

/** One banner per side/road gap, at most two direction rows, independent of army size. */
export function groupFlightCorridors(routes) {
  const groups = new Map();
  for (const route of routes) {
    const low = Math.min(route.from, route.to), key = `${route.side}:${low}`;
    if (!groups.has(key)) groups.set(key, { key, side: route.side, x: route.x, midY: route.midY, routes: [] });
    groups.get(key).routes.push(route);
  }
  return [...groups.values()].sort((a, b) => a.side - b.side || a.midY - b.midY)
    .map(group => ({ ...group, routes: [...group.routes].sort((a, b) => a.direction - b.direction) }));
}

/** Round up: a pending warning never falsely reads zero before the crossing starts. */
export function flightSignalLabel(route) {
  const count = n => n > 1 ? `×${n}` : '';
  const warning = route.warningCount ? `${flightWarningTime(route.remaining)}s${count(route.warningCount)}` : '';
  const transit = route.transitCount ? `AIR${count(route.transitCount)}` : '';
  return `${route.direction < 0 ? '↑' : '↓'} ${[warning, transit].filter(Boolean).join(' / ')}`;
}

function path(c, points) {
  c.beginPath();
  points.forEach(([x, y], index) => index ? c.lineTo(x, y) : c.moveTo(x, y));
}

function stroke(c, points, color, width, dash = []) {
  path(c, points);
  c.strokeStyle = INK; c.lineWidth = width + 2; c.setLineDash(dash); c.stroke();
  c.strokeStyle = color; c.lineWidth = width; c.stroke(); c.setLineDash([]);
}

/** Allied feather-shield versus enemy pointed pennon: not color-only. */
function teamMark(c, x, y, side, size = 5, color = TEAMS[side]) {
  path(c, side ? [[x - size, y - size], [x + size, y - size], [x, y + size * 1.3]] :
    [[x - size, y - size], [x, y - size * .4], [x + size, y - size], [x + size * .6, y + size * .5], [x, y + size], [x - size * .6, y + size * .5]]);
  c.closePath(); c.fillStyle = INK; c.fill(); c.strokeStyle = color; c.lineWidth = 1.5; c.stroke();
  if (side) { c.fillStyle = PAPER; c.fillRect(x - .6, y - 2.8, 1.2, 3.1); c.fillRect(x - .6, y + 1.1, 1.2, 1.2); }
}

function chevron(c, x, y, direction, color, size = 4) {
  stroke(c, [[x - size, y - direction * size], [x, y], [x + size, y - direction * size]], color, 1.5);
}

/** Keep the local banner readable if its gateway is at a viewport edge. */
export function flightBannerLayout(corridor, width, height, scale = 1, viewport = null) {
  const s = scaleOf(scale);
  let x = corridor.side ? 13 : -13 - width, y = -height / 2;
  if (viewport) {
    const left = (viewport.minX - corridor.x) * s + 4, right = (viewport.maxX - corridor.x) * s - 4;
    const top = (viewport.minY - corridor.midY) * s + 4, bottom = (viewport.maxY - corridor.midY) * s - 4;
    if (right - left >= width) x = Math.max(left, Math.min(right - width, x));
    if (bottom - top >= height) y = Math.max(top, Math.min(bottom - height, y));
  }
  return { x, y, width, height };
}

function bannerMetrics(c, corridor) {
  const rows = corridor.routes.map(flightSignalLabel), team = corridor.side ? 'FOE' : 'YOU';
  c.font = '600 12px monospace';
  const width = Math.max(...rows.map(row => c.measureText(row).width)) + 49;
  const height = rows.length * 15 + 7;
  return { rows, team, width, height };
}

const bannerBounds = ({ corridor, x, y, width, height }, scale) => ({
  minX: corridor.x + x / scale, maxX: corridor.x + (x + width) / scale,
  minY: corridor.midY + y / scale, maxY: corridor.midY + (y + height) / scale,
});

/** Resolve crowded, viewport-clamped committed banners before reserving NEXT. */
export function flightBannerLayouts(measured, scale = 1, viewport = null) {
  const s = scaleOf(scale), gap = 4;
  const layouts = measured.map(banner => ({ ...banner,
    ...flightBannerLayout(banner.corridor, banner.width, banner.height, s, viewport) }));
  const bounds = layouts.map(layout => bannerBounds(layout, s));
  const collision = bounds.some((a, i) => bounds.slice(i + 1).some(b =>
    a.maxX + gap / s > b.minX && b.maxX + gap / s > a.minX &&
    a.maxY + gap / s > b.minY && b.maxY + gap / s > a.minY));
  if (!collision) return layouts;
  const ordered = [...layouts].sort((a, b) => a.corridor.midY - b.corridor.midY || a.corridor.side - b.corridor.side);
  const total = ordered.reduce((sum, banner) => sum + banner.height, 0) + (ordered.length - 1) * gap;
  // Four two-direction banners need 168px including margins. Keep full-size
  // text and the normal in-bounds positions if an even smaller field cannot
  // fit that stack; never shrink text, silently drop a route or invent a count.
  if (viewport && (viewport.maxY - viewport.minY) * s < total + gap * 2) return layouts;
  let top = layouts.reduce((sum, b) => sum + b.corridor.midY * s + b.y + b.height / 2, 0) / layouts.length - total / 2;
  if (viewport) top = Math.max(viewport.minY * s + gap, Math.min(viewport.maxY * s - gap - total, top));
  for (const layout of ordered) {
    layout.y = top - layout.corridor.midY * s;
    top += layout.height + gap;
  }
  return layouts;
}

/**
 * NEXT stays near its aerie and clears measured banners whenever a slot fits.
 * Occupied bounds are world coordinates; the returned rectangle is in CSS
 * pixels relative to the preview's source anchor. No retained layout state.
 */
export function flightPreviewLayout(preview, occupied = [], scale = 1, viewport = null) {
  const s = scaleOf(scale), width = 70, height = 20, gap = 4;
  const local = bounds => ({ minX: (bounds.minX - preview.sourceX) * s,
    maxX: (bounds.maxX - preview.sourceX) * s, minY: (bounds.minY - preview.sourceY) * s,
    maxY: (bounds.maxY - preview.sourceY) * s });
  const obstacles = [...occupied, ...(preview.sourceBounds ? [preview.sourceBounds] : [])].map(local);
  const port = viewport ? local(viewport) : null;
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const fitX = x => port && port.maxX - port.minX >= width + gap * 2 ?
    clamp(x, port.minX + gap, port.maxX - gap - width) : x;
  const fitY = y => port && port.maxY - port.minY >= height + gap * 2 ?
    clamp(y, port.minY + gap, port.maxY - gap - height) : y;
  const desired = { x: fitX(-width / 2), y: fitY(-height / 2) };
  const xs = [desired.x], ys = [desired.y];
  for (const bounds of obstacles) {
    xs.push(fitX(bounds.minX - gap - width), fitX(bounds.maxX + gap));
    ys.push(fitY(bounds.minY - gap - height), fitY(bounds.maxY + gap));
  }
  const candidates = [...new Set(xs)].flatMap(x => [...new Set(ys)].map(y => ({ x, y, width, height })));
  // Prefer a small vertical shift to keep the label over its selected source.
  const distance = rect => Math.abs(rect.x - desired.x) * 2 + Math.abs(rect.y - desired.y);
  candidates.sort((a, b) => distance(a) - distance(b) || a.y - b.y || a.x - b.x);
  const clear = rect => obstacles.every(bounds => rect.x + width + gap <= bounds.minX + 1e-9 ||
    rect.x - gap >= bounds.maxX - 1e-9 || rect.y + height + gap <= bounds.minY + 1e-9 ||
    rect.y - gap >= bounds.maxY - 1e-9);
  // An undersized, completely occupied field keeps the in-bounds source label
  // at full size. This explicit fallback is not a claim of overlap-free fit.
  return candidates.find(clear) || { ...desired, width, height };
}

function banner(c, corridor, { x, y, width, height, rows, team }) {
  c.fillStyle = INK; c.fillRect(x, y, width, height);
  c.strokeStyle = TEAMS[corridor.side]; c.lineWidth = 1; c.strokeRect(x + .5, y + .5, width - 1, height - 1);
  teamMark(c, x + 8, y + height / 2, corridor.side, 4);
  c.fillStyle = TEAMS[corridor.side]; c.font = '700 12px sans-serif'; c.textAlign = 'left'; c.textBaseline = 'middle';
  c.fillText(team, x + 16, y + height / 2);
  c.fillStyle = PAPER; c.font = '600 12px monospace';
  rows.forEach((row, index) => c.fillText(row, x + 45, y + 11 + index * 15));
}

function drawWorldRoute(c, route, scale, { preview = false, simple = false, offset = 0 } = {}) {
  c.save(); c.translate(route.x, route.midY); c.scale(1 / scale, 1 / scale);
  const color = preview ? NEXT : TEAMS[route.side];
  const source = (route.fromY - route.midY) * scale, target = (route.toY - route.midY) * scale;
  const inset = Math.min(13, Math.abs(target - source) / 4);
  const start = source + route.direction * inset, end = target - route.direction * inset;
  const dash = preview ? [2, 5] : route.transitCount ? [] : [4, 4];
  stroke(c, [[offset, start], [offset, end]], color, preview ? 1 : 1.5, dash);
  chevron(c, offset, end, route.direction, color);
  if (!preview) {
    teamMark(c, offset, start, route.side, 4, color);
    if (route.transitY !== null) {
      const y = (route.transitY - route.midY) * scale;
      chevron(c, offset, y, route.direction, PAPER, 5);
    } else if (!simple) {
      // Fixed feather ticks: ornament only, never a pulsing warning or timer.
      stroke(c, [[offset - 5, start - route.direction * 3], [offset - 9, start - route.direction * 6]], color, 1);
      stroke(c, [[offset + 5, start - route.direction * 3], [offset + 9, start - route.direction * 6]], color, 1);
    }
  }
  c.restore();
}

/**
 * Draw paths/leaders under actors and return this frame's detached label layout.
 * Pass that same layout to drawFlightLabels after actors, under the same world
 * transform. Neither pass retains state or advances the simulation.
 */
export function drawFlightRoutes(renderer, game, ui = {}) {
  const scale = scaleOf(renderer?.scale), viewport = flightViewport(renderer, game.map);
  const signals = buildFlightSignals(game, { selected: ui.selected, scale, viewport });
  if (!signals.routes.length && !signals.preview) return { ...signals, scale, banners: [], next: null };
  const c = renderer.c, simple = !!renderer.reducedMotion || renderer.vfx?.quality === 'low';
  c.save(); c.globalAlpha = 1; c.lineCap = 'round'; c.lineJoin = 'round'; c.setLineDash([]);
  const banners = flightBannerLayouts(groupFlightCorridors(signals.routes).map(corridor =>
    ({ corridor, ...bannerMetrics(c, corridor) })), scale, viewport);
  const preview = signals.preview;
  const next = preview?.showSource ? flightPreviewLayout(preview, banners.map(layout => bannerBounds(layout, scale)), scale, viewport) : null;
  if (signals.preview?.showGate) drawWorldRoute(c, signals.preview, scale, { preview: true, offset: -7 });
  if (next && (Math.abs(next.x + 35) > 1 || Math.abs(next.y + 10) > 1)) {
    // A displaced plan stays tied to its aerie. Draw this leader underneath the
    // committed banners, so the line cannot cross their lettering.
    c.save(); c.translate(preview.sourceX, preview.sourceY); c.scale(1 / scale, 1 / scale);
    const x = Math.max(next.x, Math.min(next.x + next.width, 0));
    const y = Math.max(next.y, Math.min(next.y + next.height, 12));
    stroke(c, [[0, 12], [x, y]], NEXT, 1, [2, 3]); c.restore();
  }
  for (const layout of banners) {
    const { corridor } = layout;
    for (const route of corridor.routes) drawWorldRoute(c, route, scale, { simple, offset: corridor.routes.length > 1 ? route.direction * 5 : 0 });
    // Retain the exact crossing location if a crowded banner had to move.
    if (Math.abs(layout.y + layout.height / 2) > 1) {
      c.save(); c.translate(corridor.x, corridor.midY); c.scale(1 / scale, 1 / scale);
      const x = Math.max(layout.x, Math.min(layout.x + layout.width, 0));
      const y = Math.max(layout.y, Math.min(layout.y + layout.height, 0));
      stroke(c, [[0, 0], [x, y]], TEAMS[corridor.side], 1); c.restore();
    }
  }
  c.restore();
  return { ...signals, scale, banners, next };
}

/** Text and direction glyphs clear actor pennants; mission overlays stay above. */
export function drawFlightLabels(renderer, { scale, banners, preview, next }) {
  if (!banners.length && !next) return;
  const c = renderer.c;
  c.save(); c.globalAlpha = 1; c.lineCap = 'round'; c.lineJoin = 'round'; c.setLineDash([]);
  // Paint complete opaque banners, not only their text, over the actor layer.
  for (const layout of banners) {
    const { corridor } = layout;
    c.save(); c.translate(corridor.x, corridor.midY); c.scale(1 / scale, 1 / scale);
    banner(c, corridor, layout); c.restore();
  }
  if (next) {
    c.save(); c.translate(preview.sourceX, preview.sourceY); c.scale(1 / scale, 1 / scale);
    const { x, y, width, height } = next;
    c.fillStyle = INK; c.fillRect(x, y, width, height);
    c.strokeStyle = NEXT; c.lineWidth = 1; c.strokeRect(x + .5, y + .5, width - 1, height - 1);
    c.fillStyle = NEXT; c.font = '700 12px monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(`NEXT ${preview.direction < 0 ? '↑' : '↓'}`, x + width / 2, y + height / 2); c.restore();
  }
  c.restore();
}

/**
 * CSS-pixel minimap overlay; caller retains the DPR transform and camera outline.
 * Geometry: {width,height,x?:0,y?:0,selected?:buildingId}. Includes launched
 * approaches, not unlaunched enemy plans. No canvas reset or persistent state.
 */
export function drawFlightMinimap(c, game, { width, height, x = 0, y = 0, selected = null } = {}) {
  if (![width, height, x, y].every(finite) || width <= 0 || height <= 0) return { routes: [], preview: null };
  const signals = buildFlightSignals(game, { selected, includeApproach: true });
  if (!signals.routes.length && !signals.preview) return signals;
  const sx = width / game.map.width, sy = height / game.map.height;
  c.save(); c.globalAlpha = 1; c.lineCap = 'round'; c.lineJoin = 'round'; c.setLineDash([]);
  c.beginPath(); c.rect(x, y, width, height); c.clip();
  const draw = (route, preview = false) => {
    const px = x + route.x * sx + (preview ? -3 : route.direction * 2), start = y + route.fromY * sy, end = y + route.toY * sy;
    const color = preview ? NEXT : TEAMS[route.side];
    const dash = preview ? [1, 3] : route.transitCount ? [] : route.warningCount ? [2, 2] : [1, 3];
    stroke(c, [[px, start], [px, end]], color, preview ? 1 : 1.5, dash);
    chevron(c, px, end - route.direction, route.direction, color, 2.5);
    if (!preview) teamMark(c, px, start, route.side, 2.4, color);
  };
  if (signals.preview) draw(signals.preview, true);
  for (const route of signals.routes) draw(route);
  c.restore(); return signals;
}
