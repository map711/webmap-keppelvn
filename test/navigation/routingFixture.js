// Synthetic routing fixture for the navmesh-routing pure ports.
//
// Three levels:
//   F0 (id 30, ordinal 50)  — MESHLESS (absent from navmesh_by_level): proves the
//                             graph builder drops meshless levels.
//   F1 (id 31, ordinal 100) — an L-SHAPED mesh of 4 triangles chained 0-1-2-3 with
//                             a re-entrant (concave) corner at vertex (30,10). A
//                             straight line from the start triangle to the end
//                             triangle LEAVES the mesh, so the shortest path must
//                             bend around that concave corner — this is what makes
//                             funnel ≠ straight-line and funnel < centroid-hop.
//   F2 (id 32, ordinal 200) — a rectangular mesh of 2 triangles (convex).
//
// Two BIDIRECTIONAL connector groups join F1 <-> F2:
//   group 1 "esc"  — both members kind `escalator`, cost 1.0, is_accessible:false
//   group 2 "lift" — both members kind `elevator` (lift), cost 2.0, is_accessible:true
//
// Counts/coordinates deliberately differ from SGC so a hard-coded router fails.
// All geometry was checked offline: the L-shape chain is edge-adjacent 0-1-2-3,
// the funnel path bends through the concave vertex (30,10), every shop/connector
// centroid lies inside the triangle it is meant to snap to, and the straight
// corridor produces no spurious interior vertex.

// ---- F1: L-shaped mesh (the funnel/A* workhorse) -------------------------
// Vertices (world units):
//   0:(0,0) 1:(0,10) 2:(30,0) 3:(30,10)=CONCAVE elbow 4:(40,0) 5:(40,40)
// Triangles, in funnel-traversal order so the path index array is [0,1,2,3]:
//   tri0 [0,1,3]  start arm (contains start point ~ (2,5))
//   tri1 [0,3,2]  shares edge {0,3} with tri0
//   tri2 [2,3,4]  shares edge {2,3} with tri1  (the bend)
//   tri3 [4,3,5]  shares edge {3,4} with tri2  (vertical arm; contains end ~ (38,20))
export const F1_VERTICES = [
  [0, 0],
  [0, 10],
  [30, 0],
  [30, 10],
  [40, 0],
  [40, 40]
];
export const F1_TRIANGLES = [
  [0, 1, 3],
  [0, 3, 2],
  [2, 3, 4],
  [4, 3, 5]
];
// adjacency[t][i] = triangle across edge i of triangle t, or -1 at a boundary.
// (edge0 = opposite vertex0 = (v1,v2), edge1 = (v2,v0), edge2 = (v0,v1).)
export const F1_ADJACENCY = [
  [-1, 1, -1],
  [2, -1, 0],
  [3, -1, 1],
  [-1, -1, 2]
];

// The concave (re-entrant) corner the funnel must bend through.
export const F1_CONCAVE_CORNER = { x: 30, y: 10 };

// Start point lies inside tri0; end point inside tri3.
export const F1_START = { x: 2, y: 5 };
export const F1_END = { x: 38, y: 20 };

// ---- A disconnected pair (for the triangleAStar `[]` case) ----------------
// Two triangles with NO shared edge and NO adjacency entry between them.
export const DISCONNECTED_VERTICES = [
  [0, 0],
  [10, 0],
  [5, 10],
  [100, 100],
  [110, 100],
  [105, 110]
];
export const DISCONNECTED_TRIANGLES = [
  [0, 1, 2],
  [3, 4, 5]
];
export const DISCONNECTED_ADJACENCY = [
  [-1, -1, -1],
  [-1, -1, -1]
];

