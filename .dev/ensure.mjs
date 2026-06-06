// dev:ensure — make sure a dev server is up, without ever disturbing one that
// already is. Idempotent and safe to call from the pipeline / Claude Code.
//
//  - already healthy  -> no-op, exit 0
//  - not running      -> start server.mjs DETACHED as owner=agent, wait for health
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePort, resolveHost, health, waitUntil } from './_shared.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = resolvePort();
const HOST = resolveHost();
const LOG_FILE = path.join(__dirname, 'agent-server.log');

async function main() {
  const existing = await health(PORT, HOST);
  if (existing) {
    console.log(`[dev:ensure] already up on :${PORT} (owner=${existing.owner}, pid=${existing.pid}) — no-op.`);
    process.exit(0);
  }

  // The server is detached + unref'd, so its stdio outlives this process. Send
  // it to a log file (not /dev/null) so a startup failure — e.g. EADDRINUSE from
  // a foreign process — leaves a diagnosable trail instead of just "unhealthy".
  const out = fs.openSync(LOG_FILE, 'a');
  const child = spawn(process.execPath, [path.join(__dirname, 'server.mjs')], {
    detached: true,
    stdio: ['ignore', out, out],
    env: { ...process.env, DEV_OWNER: 'agent' },
  });
  child.unref();
  fs.closeSync(out); // the child holds its own dup'd fd; ours is no longer needed

  const h = await waitUntil(() => health(PORT, HOST));
  if (h) {
    console.log(`[dev:ensure] started on :${PORT} (owner=agent, pid=${h.pid}).`);
    process.exit(0);
  }
  console.error(`[dev:ensure] failed to become healthy on :${PORT}. See ${LOG_FILE} for the server's output.`);
  process.exit(1);
}

main();
