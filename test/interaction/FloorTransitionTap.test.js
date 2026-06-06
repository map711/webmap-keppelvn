// floor-transition tap — tapping a connector bubble must classify as a
// 'floor-transition' hit and fire the registered handler with the target floor.
//
// Regression: NavMarkerLayer.hitTest used to return a BARE floor-code string
// (e.g. 'F2'), which HitTestManager.#classifyHit mistook for a unit id and
// routed to 'tap:floor' — so the 'floor-transition' handler registered by
// MapEngine never fired and tapping the bubble did nothing. The hit result must
// be self-describing so the manager can tell a connector bubble from a unit.
import { describe, it, expect } from 'vitest';
import { HitTestManager } from '../../src/interaction/HitTestManager.js';
import { EventBus } from '../../src/core/EventBus.js';

// A LayerStack stub whose top layer is the NavMarkerLayer: it returns the
// connector-bubble hit shape for the tapped point, null elsewhere.
function makeLayerStack(hitResult) {
  return { hitTest: () => hitResult };
}

describe('floor-transition tap wiring', () => {
  it('a connector-bubble hit fires the floor-transition handler with the target floor', () => {
    const bus = new EventBus();
    const hit = { type: 'floor-transition', targetFloor: 'F2' };
    const manager = new HitTestManager(makeLayerStack(hit), bus, null);

    let switchedTo = null;
    manager.registerHandler('floor-transition', (result) => {
      switchedTo = result.targetFloor;
    });

    bus.emit('gesture:tap', { worldX: 200, worldY: 201, screenX: 10, screenY: 10 });

    expect(switchedTo).toBe('F2');
  });

  it('a connector-bubble hit emits tap:floor-transition, NOT tap:floor', () => {
    const bus = new EventBus();
    const hit = { type: 'floor-transition', targetFloor: 'F1' };
    const manager = new HitTestManager(makeLayerStack(hit), bus, null);

    const events = [];
    bus.on('tap:floor', () => events.push('floor'));
    bus.on('tap:floor-transition', () => events.push('floor-transition'));

    bus.emit('gesture:tap', { worldX: 300, worldY: 301, screenX: 10, screenY: 10 });

    expect(events).toEqual(['floor-transition']);
  });
});
