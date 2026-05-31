/**
 * sw.js — Service Worker do Bambui Bar
 * 
 * - Versão injetada pelo build (vite substitui __APP_VERSION__)
 * - Cache-first para assets, network-first para API
 * - Detecta nova versão e notifica o app
 */

const APP_VERSION = "__APP_VERSION__";
const CACHE_NAME = "bambuibar-v" + APP_VERSION;

// Arquivos que sempre devem ser cacheados no install
const PRECACHE = [
  "/",
  "/index.html",
  "/manifest.json",
  "/logo.jpg",
  "/icon-192x192.png",
  "/icon-512x512.png",
];

// ─── Install: pré-cacheia assets essenciais ───────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE))
  );
  // Ativa imediatamente sem esperar a aba fechar
  self.skipWaiting();
});

// ─── Activate: apaga caches antigos ──────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith("bambuibar-") && k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ─── Fetch: estratégia por tipo de request ────────────────────────────────
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Ignora chamadas ao Supabase — sempre vai pra rede
  if (url.hostname.includes("supabase.co")) return;

  // Ignora POST/PUT/DELETE — não faz sentido cachear
  if (event.request.method !== "GET") return;

  // Para navegação (HTML): network-first com fallback para cache
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
          return res;
        })
        .catch(() => caches.match("/index.html"))
    );
    return;
  }

  // Para assets (JS, CSS, imagens): cache-first
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
        }
        return res;
      });
    })
  );
});

// ─── Mensagens do app ──────────────────────────────────────────────────────
self.addEventListener("message", (event) => {
  if (event.data?.type === "GET_VERSION") {
    event.ports[0]?.postMessage({ version: APP_VERSION });
  }
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
