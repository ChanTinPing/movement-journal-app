const CACHE_NAME = "movement-journal-v2";
const SCOPE_PATH = new URL(self.registration.scope).pathname;
const APP_SHELL = [
  SCOPE_PATH,
  `${SCOPE_PATH}index.html`,
  `${SCOPE_PATH}manifest.webmanifest`,
  `${SCOPE_PATH}icon.svg`,
  `${SCOPE_PATH}icon-192.png`,
  `${SCOPE_PATH}icon-512.png`,
  `${SCOPE_PATH}apple-touch-icon.png`,
];

const cacheResponse = (request, response) => {
  if (response.ok) {
    const copy = response.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
  }

  return response;
};

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") {
    return;
  }

  const freshRequest = new Request(request, { cache: "no-store" });

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(freshRequest)
        .then((response) => {
          cacheResponse(`${SCOPE_PATH}index.html`, response);
          return cacheResponse(request, response);
        })
        .catch(() => caches.match(`${SCOPE_PATH}index.html`)),
    );
    return;
  }

  event.respondWith(
    fetch(freshRequest)
      .then((response) => cacheResponse(request, response))
      .catch(() => caches.match(request)),
  );
});
