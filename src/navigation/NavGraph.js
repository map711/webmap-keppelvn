/**
 * NavGraph — the routing graph built from per-level navmeshes plus the bundle's
 * vertical `transitions[]` connector groups.
 *
 * `buildNavGraph(levels, transitions)` produces:
 *   - `levelGraphs`: a Map<levelCode, LevelGraph> holding ONLY routable
 *     (meshed) levels — a meshless level (no navmesh / empty triangle list and
 *     not referenced by any transition) is absent, never present-with-empty.
 *   - `transitions`: an array of {@link RouteTransition}, one per bundle
 *     connector group, carrying its kind, the two endpoints, and the spanned
 *     level codes.
 *
 * The builder is winding/shape-agnostic and never fetches: it consumes the
 * already-parsed `BundleModel.levels` (or {@link MapLevel} objects carrying a
 * `.navmesh`) and `BundleModel.transitions`.
 */

/**
 * A single floor's routing graph: its mesh plus a unit→snap index.
 */
export class LevelGraph {
  /**
   * @param {Object} params
   * @param {string} params.levelCode
   * @param {number|string} params.levelId
   * @param {Object|null} params.navmesh - `{vertices, triangles, adjacency, doors_by_unit, centroids_by_unit}`
   */
  constructor({ levelCode, levelId, navmesh }) {
    this.levelCode = levelCode;
    this.levelId = levelId;
    this.navmesh = navmesh ?? null;
  }
}

/**
 * One vertical connector group as a routing edge between two floors. Holds the
 * connector kind (derived from member unit kind), the two member endpoints
 * (level + world point), and convenience fields the result/transition consumers
 * read directly.
 */
export class RouteTransition {
  /**
   * @param {Object} params
   */
  constructor({ groupId, kind, direction, cost, isAccessible, members }) {
    this.groupId = groupId;
    this.kind = kind;
    this.direction = direction || 'bidirectional';
    this.cost = typeof cost === 'number' ? cost : 1;
    this.isAccessible = !!isAccessible;
    /** @type {Array<{unitId, levelId, levelCode, x, y}>} */
    this.members = members;
    /** @type {string[]} the (sorted-stable) two level codes this spans */
    this.levelCodes = members.map((m) => m.levelCode);
  }

  /** The member placed on the given level code, or undefined. */
  memberOnLevel(levelCode) {
    return this.members.find((m) => m.levelCode === levelCode);
  }
}

/**
 * Normalise the connector kind for a group to one of the catalog connector
 * slugs. We take the kind from the member unit kind slug (decision (b)); when
 * the kind is not directly available we fall back to the group's accessibility
 * flag (accessible => elevator, else escalator).
 *
 * @param {Object} group - raw transition group
 * @param {Map<number|string, Object>} unitsById
 * @returns {string}
 */
function resolveKind(group, unitsById) {
  for (const member of group.members || []) {
    const unit = unitsById.get(member.unit_id) ?? unitsById.get(String(member.unit_id));
    const slug = unit?.kind;
    if (typeof slug === 'string' && slug) return slug;
  }
  // Fallback: accessibility flag distinguishes the lift from the escalator.
  return group.is_accessible ? 'elevator' : 'escalator';
}

/**
 * Whether a level carries a non-empty navmesh.
 * @param {Object} level - a raw bundle level or a MapLevel (with `.navmesh`)
 * @param {Object<string,Object>} navmeshByLevel - id→mesh map (may be empty)
 * @returns {Object|null} the mesh if present and non-empty, else null
 */
function meshFor(level, navmeshByLevel) {
  let mesh = level?.navmesh ?? null;
  if (!mesh && navmeshByLevel) {
    mesh = navmeshByLevel[level.id] ?? navmeshByLevel[String(level.id)] ?? null;
  }
  if (!mesh) return null;
  const tris = mesh.triangles;
  if (!Array.isArray(tris) || tris.length === 0) return null;
  return mesh;
}

/**
 * Build the routing graph.
 *
 * @param {Array} levels - bundle levels or {@link MapLevel} objects
 * @param {Array} transitions - bundle `transitions[]`
 * @param {Object} [context] - `{ navmeshByLevel, unitsById }` (optional helpers
 *   for callers that have the parsed mesh map and unit index handy)
 * @returns {{levelGraphs: Map<string, LevelGraph>, transitions: RouteTransition[]}}
 */
export function buildNavGraph(levels, transitions, context = {}) {
  const levelList = Array.isArray(levels) ? levels : [];
  const txList = Array.isArray(transitions) ? transitions : [];
  const navmeshByLevel = context.navmeshByLevel ?? null;
  const unitsById = context.unitsById ?? new Map();

  const levelById = new Map();
  const codeById = new Map();
  for (const lvl of levelList) {
    if (lvl && lvl.id != null) {
      levelById.set(lvl.id, lvl);
      codeById.set(lvl.id, lvl.code);
    }
  }

  // Level ids referenced by any transition member — these are routable even if
  // the raw level record handed in does not carry the mesh inline.
  const levelIdsInTransitions = new Set();
  for (const group of txList) {
    for (const member of group.members || []) {
      if (member?.level_id != null) levelIdsInTransitions.add(member.level_id);
    }
  }

  // --- Level graphs: meshed levels only (meshless dropped) ---
  const levelGraphs = new Map();
  for (const lvl of levelList) {
    if (!lvl || lvl.code == null) continue;
    const mesh = meshFor(lvl, navmeshByLevel);
    const inTransition = levelIdsInTransitions.has(lvl.id);
    if (!mesh && !inTransition) continue; // meshless & unconnected => dropped
    levelGraphs.set(
      lvl.code,
      new LevelGraph({ levelCode: lvl.code, levelId: lvl.id, navmesh: mesh })
    );
  }

  // --- Route transitions: one RouteTransition per bundle connector group ---
  const routeTransitions = [];
  for (const group of txList) {
    const members = (group.members || []).map((m) => {
      const c = m.centroid || [0, 0];
      return {
        unitId: m.unit_id,
        levelId: m.level_id,
        levelCode: codeById.get(m.level_id) ?? String(m.level_id),
        x: Array.isArray(c) ? c[0] : c?.x ?? 0,
        y: Array.isArray(c) ? c[1] : c?.y ?? 0
      };
    });
    if (members.length < 2) continue;

    routeTransitions.push(
      new RouteTransition({
        groupId: group.group_id,
        kind: resolveKind(group, unitsById),
        direction: group.direction ?? 'bidirectional',
        cost: group.cost,
        isAccessible: group.is_accessible,
        members
      })
    );
  }

  return { levelGraphs, transitions: routeTransitions };
}
