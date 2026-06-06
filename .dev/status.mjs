// dev:status — show what the harness thinks is running and who owns it.
import { readState, isAlive, resolvePort, resolveHost, health } from './_shared.mjs';

async function main() {
  const PORT = resolvePort();
  const HOST = resolveHost();
  const state = readState();
  const h = await health(PORT, HOST);
  console.log(
    JSON.stringify(
      {
        port: PORT,
        host: HOST,
        healthy: !!h,
        live: h || null,
        stateFile: state || null,
        statePidAlive: state ? isAlive(state.pid) : false,
      },
      null,
      2
    )
  );
}

main();
