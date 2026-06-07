// >>> TARS cap:split-data-loading
//
// split-data-loading (config half) — the Config schema replaces the single
// `dataUrl`(required)/`mapUrl` keys with `mapsUrl`(required) + `datasUrl`(required).
// A consumer must now supply BOTH split URLs; omitting either is a hard
// validation error; the legacy `dataUrl`/`mapUrl` keys are gone from the schema
// (a config of only `{dataUrl}` therefore fails for the missing `mapsUrl`, not
// because `dataUrl` is accepted).
//
// Pure Node/Vitest: Config is a plain class, no DOM. Imported LAZILY so the suite
// COLLECTS cleanly and a missing/renamed export surfaces as a message-bearing
// assertion failure rather than a file-level resolution crash.
//
// Target: criterion 5.

import { describe, it, expect } from 'vitest';

async function importConfig() {
  let mod = null;
  try {
    mod = await import('../../src/core/Config.js');
  } catch {
    mod = null;
  }
  expect(mod, 'src/core/Config.js must exist and export the Config class').not.toBeNull();
  expect(mod.Config, 'Config.js must export a Config class').toBeTypeOf('function');
  return mod.Config;
}

describe('split-data-loading: Config split-URL schema', () => {
  it('validates a config carrying both mapsUrl and datasUrl', async () => {
    const Config = await importConfig();
    const cfg = new Config({ mapsUrl: '/datas/maps_SGC_v001.json.gz', datasUrl: '/datas/datas_SGC_v001.json.gz' });
    expect(cfg.get('mapsUrl')).toBe('/datas/maps_SGC_v001.json.gz');
    expect(cfg.get('datasUrl')).toBe('/datas/datas_SGC_v001.json.gz');
  });

  it('throws `Config: "mapsUrl" is required` when mapsUrl is omitted', async () => {
    const Config = await importConfig();
    expect(() => new Config({ datasUrl: '/datas/datas_SGC_v001.json.gz' }))
      .toThrow('Config: "mapsUrl" is required');
  });

  it('throws `Config: "datasUrl" is required` when datasUrl is omitted', async () => {
    const Config = await importConfig();
    expect(() => new Config({ mapsUrl: '/datas/maps_SGC_v001.json.gz' }))
      .toThrow('Config: "datasUrl" is required');
  });

  it('drops `dataUrl`/`mapUrl` from the schema: a config of only {dataUrl} fails for missing mapsUrl', async () => {
    const Config = await importConfig();
    // The legacy single key no longer satisfies the required-URL contract: the
    // failure is about the NEW required key (mapsUrl), proving dataUrl is not a
    // schema key that could stand in for it.
    expect(() => new Config({ dataUrl: '/datas/SGC_v001.json' }))
      .toThrow('Config: "mapsUrl" is required');
  });

  it('does not expose dataUrl/mapUrl as schema keys (no default leaks into getAll)', async () => {
    const Config = await importConfig();
    const cfg = new Config({ mapsUrl: '/m.gz', datasUrl: '/d.gz' });
    const all = cfg.getAll();
    expect(Object.prototype.hasOwnProperty.call(all, 'dataUrl')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(all, 'mapUrl')).toBe(false);
  });
});
// <<< TARS cap:split-data-loading