// ---- A straight corridor (for the no-spurious-vertex case) ----------------
// Convex rectangle [0,0]-[20,0]-[20,10]-[0,10] split into 2 triangles. `a` in
// tri0, `b` in tri1; the straight segment a->b stays inside, so funnel = [a, b].
export const STRAIGHT_VERTICES = [
  [0, 0],
  [20, 0],
  [20, 10],
  [0, 10]
];
export const STRAIGHT_TRIANGLES = [
  [0, 1, 2],
  [0, 2, 3]
];
export const STRAIGHT_ADJACENCY = [
  [-1, 1, -1],
  [-1, -1, 0]
];
export const STRAIGHT_A = { x: 5, y: 2 }; // inside tri0
export const STRAIGHT_B = { x: 15, y: 8 }; // inside tri1

// ---- F2: rectangular mesh -------------------------------------------------
export const F2_VERTICES = [
  [0, 0],
  [60, 0],
  [60, 30],
  [0, 30]
];
export const F2_TRIANGLES = [
  [0, 1, 2],
  [0, 2, 3]
];
export const F2_ADJACENCY = [
  [-1, 1, -1],
  [-1, -1, 0]
];

// ---- Named world-space anchors used across the suite ----------------------
// (All checked to lie inside the stated triangle.)
export const ANCHORS = Object.freeze({
  shopA_F1: { x: 2, y: 5 }, // tri0 on F1 — start of the same/cross-floor routes
  shopA2_F1: { x: 38, y: 20 }, // tri3 on F1 — the other same-floor shop
  shopB_F2: { x: 50, y: 15 }, // tri0 on F2 — cross-floor destination
  escalatorF1: { x: 38, y: 30 }, // tri3 on F1
  escalatorF2: { x: 10, y: 15 }, // tri1 on F2
  liftF1: { x: 37, y: 25 }, // tri3 on F1
  liftF2: { x: 8, y: 20 } // tri1 on F2
});

// Build a navmesh record in the SGC `navmesh_by_level` shape.
function mesh(vertices, triangles, adjacency, { doors = {}, centroids = {}, envelope = [100, 100] } = {}) {
  return {
    vertices,
    triangles,
    adjacency,
    doors_by_unit: doors,
    centroids_by_unit: centroids,
    envelope_dims: envelope
  };
}

function square(cx, cy, half = 4) {
  return {
    type: 'Polygon',
    coordinates: [[
      [cx - half, cy - half],
      [cx + half, cy - half],
      [cx + half, cy + half],
      [cx - half, cy + half],
      [cx - half, cy - half]
    ]]
  };
}

// Level ids (distinct from SGC's 1..5 on purpose).
export const F0_ID = 30;
export const F1_ID = 31;
export const F2_ID = 32;

// Unit ids.
const U_SHOP_A = 301; // F1
const U_SHOP_A2 = 302; // F1
const U_SHOP_B = 303; // F2
const U_ESC_F1 = 311;
const U_ESC_F2 = 312;
const U_LIFT_F1 = 313;
const U_LIFT_F2 = 314;

/**
 * A full routing bundle (bundle-shaped object the real BundleLoader can index and
 * LocationStore / MapGeometryStore can hydrate). Pass to {@link makeRoutingBundle}
 * once per test for a clean copy.
 * @returns {Object}
 */
