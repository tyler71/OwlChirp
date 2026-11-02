// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { AstroPWAIntegration } from '@vite-pwa/astro';

// The Go backend (just dev-backend) listens here during development.
const backend = process.env.BACKEND_URL ?? 'http://127.0.0.1:4444';

// https://astro.build/config
export default defineConfig({
  integrations: [
    react(),
    AstroPWAIntegration({
      // Never swap versions under an agent mid-call: the app shows an "Update" button instead (lib/pwa.ts).
      registerType: 'prompt',
      injectRegister: false,
      // Icons are generated from public/logo.svg at build time.
      pwaAssets: { image: 'public/logo.svg', preset: 'minimal-2023' },
      manifest: {
        name: 'OwlChirp',
        short_name: 'OwlChirp',
        description: 'OwlChirp contact center softphone',
        start_url: '/ccp',
        scope: '/',
        display: 'standalone',
        theme_color: '#4f46e5',
        background_color: '#ffffff',
      },
      // amazon-connect-streams alone is ~600 kB.
      maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      generateSW: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        // The app needs the backend and Connect to do anything, so no offline navigation fallback.
        // /api, /ws and /ping are not precached and stay network-only.
        navigateFallback: null,
      },
    }),
  ],
  output: 'static',
  outDir: './dist',

  // Serve dev on 127.0.0.1 so the page origin matches Connect's approved origin.
  server: { host: '127.0.0.1' },

  // Emit /ccp as ccp.html so the Go server can map /ccp → ccp.html.
  build: {
    format: 'file',
  },

  vite: {
    plugins: [tailwindcss()],
    // amazon-connect-streams alone is ~600 kB.
    build: { chunkSizeWarningLimit: 1024 },
    server: {
      proxy: {
        // No changeOrigin: the backend's WebSocket same-origin check needs Host to match the browser's Origin.
        '/api': { target: backend, ws: true },
        '/ping': { target: backend, changeOrigin: true },
      },
    },
  },
});
