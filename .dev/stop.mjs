// dev:stop — stop ONLY a dev server that the pipeline started (owner=agent).
// Refuses to stop a human-owned server unless --force is passed.
//
// Exit code is 0 even on refusal, so a pipeline calling `npm run dev:stop` in
// its teardown does not register a failure when it correctly leaves your server
// alone.
import { readState, clearState, isAlive, resolvePort, resolveHost, health } from './_shared.mjs';

const force = process.argv.includes('--force');

async function main() {
  const PORT = resolvePort();
  const HOST = resolveHost();
  const state = readState();

  // No state file: maybe an unmanaged server is up.
  if (!state) {
    const h = await health(PORT, HOST);
    if (!h) {
      console.log('[dev:stop] no dev server running.');
      process.exit(0);
    }
    console.log(
      `[dev:stop] a dev server is on :${PORT} (owner=${h.owner}, pid=${h.pid}) with no state file. ` +
        (force ? 'Forcing stop.' : 'Refusing without --force.')
    );
    if (force) {
      try {
        process.kill(h.pid, 'SIGTERM');
      } catch {
        /* ignore */
      }
    }
    process.exit(0);
  }

  // Stale record.
  if (!isAlive(state.pid)) {
    console.log(`[dev:stop] recorded pid ${state.pid} is not alive; clearing stale state.`);
    clearState(state.pid);
    process.exit(0);
  }

  // The guarantee: never stop a human-owned server unless forced.
  if (state.owner !== 'agent' && !force) {
    console.log(
      `[dev:stop] dev server on :${state.port} is owned by '${state.owner}' (pid=${state.pid}). ` +
        `Refusing to stop a non-agent server. Use --force to override.`
    );
    process.exit(0);
  }

  try {
    process.kill(state.pid, 'SIGTERM');
    console.log(`[dev:stop] sent SIGTERM to pid ${state.pid} (owner=${state.owner}).`);
  } catch (e) {
    console.log(`[dev:stop] could not signal pid ${state.pid}: ${e.message}`);
  }
  clearState(state.pid);
  process.exit(0);
}

main();
