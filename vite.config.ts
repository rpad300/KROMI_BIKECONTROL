import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { resolve } from 'path';

// Inject git version at build time — fallback chain for Vercel shallow clones
const gitVersion = (() => {
  // 1. Try git describe (works locally, fails on Vercel shallow clone)
  try {
    const tag = require('child_process').execSync('git describe --tags --always', { encoding: 'utf-8' }).trim();
    if (tag && tag !== 'dev') return tag;
  } catch { /* shallow clone — no tags */ }
  // 2. Vercel exposes VERCEL_GIT_COMMIT_REF (branch or tag name)
  const ref = process.env.VERCEL_GIT_COMMIT_REF;
  if (ref && ref.startsWith('v')) return ref; // tag deploy (e.g. "v1.5.5")
  // 3. Fallback to package.json version
  try {
    const pkg = require('./package.json');
    return `v${pkg.version}`;
  } catch { return 'dev'; }
})();

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(gitVersion),
  },
  plugins: [
    react(),
    tailwindcss(),
    basicSsl(), // Web Bluetooth requires HTTPS
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico'],
      manifest: {
        name: 'Giant eBike Command Center',
        short_name: 'BikeControl',
        description: 'Computador de bordo para Giant eBike com Smart Gateway',
        theme_color: '#111827',
        background_color: '#030712',
        display: 'fullscreen',
        orientation: 'portrait',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        // Force new SW to take over immediately — no stale cache
        skipWaiting: true,
        clientsClaim: true,
        // Clean old precache on update
        cleanupOutdatedCaches: true,
        // SPA fallback — serve index.html for all navigation requests
        navigateFallback: '/index.html',
        // Don't intercept standalone HTML pages (served as static files, not SPA)
        navigateFallbackDenylist: [/^\/live\.html/, /^\/emergency\.html/, /^\/club\.html/, /^\/ride\.html/],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/maps\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-maps-cache',
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  server: {
    host: true, // Expose on LAN for mobile testing
  },
});
