/** Storage may be absent, denied or full. Never report an unwritten save as saved. */
export function createStorage(getBackend) {
  return {
    get(key) { try { return getBackend().getItem(key); } catch { return null; } },
    set(key,value) { try { getBackend().setItem(key,value); return true; } catch { return false; } },
    remove(key) { try { getBackend().removeItem(key); return true; } catch { return false; } },
  };
}
export function readHistory(storage,key) {
  try { const value=JSON.parse(storage.get(key)||'[]'); return Array.isArray(value)?value.filter(x=>x&&typeof x==='object'&&!Array.isArray(x)).slice(0,30):[]; }
  catch { return []; }
}
export function writeBattle(storage,key,game,challengeId=null) {
  try { return storage.set(key,JSON.stringify({format:'ironroot-save',version:1,challengeId,game:game.serialize()})); }
  catch { return false; }
}
export function nativeSpaceTarget(target) {
  return !!target?.closest?.('button,input,select,textarea,a[href],summary,[contenteditable="true"]');
}
