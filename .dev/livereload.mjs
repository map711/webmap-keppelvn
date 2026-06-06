// Live-reload support for the dev harness. Zero dependencies. ESM (.mjs).
// Only used on the human dev path (owner=human); the agent path never loads it.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Marker id makes injection idempotent and detectable in tests.
const SCRIPT = `<script id="__dev_livereload">
(function () {
  try {
    var es = new EventSource('/__dev/livereload');
    es.addEventListener('reload', function () { location.reload(); });
  } catch (e) { /* no EventSource -> no live reload, page still works */ }
})();
</script>`;

// Pure helper: insert the live-reload client script into an HTML string.
// Idempotent; inserts before the last </body>, appends if there is none.
export function injectLivereload(html) {
  if (html.includes('id="__dev_livereload"')) return html;
  const idx = html.lastIndexOf('</body>');
  if (idx === -1) return html + SCRIPT;
  return html.slice(0, idx) + SCRIPT + html.slice(idx);
}

// SSE hub: tracks open EventSource connections and pushes reload events.
export function createLivereloadHub() {
  const clients = new Set();
  return {
    handle(req, res) {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      res.write('retry: 1000\n\n'); // tell EventSource to reconnect quickly
      clients.add(res);
      req.on('close', () => clients.delete(res));
    },
    triggerReload() {
      for (const res of clients) {
        try {
          res.write('event: reload\ndata: {}\n\n');
        } catch {
          clients.delete(res);
        }
      }
    },
    clientCount() {
      return clients.size;
    },
  };
}

// Watch dist/ + demo/ + datas/ (recursive, debounced) and call onChange on any
// edit. Returns a stop() function. Missing dirs are skipped silently.
//
// Why these dirs and not src/: the human edits src/, but `rollup -c -w` (spawned
// alongside) rebuilds dist/ on every src change — so the dist/ watch is the
// reliable single reload signal for src edits too (no double-fire). demo/ and
// datas/ are watched directly because they are served as-is, not built.
export function startWatcher(root, onChange, debounceMs = 100) {
  const dirs = [path.join(root, 'dist'), path.join(root, 'demo'), path.join(root, 'datas')];
  let timer = null;
  const fire = () => {
    clearTimeout(timer);
    timer = setTimeout(onChange, debounceMs);
  };
  const watchers = [];
  for (const dir of dirs) {
    try {
      watchers.push(fs.watch(dir, { recursive: true }, fire));
    } catch (e) {
      // A missing dir (ENOENT) is fine — it may not exist yet. But recursive
      // watch is unsupported on Linux (ERR_FEATURE_UNAVAILABLE_ON_PLATFORM),
      // where the throw would otherwise silently disable live-reload for this
      // tree with no explanation. Surface anything that isn't just-not-there.
      if (e.code !== 'ENOENT') {
        console.warn(`[dev] live-reload watch unavailable for ${dir}: ${e.message}`);
      }
    }
  }
  return () => {
    clearTimeout(timer);
    for (const w of watchers) {
      try {
        w.close();
      } catch {
        /* already closed */
      }
    }
  };
}

// Spawn `rollup -c -w` as a child so src/ edits incrementally rebuild dist/.
// Output is prefixed [rollup]. Caller is responsible for killing the child.
export function spawnRollupWatch(root) {
  const bin = path.join(root, 'node_modules', '.bin', 'rollup');
  const child = spawn(bin, ['-c', '-w'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  const prefix = (buf) =>
    buf
      .toString()
      .split('\n')
      .filter(Boolean)
      .map((l) => `[rollup] ${l}`)
      .join('\n');
  child.stdout.on('data', (b) => console.log(prefix(b)));
  child.stderr.on('data', (b) => console.error(prefix(b)));
  child.on('exit', (code) =>
    console.warn(`[rollup] watch process exited (code=${code}); static serving continues.`)
  );
  return child;
}
