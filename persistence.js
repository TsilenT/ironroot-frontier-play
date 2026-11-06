/** Storage may be absent, denied or full. Never report an unwritten save as saved. */
export function createStorage(getBackend) {
  return {
    read(key) {
      try {
        return { ok: true, value: getBackend().getItem(key) };
      } catch {
        return { ok: false, value: null };
      }
    },
    get(key) {
      return this.read(key).value;
    },
    set(key, value) {
      try {
        getBackend().setItem(key, value);
        return true;
      } catch {
        return false;
      }
    },
    remove(key) {
      try {
        getBackend().removeItem(key);
        return true;
      } catch {
        return false;
      }
    },
  };
}
export function readHistory(storage, key) {
  try {
    const value = JSON.parse(storage.get(key) || '[]');
    return Array.isArray(value)
      ? value
          .filter((x) => x && typeof x === 'object' && !Array.isArray(x))
          .slice(0, 30)
      : [];
  } catch {
    return [];
  }
}
export function writeBattle(
  storage,
  key,
  game,
  challengeId = null,
  campaignId = null,
) {
  try {
    return storage.set(
      key,
      JSON.stringify({
        format: 'ironroot-save',
        version: 2,
        challengeId,
        campaignId,
        game: game.serialize(),
      }),
    );
  } catch {
    return false;
  }
}
export function nativeSpaceTarget(target) {
  return !!target?.closest?.(
    'button,input,select,textarea,a[href],summary,[contenteditable="true"]',
  );
}

/** Optimistic ownership protects a newer tab's battle from a stale tab's writes.
 * A deliberate new/resumed battle claims the current value; every write checks it.
 * Identical saves are a no-op, so hiding an already-paused tab does not rewrite it.
 */
export function createSaveSession(storage, key) {
  let expected = null,
    claimed = false,
    unavailableClaim = false;
  const read = () => {
    try {
      return storage.read
        ? storage.read(key)
        : { ok: true, value: storage.get(key) };
    } catch {
      return { ok: false, value: null };
    }
  };
  return {
    claim() {
      const current = read();
      expected = current.value;
      claimed = current.ok;
      unavailableClaim = !current.ok;
      return current.ok;
    },
    status() {
      const current = read();
      if (!current.ok) return 'unavailable';
      // A game begun with storage denied may recover only into an empty slot.
      if (!claimed && unavailableClaim && current.value === null) {
        expected = null;
        claimed = true;
        unavailableClaim = false;
      }
      return claimed && current.value === expected ? 'current' : 'stale';
    },
    isCurrent() {
      return this.status() === 'current';
    },
    set(target, value) {
      if (target !== key || !this.isCurrent()) return false;
      if (value === expected) return true;
      if (!storage.set(key, value)) return false;
      expected = value;
      return true;
    },
    remove() {
      if (!this.isCurrent()) return false;
      if (expected === null) return true;
      if (!storage.remove(key)) return false;
      expected = null;
      return true;
    },
  };
}
