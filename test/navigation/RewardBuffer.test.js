// deriveRewardBuffer — a PURE helper that picks a sensible near-path buffer
// (world units) from the placed shops' OWN sizes, so the reward proximity gate
// (rewardRouteMatch's `buffer`) auto-scales to the bundle's coordinate space
// instead of a guessed constant.
//
// buffer = factor × median over PLACED-shop display nodes of the unit's mean
// extent ((unitWidth + unitHeight) / 2), counting only nodes with positive
// extent (so meshless / geometry-less units don't drag the median to 0).
//
// Resolution order (asserted below):
//   1. an absolute `override` (finite, >= 0) wins verbatim (the host's fixed cap);
//   2. else factor × median(placed-shop extent) when any shop has geometry;
//   3. else a fraction of the cross-floor `envelope` diagonal (degenerate data);
//   4. else Infinity (no basis at all — the matcher's permissive default).
//
// Pure Node/Vitest: the helper only reads `locationStore.locations[].id` and each
// `displayNode`'s `unitWidth`/`unitHeight`, so a hand-built fake catalog is the
// witness (precise control over the median math) — no bundle, no port.

import { describe, it, expect } from 'vitest';
import { deriveRewardBuffer } from '../../src/navigation/RewardRouteMatch.js';

// A fake hydrated-LocationStore: just the fields the helper reads.
function fakeCatalog(locations) {
  return { locations };
}

// One placed-shop Location with display nodes of the given [width, height] extents.
function shop(id, extents) {
  return {
    id: `shop:${id}`,
    displayNodes: extents.map(([unitWidth, unitHeight]) => ({ unitWidth, unitHeight }))
  };
}

// A routable-facility Location (unit:<id>) — must be IGNORED by the derivation.
function facility(id, extents) {
  return {
    id: `unit:${id}`,
    displayNodes: extents.map(([unitWidth, unitHeight]) => ({ unitWidth, unitHeight }))
  };
}

describe('deriveRewardBuffer: shop-size-derived near-path buffer', () => {
  it('is factor × the median placed-shop mean-extent (default factor 1)', () => {
    // mean extents: shop1 (10,6)->8, shop2 (20,20)->20, shop3 (4,8)->6.
    // sorted [6, 8, 20] -> median 8. factor default 1 -> buffer 8.
    const cat = fakeCatalog([
      shop(1, [[10, 6]]),
      shop(2, [[20, 20]]),
      shop(3, [[4, 8]])
    ]);
    expect(deriveRewardBuffer(cat)).toBe(8);
  });

  it('scales linearly with the factor', () => {
    const cat = fakeCatalog([shop(1, [[10, 6]]), shop(2, [[20, 20]]), shop(3, [[4, 8]])]);
    expect(deriveRewardBuffer(cat, { factor: 0.5 })).toBe(4);
    expect(deriveRewardBuffer(cat, { factor: 1.5 })).toBe(12);
  });

  it('uses the mean of the two middle samples for an even count', () => {
    // mean extents 6 and 8 -> median (6+8)/2 = 7.
    const cat = fakeCatalog([shop(1, [[4, 8]]), shop(2, [[10, 6]])]);
    expect(deriveRewardBuffer(cat)).toBe(7);
  });

  it('counts only PLACED shops — facility (unit:<id>) extents are ignored', () => {
    // The huge facility would dominate a naive median; it must be excluded so the
    // buffer tracks the actual shops.
    const cat = fakeCatalog([
      shop(1, [[8, 8]]),                // e = 8
      facility(9, [[1000, 1000]])       // ignored
    ]);
    expect(deriveRewardBuffer(cat)).toBe(8);
  });

  it('ignores zero / non-finite extent nodes (meshless / geometry-less units)', () => {
    // shop2 sits on a meshless floor (no geometry -> 0×0 extent) and must not drag
    // the median toward zero; only shop1's real extent counts.
    const cat = fakeCatalog([
      shop(1, [[12, 8]]),               // e = 10
      shop(2, [[0, 0]])                 // dropped
    ]);
    expect(deriveRewardBuffer(cat)).toBe(10);
  });

  it('dedupe is not its job — every near placement of a multi-unit shop is a sample', () => {
    // A shop spanning two units contributes both extents; the median is over nodes.
    const cat = fakeCatalog([
      shop(1, [[10, 10], [6, 6]]),      // e = 10 and 6
      shop(2, [[8, 8]])                 // e = 8
    ]);
    // samples [10, 6, 8] -> sorted [6, 8, 10] -> median 8.
    expect(deriveRewardBuffer(cat)).toBe(8);
  });

  describe('absolute override wins (the host fixed cap, like an absolute maxZoom)', () => {
    it('returns the override verbatim regardless of shop sizes', () => {
      const cat = fakeCatalog([shop(1, [[10, 10]])]);
      expect(deriveRewardBuffer(cat, { override: 42 })).toBe(42);
      expect(deriveRewardBuffer(cat, { override: 42, factor: 100 })).toBe(42);
    });

    it('honours an explicit override of 0 (show nothing off the line)', () => {
      const cat = fakeCatalog([shop(1, [[10, 10]])]);
      expect(deriveRewardBuffer(cat, { override: 0 })).toBe(0);
    });

    it('a null / undefined override falls through to the derived value', () => {
      const cat = fakeCatalog([shop(1, [[10, 10]])]);
      expect(deriveRewardBuffer(cat, { override: null })).toBe(10);
      expect(deriveRewardBuffer(cat, { override: undefined })).toBe(10);
    });
  });

  describe('degenerate-data fallback', () => {
    it('falls back to a fraction of the cross-floor envelope diagonal when no shop has geometry', () => {
      const cat = fakeCatalog([shop(1, [[0, 0]]), facility(9, [[5, 5]])]);
      // diagonal of 30×40 = 50; default fraction 0.04 -> 2.
      expect(deriveRewardBuffer(cat, { envelope: { width: 30, height: 40 } })).toBeCloseTo(2, 9);
    });

    it('honours a custom envelopeFraction', () => {
      const cat = fakeCatalog([]);
      expect(
        deriveRewardBuffer(cat, { envelope: { width: 30, height: 40 }, envelopeFraction: 0.1 })
      ).toBeCloseTo(5, 9);
    });

    it('returns Infinity when there is no basis at all (no shops, no envelope)', () => {
      expect(deriveRewardBuffer(fakeCatalog([]))).toBe(Infinity);
      expect(deriveRewardBuffer(null)).toBe(Infinity);
      expect(deriveRewardBuffer(undefined)).toBe(Infinity);
    });
  });
});
