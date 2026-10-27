// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';

// The Go backend (just dev-backend) listens here during development.
const backend = process.env.BACKEND_URL ?? 'http://127.0.0.1:4444';

// https://astro.build/config
export default defineConfig({
  integrations: [react()],
  output: 'static',
  outDir: './dist',

  // Serve dev on 127.0.0.1 so the page origin matches Connect's approved origin.
  server: { host: '127.0.0.1' },

  // Emit /ccp as ccp.html so the Go server can map /ccp → ccp.html.
  build: {
    format: 'file',
  },

  vite: {
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
