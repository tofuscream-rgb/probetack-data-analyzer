import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Content-Security-Policy injected into the production build only.
 * connect-src 'self' means the page itself cannot send data (fetch, XHR,
 * WebSocket, beacons) to any other server — a browser-enforced privacy guard.
 * It is not added in dev mode because Vite's hot-reload uses WebSockets.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

function cspPlugin(): Plugin {
  return {
    name: 'inject-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<!--CSP-->',
        `<meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      );
    },
  };
}

// BASE_PATH is set by the GitHub Actions workflow to "/<repository-name>/"
// so the site works at https://<user>.github.io/<repository-name>/.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/mach1-analyzer/',
  plugins: [react(), cspPlugin()],
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 6000, sourcemap: false },
});
