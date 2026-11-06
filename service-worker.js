// Atomic, versioned offline shell. Bump VERSION with every public build.
const VERSION='ironroot-v0.5.0';
const FILES=['./','./index.html','./styles.css','./app.js','./engine.js','./render.js','./challenges.js','./persistence.js','./audio.js','./vfx.js','./icon.svg','./manifest.webmanifest'];
self.addEventListener('install',event=>event.waitUntil(caches.open(VERSION).then(cache=>cache.addAll(FILES)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('ironroot-')&&k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{const request=event.request,url=new URL(request.url);if(request.method!=='GET'||url.origin!==self.location.origin)return;if(request.mode==='navigate'){event.respondWith(caches.open(VERSION).then(cache=>cache.match('./index.html')).then(cached=>cached||fetch(request)));return;}event.respondWith(caches.open(VERSION).then(cache=>cache.match(request)).then(cached=>cached||fetch(request)));});
