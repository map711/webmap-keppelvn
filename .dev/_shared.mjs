// Shared helpers for the keppelvn webmap dev harness. Zero dependencies. ESM (.mjs).
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

export const ROOT = process.cwd();              // npm runs scripts from the repo root
export const DEV_DIR = path.join(ROOT, '.dev');
export const PID_FILE = path.join(DEV_DIR, 'dev.json');
export const CONFIG_FILE = path.join(DEV_DIR, 'config.json');

// Sentinel so we never mistake some other process on the port for our dev server.
export const SENTINEL = 'keppelvn-dev';

let _config;
export function loadConfig() {
  // Read+parse config.json once per process — resolvePort/Host/ServeDir all call this.
  if (_config === undefined) {
    try {
      _config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch {
      _config = {};
    }
  }
  return _config;
}

export function resolvePort() {
  const cfg = loadConfig();
  // Fallback matches this project's pinned port (config.json), so the harness
  // still comes up on 5080 even if config.json is missing/unparseable.
  return Number(process.env.PORT || cfg.port || 5080);
}

export function resolveHost() {
  const cfg = loadConfig();
  return process.env.DEV_HOST || cfg.host || '127.0.0.1';
}

export function resolveServeDir() {
  const cfg = loadConfig();
  const dir = process.env.DEV_DIR || cfg.dir || '.';
  return path.resolve(ROOT, dir);
}

export function readState() {
  try {
    return JSON.parse(fs.readFileSync(PID_FILE, 'utf8'));
  } catch {
    return null;
  }
}

export function writeState(state) {
  fs.mkdirSync(DEV_DIR, { recursive: true });
  fs.writeFileSync(PID_FILE, JSON.stringify(state, null, 2));
}

// Only clears the record if it belongs to `onlyPid` (avoids one instance
// clobbering another instance's record).
export function clearState(onlyPid) {
  const s = readState();
  if (!s) return;
  if (onlyPid && s.pid !== onlyPid) return;
  try {
    fs.unlinkSync(PID_FILE);
  } catch {
    /* already gone */
  }
}

// Returns the parsed /__dev/health payload if a *keppelvn dev server* is live on
// the port, otherwise null. Never throws.
export function health(port, host = '127.0.0.1', timeoutMs = 600) {
  return new Promise((resolve) => {
    const req = http.get(
      { host, port, path: '/__dev/health', timeout: timeoutMs },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            const j = JSON.parse(body);
            resolve(j && j.sentinel === SENTINEL ? j : null);
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

// Is a PID still running? (signal 0 = existence check, doesn't actually signal)
export function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Poll `check` every gapMs up to `tries` times; resolve with its first truthy
// return, or null if it never becomes truthy. Shared by the startup/teardown waits.
export async function waitUntil(check, tries = 50, gapMs = 100) {
  for (let i = 0; i < tries; i++) {
    const v = await check();
    if (v) return v;
    await new Promise((r) => setTimeout(r, gapMs));
  }
  return null;
}
