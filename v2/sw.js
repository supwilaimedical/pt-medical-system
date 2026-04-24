// PT Medical V2 — Service Worker (scoped to /v2/)
// Network-first strategy with cache fallback

var CACHE_NAME = 'pt-v2-v1';
var V2_SCOPE = '/pt-medical-system/v2/';

var STATIC_ASSETS = [
  V2_SCOPE,
  V2_SCOPE + 'index.html',
  V2_SCOPE + 'shared.css',
  V2_SCOPE + 'shared.js',
  V2_SCOPE + 'manifest.json'
];

self.addEventListener('install', function(e){
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache){
      return cache.addAll(STATIC_ASSETS).catch(function(){});
    }).then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.map(function(k){
        if(k !== CACHE_NAME && k.indexOf('pt-v2-') === 0) return caches.delete(k);
      }));
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(e){
  var url = new URL(e.request.url);

  // Only handle requests within our scope
  if(!url.pathname.startsWith(V2_SCOPE) && !url.pathname.startsWith('/pt-medical-system/shared/') && !url.pathname.startsWith('/pt-medical-system/assets/')) return;

  // Skip non-GET
  if(e.request.method !== 'GET') return;

  // Network-first
  e.respondWith(
    fetch(e.request).then(function(res){
      if(res && res.status === 200 && res.type === 'basic'){
        var clone = res.clone();
        caches.open(CACHE_NAME).then(function(c){ c.put(e.request, clone); });
      }
      return res;
    }).catch(function(){
      return caches.match(e.request).then(function(cached){
        return cached || caches.match(V2_SCOPE);
      });
    })
  );
});
