// Blast Radius — render.js
//
// Draws state to SVG. Read-only with respect to game state: this module
// never mutates state, it only reads it and produces/updates DOM nodes.
// All game-rule decisions (what's observed, blocked, compromised, etc.)
// live in state.js — this file just paints whatever it's handed.

import { WORKLOADS, FLOWS, FENCE_GROUPS } from "../data/estate.js";
import { positions as computeLayout, NODE_STYLE, EDGE_STYLE } from "./layout.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const WORKLOADS_BY_ID = Object.fromEntries(WORKLOADS.map((w) => [w.id, w]));

function el(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

/**
 * Builds (once) the persistent SVG layer structure and returns handles used
 * by subsequent render() calls. Layers, bottom to top:
 *   bands -> edges -> nodes (visible) -> badges -> labels -> hit circles
 * Hit circles are last/topmost so they always receive pointer events even
 * though they're visually transparent (spec 6.3).
 */
export function mountBoard(svg) {
  svg.innerHTML = "";
  const layers = {
    bands: el("g", { class: "layer-bands" }),
    edges: el("g", { class: "layer-edges" }),
    nodes: el("g", { class: "layer-nodes" }),
    badges: el("g", { class: "layer-badges" }),
    labels: el("g", { class: "layer-labels" }),
    hit: el("g", { class: "layer-hit" }),
  };
  Object.values(layers).forEach((g) => svg.appendChild(g));
  return { svg, layers, mode: null, layout: null, nodeEls: {}, edgeEls: {} };
}

function fenceGroupBounds(layout, memberIds, padding) {
  const pts = memberIds.map((id) => layout.positions[id]).filter(Boolean);
  if (pts.length === 0) return null;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return {
    x: Math.min(...xs) - padding,
    y: Math.min(...ys) - padding,
    width: Math.max(...xs) - Math.min(...xs) + padding * 2,
    height: Math.max(...ys) - Math.min(...ys) + padding * 2,
  };
}

/**
 * Full (re)draw. `board` is the handle returned by mountBoard.
 * `mode` is "wide" | "tall". `viewState` carries everything render needs to
 * know about game state without owning it:
 *   {
 *     probedIds: Set<string>,
 *     compromisedVisibleIds: Set<string>,
 *     outageIds: Set<string>,
 *     observedFlowIds: Set<string>,
 *     blockedFlowIds: Set<string>,
 *     fencedGroups: Set<string>,
 *     selectedId: string|null,
 *     debug: boolean,
 *     debugCompromisedIds: Set<string>,   // only used when debug is true
 *   }
 */
export function render(board, mode, viewState) {
  const layout = computeLayout(mode);
  board.mode = mode;
  board.layout = layout;
  board.svg.setAttribute("viewBox", `0 0 ${layout.viewBox.width} ${layout.viewBox.height}`);
  board.svg.dataset.mode = mode;

  const style = NODE_STYLE[mode];
  const edgeStyle = EDGE_STYLE[mode];

  renderBands(board, layout, viewState);
  renderEdges(board, layout, viewState, edgeStyle);
  renderNodes(board, layout, viewState, style);
}

function renderBands(board, layout, viewState) {
  const g = board.layers.bands;
  g.innerHTML = "";

  for (const band of layout.bands) {
    g.appendChild(
      el("rect", {
        class: "zone-band",
        x: band.x,
        y: band.y,
        width: band.width,
        height: band.height,
        rx: 8,
      })
    );
    const text = el("text", {
      class: "zone-band-label",
      x: band.labelX,
      y: band.labelY,
      "text-anchor": "middle",
    });
    text.textContent = band.label;
    g.appendChild(text);
  }

  // Dashed overlay for each currently-fenced group (spec 6.3: "Inside fenced
  // group ... group band gets a dashed border").
  for (const [groupId, group] of Object.entries(FENCE_GROUPS)) {
    if (!viewState.fencedGroups.has(groupId)) continue;
    const bounds = fenceGroupBounds(layout, group.members, 26);
    if (!bounds) continue;
    g.appendChild(
      el("rect", {
        class: "fence-band",
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        rx: 12,
      })
    );
  }
}

function edgeKey(flow) {
  return flow.id;
}

function renderEdges(board, layout, viewState, edgeStyle) {
  const g = board.layers.edges;
  g.innerHTML = "";
  board.edgeEls = {};

  for (const flow of FLOWS) {
    const isObserved = viewState.observedFlowIds.has(flow.id);
    const isDebugVisible = viewState.debug;
    if (!isObserved && !isDebugVisible) continue; // spec: unobserved edges are not drawn

    const from = layout.positions[flow.from];
    const to = layout.positions[flow.to];
    if (!from || !to) continue;

    const isBlocked = viewState.blockedFlowIds.has(flow.id);
    const line = el("line", {
      class: `flow-edge ${isBlocked ? "flow-blocked" : "flow-allowed"}${
        !isObserved ? " flow-debug-only" : ""
      }`,
      x1: from.x,
      y1: from.y,
      x2: to.x,
      y2: to.y,
      "stroke-width": isBlocked ? edgeStyle.blocked : edgeStyle.allowed,
    });
    if (isBlocked) line.setAttribute("stroke-dasharray", "4 3");
    g.appendChild(line);
    board.edgeEls[edgeKey(flow)] = line;
  }
}

function renderNodes(board, layout, viewState, style) {
  board.layers.nodes.innerHTML = "";
  board.layers.badges.innerHTML = "";
  board.layers.labels.innerHTML = "";
  board.layers.hit.innerHTML = "";
  board.nodeEls = {};

  for (const workload of WORKLOADS) {
    const pos = layout.positions[workload.id];
    if (!pos) continue;

    const isProbed = viewState.probedIds.has(workload.id);
    const isCompromised =
      viewState.compromisedVisibleIds.has(workload.id) ||
      (viewState.debug && viewState.debugCompromisedIds.has(workload.id));
    const isOutage = viewState.outageIds.has(workload.id);
    const isSelected = viewState.selectedId === workload.id;

    let stateClass = "node-normal";
    if (isCompromised) stateClass = "node-compromised";
    else if (isOutage) stateClass = "node-outage";
    else if (isProbed) stateClass = "node-probed";

    const circle = el("circle", {
      class: `node-circle ${stateClass}${isSelected ? " node-selected" : ""}${
        viewState.debug && viewState.debugCompromisedIds.has(workload.id) && !isCompromised
          ? " node-debug-compromised"
          : ""
      }`,
      cx: pos.x,
      cy: pos.y,
      r: style.radius,
    });
    board.layers.nodes.appendChild(circle);

    if (isProbed) {
      const badge = el("circle", {
        class: "node-probe-badge",
        cx: pos.x + style.radius * 0.7,
        cy: pos.y - style.radius * 0.7,
        r: Math.max(4, style.radius * 0.22),
      });
      board.layers.badges.appendChild(badge);
    }

    const label = el("text", {
      class: "node-label",
      x: pos.x,
      y: pos.y + style.radius + style.label + 2,
      "text-anchor": "middle",
      "font-size": style.label,
    });
    label.textContent = workload.name;
    board.layers.labels.appendChild(label);

    const hit = el("circle", {
      class: "node-hit",
      cx: pos.x,
      cy: pos.y,
      r: style.hit,
      "data-testid": `node-${workload.id}`,
      "data-workload-id": workload.id,
    });
    board.layers.hit.appendChild(hit);

    board.nodeEls[workload.id] = { circle, hit, label };
  }
}

export function workloadById(id) {
  return WORKLOADS_BY_ID[id];
}