export function makeRoutingBundle() {
  const a = ANCHORS;
  return {
    mall: { id: 700, name: 'Routing Mall', code: 'ROUTE' },
    levels: [
      { id: F0_ID, name: 'F0', code: 'F0', position: 50, hidden: false, locked: false, opacity: 1.0 },
      { id: F1_ID, name: 'F1', code: 'F1', position: 100, hidden: false, locked: false, opacity: 1.0 },
      { id: F2_ID, name: 'F2', code: 'F2', position: 200, hidden: false, locked: false, opacity: 1.0 }
    ],
    layers: [
      { id: 1, level_id: F0_ID, parent_id: null, name: 'L', position: 0, stroke_color: '', stroke_width: null, fill_color: '' },
      { id: 2, level_id: F1_ID, parent_id: null, name: 'L', position: 0, stroke_color: '', stroke_width: null, fill_color: '' },
      { id: 3, level_id: F2_ID, parent_id: null, name: 'L', position: 0, stroke_color: '', stroke_width: null, fill_color: '' }
    ],
    kinds: [
      { id: 1, slug: 'shop', label: 'Shop', position: 0, stroke_color: '#1e40af', stroke_width: 1.5, fill_color: '#dbeafe', is_system: true, is_tenant: true, is_routable: true, is_connector: false, is_accessible: false },
      { id: 2, slug: 'escalator', label: 'Escalator', position: 1, stroke_color: '#000', stroke_width: 1.0, fill_color: '#eee', is_system: true, is_tenant: false, is_routable: true, is_connector: true, is_accessible: false },
      { id: 3, slug: 'elevator', label: 'Lift', position: 2, stroke_color: '#000', stroke_width: 1.0, fill_color: '#eee', is_system: true, is_tenant: false, is_routable: true, is_connector: true, is_accessible: true }
    ],
    units: [
      { id: U_SHOP_A, level_id: F1_ID, layer_id: 2, kind: 'shop', name: '', geometry: square(a.shopA_F1.x, a.shopA_F1.y), display_point: [a.shopA_F1.x, a.shopA_F1.y], label_point: [a.shopA_F1.x, a.shopA_F1.y], label_rotation: 0, position: 0, is_active: true, hidden: false, locked: false, opacity: 1.0, stroke_color: '', stroke_width: null, fill_color: '', doors: [], connector_group_id: null, tenancies: [{ shop_id: 1, name: 'Shop A' }] },
      { id: U_SHOP_A2, level_id: F1_ID, layer_id: 2, kind: 'shop', name: '', geometry: square(a.shopA2_F1.x, a.shopA2_F1.y), display_point: [a.shopA2_F1.x, a.shopA2_F1.y], label_point: [a.shopA2_F1.x, a.shopA2_F1.y], label_rotation: 0, position: 0, is_active: true, hidden: false, locked: false, opacity: 1.0, stroke_color: '', stroke_width: null, fill_color: '', doors: [], connector_group_id: null, tenancies: [{ shop_id: 2, name: 'Shop A2' }] },
      { id: U_SHOP_B, level_id: F2_ID, layer_id: 3, kind: 'shop', name: '', geometry: square(a.shopB_F2.x, a.shopB_F2.y), display_point: [a.shopB_F2.x, a.shopB_F2.y], label_point: [a.shopB_F2.x, a.shopB_F2.y], label_rotation: 0, position: 0, is_active: true, hidden: false, locked: false, opacity: 1.0, stroke_color: '', stroke_width: null, fill_color: '', doors: [], connector_group_id: null, tenancies: [{ shop_id: 3, name: 'Shop B' }] },
      { id: U_ESC_F1, level_id: F1_ID, layer_id: 2, kind: 'escalator', name: '', geometry: square(a.escalatorF1.x, a.escalatorF1.y), display_point: [a.escalatorF1.x, a.escalatorF1.y], label_point: [a.escalatorF1.x, a.escalatorF1.y], label_rotation: 0, position: 0, is_active: true, hidden: false, locked: false, opacity: 1.0, stroke_color: '', stroke_width: null, fill_color: '', doors: [], connector_group_id: 1, tenancies: [] },
      { id: U_ESC_F2, level_id: F2_ID, layer_id: 3, kind: 'escalator', name: '', geometry: square(a.escalatorF2.x, a.escalatorF2.y), display_point: [a.escalatorF2.x, a.escalatorF2.y], label_point: [a.escalatorF2.x, a.escalatorF2.y], label_rotation: 0, position: 0, is_active: true, hidden: false, locked: false, opacity: 1.0, stroke_color: '', stroke_width: null, fill_color: '', doors: [], connector_group_id: 1, tenancies: [] },
      { id: U_LIFT_F1, level_id: F1_ID, layer_id: 2, kind: 'elevator', name: '', geometry: square(a.liftF1.x, a.liftF1.y), display_point: [a.liftF1.x, a.liftF1.y], label_point: [a.liftF1.x, a.liftF1.y], label_rotation: 0, position: 0, is_active: true, hidden: false, locked: false, opacity: 1.0, stroke_color: '', stroke_width: null, fill_color: '', doors: [], connector_group_id: 2, tenancies: [] },
      { id: U_LIFT_F2, level_id: F2_ID, layer_id: 3, kind: 'elevator', name: '', geometry: square(a.liftF2.x, a.liftF2.y), display_point: [a.liftF2.x, a.liftF2.y], label_point: [a.liftF2.x, a.liftF2.y], label_rotation: 0, position: 0, is_active: true, hidden: false, locked: false, opacity: 1.0, stroke_color: '', stroke_width: null, fill_color: '', doors: [], connector_group_id: 2, tenancies: [] }
    ],
    shops: [
      { id: 1, mall: 700, name: 'Shop A', slug: 'shop-a', logo: null, description: 'A', category: 1, unit_number: 'A', contact_phone: '', contact_email: '', website: '', operating_hours: {}, is_active: true },
      { id: 2, mall: 700, name: 'Shop A2', slug: 'shop-a2', logo: null, description: 'A2', category: 1, unit_number: 'A2', contact_phone: '', contact_email: '', website: '', operating_hours: {}, is_active: true },
      { id: 3, mall: 700, name: 'Shop B', slug: 'shop-b', logo: null, description: 'B', category: 1, unit_number: 'B', contact_phone: '', contact_email: '', website: '', operating_hours: {}, is_active: true }
    ],
    categories: [
      { id: 1, name: 'Retail', slug: 'retail', icon: null }
    ],
    // F0 is meshless => ABSENT from navmesh_by_level (not present-with-empty).
    navmesh_by_level: {
      [F1_ID]: mesh(F1_VERTICES, F1_TRIANGLES, F1_ADJACENCY, {
        centroids: {
          [U_SHOP_A]: [a.shopA_F1.x, a.shopA_F1.y],
          [U_SHOP_A2]: [a.shopA2_F1.x, a.shopA2_F1.y],
          [U_ESC_F1]: [a.escalatorF1.x, a.escalatorF1.y],
          [U_LIFT_F1]: [a.liftF1.x, a.liftF1.y]
        },
        doors: {},
        envelope: [40, 40]
      }),
      [F2_ID]: mesh(F2_VERTICES, F2_TRIANGLES, F2_ADJACENCY, {
        centroids: {
          [U_SHOP_B]: [a.shopB_F2.x, a.shopB_F2.y],
          [U_ESC_F2]: [a.escalatorF2.x, a.escalatorF2.y],
          [U_LIFT_F2]: [a.liftF2.x, a.liftF2.y]
        },
        doors: {},
        envelope: [60, 30]
      })
    },
    transitions: [
      {
        group_id: 1,
        name: 'esc',
        direction: 'bidirectional',
        cost: 1.0,
        is_accessible: false,
        members: [
          { unit_id: U_ESC_F1, level_id: F1_ID, centroid: [a.escalatorF1.x, a.escalatorF1.y], position: 100 },
          { unit_id: U_ESC_F2, level_id: F2_ID, centroid: [a.escalatorF2.x, a.escalatorF2.y], position: 200 }
        ]
      },
      {
        group_id: 2,
        name: 'lift',
        direction: 'bidirectional',
        cost: 2.0,
        is_accessible: true,
        members: [
          { unit_id: U_LIFT_F1, level_id: F1_ID, centroid: [a.liftF1.x, a.liftF1.y], position: 100 },
          { unit_id: U_LIFT_F2, level_id: F2_ID, centroid: [a.liftF2.x, a.liftF2.y], position: 200 }
        ]
      }
    ]
  };
}

// The destination ids the LocationStore catalog produces for this bundle.
export const SHOP_A_ID = 'shop:1';
export const SHOP_A2_ID = 'shop:2';
export const SHOP_B_ID = 'shop:3';
