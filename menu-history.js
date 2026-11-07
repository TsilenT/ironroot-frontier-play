// Same-document menu history. Only opaque IDs are serialized; UI routes remain
// in this document's registry. Never persist a Game, save, or executable action.
const KEY = 'ironrootNavigation';
const VERSION = 1;
const same = (a, b) => a.length === b.length && a.every((route, i) => route.key === b[i].key);
const snapshot = trail => trail.map(route => Object.freeze({...route}));
// A return from the separate, optional practice document already has a real
// Back destination. Do not put manufactured campaign parents in front of it.
// Referrer is only a navigation hint, never authority to read or restore data.
export function seedMenuAncestors(referrer, href) {
  try {
    const current = new URL(href), previous = new URL(referrer);
    const practice = new URL('./training.html', current);
    return previous.origin !== current.origin || previous.pathname !== practice.pathname;
  } catch { return true; }
}
export function createMenuHistory({history, listen, read, apply, unknown, defer = queueMicrotask,
  seedAncestors = true,
  token = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`}) {
  const entries = [];
  let cursor = -1, serial = 0, pending = null, applying = false, enabled = true, detached = null;
  const marker = state => state && typeof state === 'object' && !Array.isArray(state) ? state[KEY] : null;
  const stateFor = id => {
    const state = history.state;
    // Do not reinterpret another application's primitive/array state.
    if (state !== null && (typeof state !== 'object' || Array.isArray(state))) throw Error('Foreign history state');
    return {...state, [KEY]: {version: VERSION, document: token, entry: id}};
  };
  function write(method, entry) {
    try { history[method](stateFor(entry.id), ''); return true; }
    catch { enabled = false; pending = null; return false; }
  }
  function replace(trail) {
    const entry = entries[cursor];
    entry.trail = snapshot(trail);
    write('replaceState', entry);
  }
  function append(trail) {
    const entry = {id: `${token}:${++serial}`, trail: snapshot(trail)};
    if (!write('pushState', entry)) return false;
    entries.splice(cursor + 1, Infinity, entry); cursor++;
    return true;
  }
  function establish(trail) {
    entries.length = 0; cursor = 0;
    entries.push({id: `${token}:${++serial}`, trail: snapshot(trail)});
    return write('replaceState', entries[0]);
  }
  function sync(trail = read()) {
    if (!enabled || applying || !trail.length) return;
    if (pending) { pending.latest = snapshot(trail); return; }
    if (detached) {
      if (same(detached, trail)) return;
      const prior = detached; detached = null;
      if (!establish(prior)) return;
    }
    if (cursor < 0) {
      // Reload/re-entry must not accumulate another synthetic ancestry. The old
      // document's markers are stale, not permission to restore its UI or game.
      const singleEntry = !!marker(history.state) || !seedAncestors;
      if (!establish(singleEntry ? trail : trail.slice(0, 1))) return;
      if (singleEntry) return;
    }
    let current = entries[cursor].trail;
    if (same(current, trail)) { entries[cursor].trail = snapshot(trail); return; }
    // Updating the selection at a given depth updates its in-memory ancestors,
    // so Mission -> Chapter always names that mission's actual chapter.
    for (let i = 0; i < cursor; i++) {
      const depth = entries[i].trail.length;
      if (depth < trail.length) entries[i].trail = snapshot(trail.slice(0, depth));
    }
    if (trail.length > current.length && cursor > 0 && same(entries[cursor - 1].trail, current)) {
      // Forward into live play is rendered paused. Reuse that surplus slot on
      // explicit Resume/open, rather than appending after a duplicate pause.
      // Consecutive safe fallbacks may leave more than one surplus slot.
      let reusable = cursor;
      while (reusable > 1 && same(entries[reusable - 2].trail, current)) reusable--;
      if (reusable < cursor) {
        pending = {id: entries[reusable].id, latest: snapshot(trail)};
        try { history.go(reusable - cursor); } catch { pending = null; enabled = false; }
        return;
      }
      replace(trail.slice(0, current.length + 1));
      current = entries[cursor].trail;
      if (same(current, trail)) return;
    }
    if (trail.length < current.length) {
      let destination = cursor - 1;
      while (destination >= 0 && entries[destination].trail.length !== trail.length) destination--;
      if (destination >= 0) {
        entries[destination].trail = snapshot(trail);
        pending = {id: entries[destination].id, latest: snapshot(trail)};
        try { history.go(destination - cursor); } catch { pending = null; enabled = false; }
        return;
      }
      replace(trail); return;
    }
    replace(trail.slice(0, current.length));
    for (let depth = current.length + 1; depth <= trail.length; depth++) {
      if (!append(trail.slice(0, depth))) break;
    }
  }
  function pop(event) {
    if (!enabled) return;
    const value = marker(event.state), actual = marker(history.state);
    const index = value?.version === VERSION && value.document === token &&
      actual?.document === token && actual.entry === value.entry
      ? entries.findIndex(entry => entry.id === value.entry) : -1;
    const queued = pending; pending = null;
    if (index < 0) {
      // Foreign and stale states cannot specify a route. Use only the live UI
      // to dismiss one layer or pause. Do not push or rewrite the foreign entry.
      applying = true;
      try { unknown(); } finally { applying = false; detached = snapshot(read()); }
      return;
    }
    const direction = index < cursor ? 'back' : 'forward';
    cursor = index;
    if (queued?.id === entries[index].id) {
      // A visible Close/Resume already changed the UI. Its asynchronous go()
      // must not undo a later click. This is reconciliation of that UI action,
      // not a new guard entry in response to the user's browser Back.
      defer(() => sync(queued.latest));
      return;
    }
    applying = true;
    try { apply(entries[index].trail.at(-1), {direction}); }
    finally { applying = false; replace(read()); }
  }
  function reconcile() {
    if (!enabled) return;
    pending = null;
    const value = marker(history.state);
    const index = value?.version === VERSION && value.document === token
      ? entries.findIndex(entry => entry.id === value.entry) : -1;
    if (index < 0) { detached = snapshot(read()); return; }
    cursor = index; detached = null; replace(read());
  }
  const unlisten = listen(pop);
  sync();
  return {sync, reconcile, dispose() { unlisten?.(); enabled = false; }, get available() { return enabled; }};
}
