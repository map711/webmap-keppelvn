// Static file server for viewing the project's HTML. Zero dependencies.
//
//   npm run dev          -> owner = "human"  (what you leave running)
//   DEV_OWNER=agent ...  -> owner = "agent"  (set by dev:ensure for the pipeline)
//
// Behaviour:
//  - If a keppelvn dev server is ALREADY healthy on the port, this reuses it and
//    exits 0 (never starts a second instance, never kills the first).
//  - If the port is held by some OTHER process, it fails fast (no port hopping,
//    nothing killed).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT,
  resolvePort,
  resolveHost,
  resolveServeDir,
  writeState,
  clearState,
  health,
  isAlive,
  waitUntil,
  SENTINEL,
} from './_shared.mjs';
import { injectLivereload, createLivereloadHub, startWatcher, spawnRollupWatch } from './livereload.mjs';

const PORT = resolvePort();
const HOST = resolveHost();
const SERVE_DIR = resolveServeDir();
const OWNER = process.env.DEV_OWNER || 'human';
// Live-reload is the human dev experience only. The agent path (owner=agent,
// started by dev:ensure) stays a pure static server, byte-identical to before.
const WATCH = OWNER === 'human';
const hub = WATCH ? createLivereloadHub() : null;
let rollupChild = null;
let stopWatcher = null;
const startedAt = new Date().toISOString();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.geojson': 'application/geo+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.pbf': 'application/x-protobuf', // vector tiles
  '.mvt': 'application/x-protobuf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  } catch {
    res.writeHead(400);
    res.end('Bad Request');
    return;
  }

  if (pathname === '/__dev/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({ ok: true, sentinel: SENTINEL, pid: process.pid, owner: OWNER, port: PORT, startedAt })
    );
    return;
  }

  if (WATCH && pathname === '/__dev/livereload') {
    hub.handle(req, res);
    return;
  }

  // Resolve + path-traversal guard.
  let filePath = path.join(SERVE_DIR, path.normalize(pathname));
  if (filePath !== SERVE_DIR && !filePath.startsWith(SERVE_DIR + path.sep)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, st) => {
    if (!err && st.isDirectory()) {
      // Standard static-server behaviour: redirect /dir -> /dir/ so the browser
      // keeps the directory as its base URL and relative links inside index.html
      // (e.g. <a href="bare.html"> in /demo/) resolve to /demo/bare.html, not
      // /bare.html.
      if (!pathname.endsWith('/')) {
        const qs = req.url.indexOf('?');
        res.writeHead(301, { location: pathname + '/' + (qs >= 0 ? req.url.slice(qs) : '') });
        res.end();
        return;
      }
      filePath = path.join(filePath, 'index.html');
    }
    fs.readFile(filePath, (err2, data) => {
      if (err2) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found');
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      if (WATCH && (ext === '.html' || ext === '.htm')) {
        res.writeHead(200, { 'content-type': MIME[ext] });
        res.end(injectLivereload(data.toString('utf8')));
        return;
      }
      res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream' });
      res.end(data);
    });
  });
});

// Wait until the old server is fully gone (stops answering health AND its pid
// has exited so the port is released). Used by the human>agent takeover.
function waitForGone(pid) {
  return waitUntil(async () => !(await health(PORT, HOST)) && !(pid && isAlive(pid)));
}

async function main() {
  // Singleton guard with a human>agent priority rule:
  //  - existing human server      -> reuse + exit (never double-start)
  //  - existing agent server + us being human -> reclaim the port for live-reload
  //  - otherwise (agent path)     -> reuse + exit
  const existing = await health(PORT, HOST);
  if (existing) {
    if (WATCH && existing.owner === 'agent') {
      console.log(
        `[dev] reclaiming agent-owned server (pid=${existing.pid}) on :${PORT} to enable live-reload.`
      );
      try {
        process.kill(existing.pid, 'SIGTERM');
      } catch {
        /* already gone */
      }
      const gone = await waitForGone(existing.pid);
      if (!gone) {
        console.error(`[dev] agent server on :${PORT} did not release the port; aborting.`);
        process.exit(1);
      }
    } else {
      console.log(
        `[dev] already running on http://${HOST}:${PORT} (owner=${existing.owner}, pid=${existing.pid}) — reusing, not starting a second instance.`
      );
      process.exit(0);
    }
  }

  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(
        `[dev] port ${PORT} is in use by a non-dev process. Refusing to start (no port hopping, nothing killed).`
      );
      process.exit(1);
    }
    throw e;
  });

  server.listen(PORT, HOST, () => {
    writeState({ pid: process.pid, port: PORT, host: HOST, owner: OWNER, startedAt, dir: SERVE_DIR });
    console.log(`[dev] serving ${SERVE_DIR} at http://${HOST}:${PORT}  (owner=${OWNER}, pid=${process.pid})`);
    if (WATCH) {
      stopWatcher = startWatcher(ROOT, () => hub.triggerReload());
      if (!process.env.DEV_NO_ROLLUP) rollupChild = spawnRollupWatch(ROOT);
      console.log(
        `[dev] live-reload on — watching dist/ + demo/ + datas/, EventSource at /__dev/livereload` +
          (process.env.DEV_NO_ROLLUP ? ' (rollup watch skipped: DEV_NO_ROLLUP)' : ', rollup -c -w spawned')
      );
    }
  });

  const shutdown = (sig) => {
    console.log(`[dev] received ${sig}, shutting down (pid=${process.pid}).`);
    if (stopWatcher) stopWatcher();
    if (rollupChild) {
      try {
        rollupChild.kill('SIGTERM');
      } catch {
        /* already gone */
      }
    }
    clearState(process.pid);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
