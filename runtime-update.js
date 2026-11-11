// Discovery never navigates. Only an explicit action may request a guarded reload.
const MESSAGE = 'IRONROOT_RUNTIME_VERSION';
function parts(version) {
  const match = typeof version === 'string' && version.length < 64 && version.match(/^ironroot-v(\d+)\.(\d+)\.(\d+)$/);
  const values = match && match.slice(1).map(Number);
  return values && values.every(Number.isSafeInteger) ? values : null;
}
export function newerRuntime(candidate, current) {
  const a = parts(candidate), b = parts(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
export function readWorkerVersion(worker, {timeoutMs = 2000, channel = () => new MessageChannel()} = {}) {
  if (!worker) return Promise.resolve(null);
  return new Promise(resolve => {
    let ports, timer;
    const done = version => {
      clearTimeout(timer);
      ports?.port1.close(); ports?.port2.close();
      resolve(parts(version) ? version : null);
    };
    try {
      ports = channel();
      ports.port1.onmessage = event => done(event.data?.type === MESSAGE ? event.data.version : null);
      timer = setTimeout(() => done(null), timeoutMs);
      worker.postMessage({type: MESSAGE}, [ports.port2]);
    } catch { done(null); }
  });
}
export function createRuntimeUpdate({serviceWorker, version, prepareReload, reload, onChange = () => {},
  readVersion = readWorkerVersion, now = Date.now, checkIntervalMs = 60000}) {
  if (!parts(version)) throw new TypeError('A current runtime version is required.');
  let alive = false, lifetime = 0, probeId = 0, lastCheck = -Infinity, checking = null;
  let state = {available: false, pending: false, version: null, message: ''};
  const notify = patch => { state = {...state, ...patch}; if (alive) onChange({...state}); };
  async function probe() {
    const generation = ++probeId, life = lifetime, worker = serviceWorker.controller;
    let found;
    try { found = await readVersion(worker); } catch { return; }
    if (!alive || lifetime !== life || generation !== probeId || serviceWorker.controller !== worker || !parts(found)) return;
    const available = newerRuntime(found, version);
    notify({available, version: available ? found : null, ...(available === state.available ? {} : {message: ''})});
  }
  const changed = () => { void probe(); };
  async function check() {
    if (!alive) return;
    void probe();
    if (checking || now() - lastCheck < checkIntervalMs) return checking;
    lastCheck = now();
    const life = lifetime;
    checking = (async () => {
      try {
        const registration = await serviceWorker.getRegistration();
        if (!alive || lifetime !== life) return;
        await registration?.update();
        if (alive && lifetime === life) await probe();
      } catch { /* Offline discovery is quiet; no reload or storage changes. */ }
    })();
    try { await checking; } finally { checking = null; }
  }
  async function apply() {
    if (!alive || !state.available || state.pending) return false;
    const life = lifetime, worker = serviceWorker.controller;
    notify({pending: true, message: 'Preparing update…'});
    try {
      const found = await readVersion(worker);
      if (!alive || lifetime !== life) return false;
      if (serviceWorker.controller !== worker || !newerRuntime(found, version)) {
        notify({message: 'The update is not ready yet. Keep this page open and try again.'});
        return false;
      }
      // The guard runs after the asynchronous worker check. Nothing may await
      // between checking the latest save state and requesting navigation.
      const ready = prepareReload();
      if (ready?.ok !== true) {
        notify({message: ready?.message || 'Could not verify saving. Keep this page open and try again.'});
        return false;
      }
      if (!alive || lifetime !== life || serviceWorker.controller !== worker) return false;
      notify({message: 'Reloading the game…'});
      reload();
      return true;
    } catch {
      if (alive && lifetime === life) notify({message: 'Could not update. Keep this page open and try again.'});
      return false;
    } finally {
      if (alive && lifetime === life) notify({pending: false});
    }
  }
  return {
    state: () => ({...state}), check, apply,
    start() {
      if (alive) return;
      alive = true; lifetime++; lastCheck = -Infinity;
      serviceWorker.addEventListener('controllerchange', changed);
      void check();
    },
    stop() {
      alive = false; lifetime++; probeId++; state = {...state, pending: false, message: ''};
      serviceWorker.removeEventListener('controllerchange', changed);
    },
  };
}
