import { describe, it, expect } from 'vitest';
import { TransformPipeline } from '../../src/renderer/TransformPipeline.js';

// Max zoom is no longer an absolute world scale — it is `factor × the fit scale of
// the largest floor`. TransformPipeline owns the fit math, so the engine can hand
// it the cross-floor envelope and a factor and let the pipeline resolve the bound
// against the live canvas size (so it re-derives correctly on resize).
describe('TransformPipeline fit-derived max zoom', () => {
  function pipeline(w = 1000, h = 800) {
    const t = new TransformPipeline();
    t.setCanvasSize(w, h);
    return t;
  }

  it('computeFitScale returns the limiting axis ratio', () => {
    const t = pipeline(1000, 800);
    // x-limited: 1000/5000 = 0.2 < 800/2000 = 0.4
    expect(t.computeFitScale({ width: 5000, height: 2000 })).toBeCloseTo(0.2, 6);
    // y-limited: 800/4000 = 0.2 < 1000/2000 = 0.5
    expect(t.computeFitScale({ width: 2000, height: 4000 })).toBeCloseTo(0.2, 6);
  });

  it('setMaxScaleFromFit sets max = factor × envelope fit scale', () => {
    const t = pipeline(1000, 800);
    t.setMaxScaleFromFit({ width: 5000, height: 4000 }, 8); // fit = 0.2
    expect(t.getScaleBounds().max).toBeCloseTo(1.6, 6); // 0.2 × 8
  });

  it('clamps the current scale down when the new max is below it', () => {
    const t = pipeline(1000, 800);
    t.setScaleBounds(0.1, 10);
    t.setViewState({ scale: 5 });
    t.setMaxScaleFromFit({ width: 5000, height: 4000 }, 8); // max -> 1.6
    expect(t.getViewState().scale).toBeCloseTo(1.6, 6);
  });

  it('preserves the existing min scale (only the max moves)', () => {
    const t = pipeline(1000, 800);
    t.setScaleBounds(0.05, 10);
    t.setMaxScaleFromFit({ width: 5000, height: 4000 }, 8);
    expect(t.getScaleBounds().min).toBeCloseTo(0.05, 6);
  });

  it('leaves the max untouched for a degenerate (zero-area) canvas/envelope', () => {
    const t = pipeline(0, 0);
    t.setScaleBounds(0.1, 2.5);
    t.setMaxScaleFromFit({ width: 5000, height: 4000 }, 8); // fit = 0 -> ignored
    expect(t.getScaleBounds().max).toBeCloseTo(2.5, 6);
  });
});
