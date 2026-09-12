// Blast Radius — main.js
//
// Phase 1: wires layout.js + render.js to the page and reparents the shared
// chrome blocks between the wide and tall shells on resize. No game state
// yet — every flow is drawn so the topology can be verified (spec Phase 1
// acceptance). Real state arrives in Phase 2.

import { FLOWS } from "../data/estate.js";
import { modeForWidth } from "./layout.js";
import { mountBoard, render } from "./render.js";

const ALL_FLOW_IDS = new Set(FLOWS.map((f) => f.id));

// --- chrome reparenting ------------------------------------------------

const MOVABLE = {
  statusCluster: document.getElementById("status-cluster"),
  probeCount: document.getElementById("probe-count"),
  outageSection: document.getElementById("outage-section"),
  fenceSection: document.getElementById("fence-section"),
  logSection: document.getElementById("log-section"),
  endTurnBtn: document.getElementById("end-turn-btn"),
  board: document.getElementById("board"),
  intrusionBanner: document.getElementById("intrusion-banner"),
  resetViewBtn: document.getElementById("reset-view-btn"),
  seedDisplay: document.getElementById("seed-display"),
  debugBadge: document.getElementById("debug-badge"),
  actionBar: document.getElementById("action-bar"),
};

const WIDE_SLOTS = {
  statusCluster: document.getElementById("wide-status-slot"),
  probeCount: document.getElementById("wide-probe-slot"),
  outageSection: document.getElementById("wide-outage-slot"),
  fenceSection: document.getElementById("wide-fence-slot"),
  logSection: document.getElementById("wide-log-slot"),
  endTurnBtn: document.getElementById("wide-endturn-slot"),
  board: document.getElementById("map-wrap"),
  intrusionBanner: document.getElementById("map-wrap"),
  resetViewBtn: document.getElementById("map-wrap"),
  seedDisplay: document.getElementById("map-wrap"),
  debugBadge: document.getElementById("map-wrap"),
  actionBar: document.getElementById("map-wrap"),
};

const TALL_SLOTS = {
  statusCluster: document.getElementById("tall-status-slot"),
  probeCount: document.querySelector('[data-tab-panel="outages"]'),
  outageSection: document.querySelector('[data-tab-panel="outages"]'),
  fenceSection: document.querySelector('[data-tab-panel="fences"]'),
  logSection: document.querySelector('[data-tab-panel="log"]'),
  endTurnBtn: document.getElementById("tall-endturn-slot"),
  board: document.getElementById("map-wrap-tall"),
  intrusionBanner: document.getElementById("map-wrap-tall"),
  resetViewBtn: document.getElementById("map-wrap-tall"),
  seedDisplay: document.getElementById("map-wrap-tall"),
  debugBadge: document.getElementById("status-bar"),
  actionBar: document.getElementById("map-wrap-tall"),
};

function applyChrome(mode) {
  const slots = mode === "wide" ? WIDE_SLOTS : TALL_SLOTS;
  // probeCount renders before outageList within the outages tab panel.
  if (mode === "tall") {
    slots.outageSection.appendChild(MOVABLE.probeCount);
    slots.outageSection.appendChild(MOVABLE.outageSection);
  } else {
    slots.probeCount.appendChild(MOVABLE.probeCount);
    slots.outageSection.appendChild(MOVABLE.outageSection);
  }
  for (const key of Object.keys(MOVABLE)) {
    if (key === "probeCount" || key === "outageSection") continue;
    const slot = slots[key];
    const node = MOVABLE[key];
    if (slot && node && node.parentElement !== slot) slot.appendChild(node);
  }
  document.getElementById("app").classList.toggle("mode-wide", mode === "wide");
  document.getElementById("app").classList.toggle("mode-tall", mode === "tall");
}

// --- board setup ---------------------------------------------------------

const board = mountBoard(MOVABLE.board);

function currentMode() {
  return modeForWidth(window.innerWidth);
}

function fullRender() {
  const mode = currentMode();
  applyChrome(mode);
  render(board, mode, {
    probedIds: new Set(),
    compromisedVisibleIds: new Set(),
    outageIds: new Set(),
    observedFlowIds: ALL_FLOW_IDS, // Phase 1: show all flows to verify topology
    blockedFlowIds: new Set(),
    fencedGroups: new Set(),
    selectedId: null,
    debug: false,
    debugCompromisedIds: new Set(),
  });
}

fullRender();

let resizeTimer = null;
function onResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(fullRender, 100);
}
window.addEventListener("resize", onResize);
window.addEventListener("orientationchange", onResize);
