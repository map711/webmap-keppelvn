import { describe, it, expect } from 'vitest';
import { computeEnvelope } from '../../src/core/zoomBounds.js';

// The global max-zoom is derived from the LARGEST fitted view across all floors —
// i.e. the floor with the biggest extent (smallest fit scale). computeEnvelope
// reduces every floor's bounds to the per-axis maxima so the engine can fit that
// single worst-case box once and scale it by the factor.
describe('computeEnvelope', () => {
  it('takes the per-axis maximum across all floor bounds', () => {
    const env = computeEnvelope([
      { width: 10, height: 10 },          // tiny placeholder floor
      { width: 5000, height: 2000 },      // widest floor
      { width: 1000, height: 4000 },      // tallest floor
    ]);
    expect(env).toEqual({ width: 5000, height: 4000 });
  });

  it('ignores entries without finite positive dimensions', () => {
    const env = computeEnvelope([
      null,
      { width: 0, height: 0 },
      { width: Number.NaN, height: 10 },
      { width: 300, height: 200 },
    ]);
    expect(env).toEqual({ width: 300, height: 200 });
  });

  it('returns null when no floor has usable bounds', () => {
    expect(computeEnvelope([])).toBeNull();
    expect(computeEnvelope([null, { width: 0, height: 0 }])).toBeNull();
  });
});
