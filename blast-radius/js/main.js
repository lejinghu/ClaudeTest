// Blast Radius — main.js
//
// Wires layout.js + render.js + state.js + input.js together, owns the
// interaction/UI state that doesn't belong in the pure game state (which
// node is selected, whether debug mode is on, pending confirmations), and
// exposes window.__BR for headless testing.

import { FLOWS, FENCE_GROUPS } from "../data/estate.js";
import { positions as computeLayout, modeForWidth } from "./layout.js";
import { mountBoard, render, workloadById } from "./render.js";
import { createViewController, attachDebugKey, attachLongPress } from "./input.js";
import { randomSeed } from "./rng.js";
import * as S from "./state.js";

const FLOWS_BY_ID = Object.fromEntries(FLOWS.map((f) => [f.id, f]));

// --- seed -----------------------------------------------------------------

const urlParams = new URLSearchParams(window.location.search);
let seed = urlParams.get("seed");
if (!seed) {
  seed = randomSeed();
  urlParams.set("seed", seed);
  const newUrl = `${window.location.pathname}?${urlParams.toString()}${window.location.hash}`;
  window.history.replaceState(null, "", newUrl);
}

// --- game + UI state --------------------------------------------------

let gameState = S.createInitialState(seed);
const ui = {
  selectedWorkloadId: null,
  pendingMoveFrom: null,
  fenceConfirm: null, // group id awaiting confirmation
  debug: false,
};
let lastMode = null;

// --- chrome reparenting -----------------------------------------------

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

// --- board + view controller -------------------------------------------

const board = mountBoard(MOVABLE.board);

function currentMode() {
  return modeForWidth(window.innerWidth);
}

function getBaseViewBox() {
  const vb = computeLayout(currentMode()).viewBox;
  const rect = MOVABLE.board.getBoundingClientRect();
  if (!rect.width || !rect.height) return { ...vb, world: vb };

  // Fit to WIDTH, not to the whole board. The tall board is 1348 units high
  // but a phone only offers ~540px of map area: fitting all of it would scale
  // everything to ~40%, dropping node touch targets to about 24px -- well
  // under the 44px minimum in spec 6.3. Showing the full width and letting
  // the player pan vertically keeps nodes finger-sized.
  const windowHeight = Math.min(vb.height, vb.width * (rect.height / rect.width));
  return { width: vb.width, height: windowHeight, world: vb };
}

function findWorkloadId(target) {
  if (target && target.getAttribute) return target.getAttribute("data-workload-id");
  return null;
}

const controller = createViewController(MOVABLE.board, {
  getBaseViewBox,
  onTap: handleTap,
  findWorkloadId,
});

MOVABLE.resetViewBtn.addEventListener("click", () => controller.resetView());

// --- rendering -----------------------------------------------------------

function viewStateFromGame() {
  const outageIds = new Set(gameState.outages.map((o) => o.workloadId));
  return {
    probedIds: gameState.probes,
    compromisedVisibleIds: gameState.detectedIds,
    outageIds,
    observedFlowIds: gameState.observedFlowIds,
    blockedFlowIds: gameState.blockedFlowIds,
    fencedGroups: gameState.fencedGroups,
    selectedId: ui.selectedWorkloadId,
    debug: ui.debug,
    debugCompromisedIds: gameState.compromisedIds,
  };
}

function renderStatusCluster() {
  document.getElementById("turn-counter").textContent = `Turn ${gameState.turn} / ${S.TOTAL_TURNS}`;
  const pips = document.querySelectorAll("#ap-indicator .ap-pip");
  pips.forEach((pip, i) => pip.classList.toggle("ap-pip-filled", i < gameState.ap));
  const score = S.computeScore(gameState);
  document.getElementById("score-total").textContent = String(score.total);
  document.getElementById("score-breakdown").textContent =
    `containment ${Math.round(score.containment)} · infra ${Math.round(score.infrastructure)} · uptime ${Math.round(score.uptime)}`;
  document.getElementById("probe-count").textContent = `${gameState.probes.size} / ${S.MAX_PROBES} probes placed`;
}

function renderOutages() {
  const list = document.getElementById("outage-list");
  list.innerHTML = "";
  if (gameState.outages.length === 0) {
    list.innerHTML = '<p class="muted panel-empty">No outages.</p>';
  } else {
    for (const outage of gameState.outages) {
      const row = document.createElement("div");
      row.className = "outage-row";
      const wl = workloadById(outage.workloadId);
      const flow = FLOWS_BY_ID[outage.flowId];
      const srcWl = flow ? workloadById(flow.from) : null;
      const detail = flow ? `blocked from ${srcWl ? srcWl.name : flow.from} (${flow.port})` : "";
      row.innerHTML = `<span>${wl ? wl.name : outage.workloadId}<br><span class="muted" style="font-size:11px">${detail}</span></span>`;
      const btn = document.createElement("button");
      btn.className = "repair-btn";
      btn.type = "button";
      btn.textContent = `Repair (${S.REPAIR_COST} AP)`;
      btn.disabled = !S.canRepairOutage(gameState, outage.flowId);
      btn.addEventListener("click", () => {
        applyState(S.repairOutage(gameState, outage.flowId));
      });
      row.appendChild(btn);
      list.appendChild(row);
    }
  }
  const badge = document.getElementById("outage-badge");
  if (gameState.outages.length > 0) {
    badge.hidden = false;
    badge.textContent = String(gameState.outages.length);
  } else {
    badge.hidden = true;
  }
}

function renderFenceButtons() {
  const container = document.getElementById("fence-buttons");
  container.innerHTML = "";
  for (const [groupId, group] of Object.entries(FENCE_GROUPS)) {
    const btn = document.createElement("button");
    const fenced = gameState.fencedGroups.has(groupId);
    btn.type = "button";
    btn.className = `fence-btn${fenced ? " fence-fenced" : ""}`;
    btn.dataset.testid = `fence-${groupId}`;
    btn.disabled = fenced || !S.canFenceGroup(gameState, groupId);
    btn.innerHTML = `<span>${groupId}${fenced ? " (fenced)" : ""}</span><span class="fence-cost">${fenced ? "" : `${S.FENCE_COST} AP`}</span>`;
    btn.addEventListener("click", () => openFenceConfirm(groupId));
    container.appendChild(btn);
  }
}

function renderLog() {
  const list = document.getElementById("event-log");
  list.innerHTML = "";
  const entries = gameState.log.slice(-8).reverse();
  for (const entry of entries) {
    const li = document.createElement("li");
    li.className = `log-${entry.kind}`;
    li.textContent = `T${entry.turn}: ${entry.text}`;
    list.appendChild(li);
  }
}

function renderIntrusionBanner() {
  MOVABLE.intrusionBanner.hidden = !gameState.intrusionKnown || gameState.detectedIds.size > 0;
}

function renderSeed() {
  MOVABLE.seedDisplay.textContent = `Seed: ${gameState.seed}`;
}

function renderDebugBadge() {
  MOVABLE.debugBadge.hidden = !ui.debug;
}

function renderEndTurnButton() {
  const btn = MOVABLE.endTurnBtn;
  btn.disabled = !S.canEndTurn(gameState);
  btn.textContent = gameState.gameOver ? "Game Over" : "End Turn";
}

function fullRender() {
  const mode = currentMode();
  applyChrome(mode);
  render(board, mode, viewStateFromGame());
  if (mode !== lastMode) {
    // After render, so the board element is laid out and its rect is real --
    // getBaseViewBox() needs the measured size to compute the width-fit window.
    controller.setBaseViewBox(getBaseViewBox());
    lastMode = mode;
  }
  renderStatusCluster();
  renderOutages();
  renderFenceButtons();
  renderLog();
  renderIntrusionBanner();
  renderSeed();
  renderDebugBadge();
  renderEndTurnButton();
  renderActionBar();
  if (gameState.gameOver) renderEndScreen();
}

function applyState(newState) {
  gameState = newState;
  fullRender();
}

// --- action bar (tap-to-select, then act) -------------------------------

function clearSelection() {
  ui.selectedWorkloadId = null;
  ui.pendingMoveFrom = null;
}

// Clears every transient interaction flag (selection, in-progress move, an
// open fence confirm) — used at turn/game boundaries so a half-finished
// interaction never survives into the next turn or a restarted game.
// `ui.debug` is a viewer preference and is left alone.
function resetUiInteraction() {
  clearSelection();
  ui.fenceConfirm = null;
}

function handleTap({ workloadId }) {
  if (ui.fenceConfirm) return; // a confirm dialog is up; ignore map taps
  if (ui.pendingMoveFrom) {
    if (workloadId && workloadId !== ui.pendingMoveFrom) {
      applyState(S.moveProbe(gameState, ui.pendingMoveFrom, workloadId));
    }
    clearSelection();
    fullRender();
    return;
  }
  if (!workloadId) {
    clearSelection();
    fullRender();
    return;
  }
  ui.selectedWorkloadId = workloadId;
  fullRender();
}

function renderActionBar() {
  const bar = MOVABLE.actionBar;

  if (ui.fenceConfirm) {
    renderFenceConfirmBar(bar, ui.fenceConfirm);
    bar.hidden = false;
    return;
  }

  if (ui.pendingMoveFrom) {
    const wl = workloadById(ui.pendingMoveFrom);
    bar.innerHTML = `
      <h3>Move probe</h3>
      <p>Tap a destination workload for the probe on ${wl ? wl.name : ui.pendingMoveFrom}.</p>
      <div class="action-bar-buttons">
        <button type="button" class="action-btn action-cancel" data-act="cancel">Cancel</button>
      </div>`;
    bar.querySelector('[data-act="cancel"]').addEventListener("click", () => {
      clearSelection();
      fullRender();
    });
    bar.hidden = false;
    return;
  }

  if (!ui.selectedWorkloadId) {
    bar.hidden = true;
    bar.innerHTML = "";
    return;
  }

  const id = ui.selectedWorkloadId;
  const wl = workloadById(id);
  const hasProbe = gameState.probes.has(id);
  const hasOutage = gameState.outages.some((o) => o.workloadId === id);

  const buttons = [];
  if (hasProbe) {
    buttons.push({ act: "move", label: `Move probe (${S.MOVE_PROBE_COST} AP)`, enabled: gameState.ap >= S.MOVE_PROBE_COST && !gameState.gameOver });
  } else {
    const enabled = S.canPlaceProbe(gameState, id);
    let label = `Place probe (${S.PROBE_COST} AP)`;
    if (!enabled) {
      if (gameState.probes.size >= S.MAX_PROBES) label = "4 / 4 probes placed";
      else if (gameState.ap < S.PROBE_COST) label = "Not enough AP";
    }
    buttons.push({ act: "probe", label, enabled });
  }
  if (hasOutage) {
    const flowIds = gameState.outages.filter((o) => o.workloadId === id).map((o) => o.flowId);
    flowIds.forEach((flowId, i) => {
      buttons.push({
        act: "repair",
        flowId,
        label: `Repair outage ${flowIds.length > 1 ? i + 1 : ""} (${S.REPAIR_COST} AP)`.trim(),
        enabled: S.canRepairOutage(gameState, flowId),
      });
    });
  }

  bar.innerHTML = `
    <h3>${wl ? wl.name : id}</h3>
    <p>${wl ? `${wl.kind} · zone: ${wl.zone}` : ""}</p>
    <div class="action-bar-buttons">
      ${buttons
        .map(
          (b, i) =>
            `<button type="button" class="action-btn" data-index="${i}" ${b.enabled ? "" : "disabled"}>${b.label}</button>`
        )
        .join("")}
      <button type="button" class="action-btn action-cancel" data-act="cancel">Cancel</button>
    </div>`;

  bar.querySelectorAll("[data-index]").forEach((btnEl) => {
    const b = buttons[Number(btnEl.dataset.index)];
    btnEl.addEventListener("click", () => {
      if (b.act === "probe") {
        applyState(S.placeProbe(gameState, id));
        clearSelection();
      } else if (b.act === "move") {
        ui.pendingMoveFrom = id;
        ui.selectedWorkloadId = null;
        fullRender();
      } else if (b.act === "repair") {
        applyState(S.repairOutage(gameState, b.flowId));
      }
    });
  });
  bar.querySelector('[data-act="cancel"]').addEventListener("click", () => {
    clearSelection();
    fullRender();
  });

  bar.hidden = false;
}

function openFenceConfirm(groupId) {
  ui.fenceConfirm = groupId;
  fullRender();
}

function renderFenceConfirmBar(bar, groupId) {
  const preview = S.previewFenceGroup(gameState, groupId);
  bar.innerHTML = `
    <h3>Ring-fence ${groupId}?</h3>
    <p>${preview.allowedCount} observed flows will be allowed, ${preview.blockedCount} unobserved flows will be blocked. This cannot be undone.</p>
    <div class="action-bar-buttons">
      <button type="button" class="action-btn action-confirm" data-act="confirm">Confirm (${S.FENCE_COST} AP)</button>
      <button type="button" class="action-btn action-cancel" data-act="cancel">Cancel</button>
    </div>`;
  bar.querySelector('[data-act="confirm"]').addEventListener("click", () => {
    applyState(S.fenceGroup(gameState, groupId));
    ui.fenceConfirm = null;
    fullRender();
  });
  bar.querySelector('[data-act="cancel"]').addEventListener("click", () => {
    ui.fenceConfirm = null;
    fullRender();
  });
}

// --- end screen ------------------------------------------------------

function renderEndScreen() {
  const el = document.getElementById("end-screen");
  const score = S.computeScore(gameState);
  const band = S.scoreBand(score.total);
  el.innerHTML = `
    <div class="end-screen-card">
      <div class="muted">Game over</div>
      <div class="end-screen-score" data-testid="end-score-total">${score.total}</div>
      <div class="end-screen-band" data-testid="end-score-band">${band}</div>
      <div class="end-screen-breakdown">
        <div><span>Containment</span><span>${Math.round(score.containment)} / 60</span></div>
        <div><span>Infrastructure</span><span>${Math.round(score.infrastructure)} / 20</span></div>
        <div><span>Uptime</span><span>${Math.round(score.uptime)} / 20</span></div>
      </div>
      <div class="end-screen-facts">
        <div>Attacker first detected: ${gameState.firstDetectionTurn ? `turn ${gameState.firstDetectionTurn}` : "never"}</div>
        <div>Workloads compromised: ${gameState.compromisedIds.size} / 24</div>
      </div>
      <button type="button" class="restart-btn" id="restart-btn">Play again</button>
    </div>`;
  el.hidden = false;
  document.getElementById("restart-btn").addEventListener("click", () => {
    resetUiInteraction();
    applyState(S.createInitialState(seed));
    el.hidden = true;
  });
}

// --- End Turn / debug / bottom sheet -----------------------------------

MOVABLE.endTurnBtn.addEventListener("click", () => {
  resetUiInteraction();
  applyState(S.endTurn(gameState));
});

attachDebugKey(() => {
  ui.debug = !ui.debug;
  fullRender();
});
attachLongPress(document.getElementById("turn-counter"), () => {
  ui.debug = !ui.debug;
  fullRender();
});

// Bottom sheet (tall mode): tap the handle to expand/collapse, tabs switch
// which panel is shown.
const bottomSheet = document.getElementById("bottom-sheet");
document.getElementById("sheet-handle").addEventListener("click", () => {
  bottomSheet.classList.toggle("expanded");
});
document.querySelectorAll(".sheet-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".sheet-tab").forEach((t) => t.classList.remove("sheet-tab-active"));
    document.querySelectorAll(".sheet-tab-panel").forEach((p) => p.classList.remove("sheet-tab-panel-active"));
    tab.classList.add("sheet-tab-active");
    document.querySelector(`[data-tab-panel="${tab.dataset.tab}"]`).classList.add("sheet-tab-panel-active");
    bottomSheet.classList.add("expanded");
  });
});
// Default active tab.
document.querySelector('.sheet-tab[data-tab="fences"]').classList.add("sheet-tab-active");
document.querySelector('[data-tab-panel="fences"]').classList.add("sheet-tab-panel-active");

// --- resize --------------------------------------------------------------

let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(fullRender, 100);
});
window.addEventListener("orientationchange", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(fullRender, 100);
});

// --- testability hook ------------------------------------------------

window.__BR = {
  get state() {
    return gameState;
  },
  get ui() {
    return ui;
  },
  seed,
  placeProbe: (id) => applyState(S.placeProbe(gameState, id)),
  moveProbe: (from, to) => applyState(S.moveProbe(gameState, from, to)),
  repairOutage: (flowId) => applyState(S.repairOutage(gameState, flowId)),
  fenceGroup: (id) => applyState(S.fenceGroup(gameState, id)),
  endTurn: () => applyState(S.endTurn(gameState)),
  setDebug: (v) => {
    ui.debug = v;
    fullRender();
  },
  render: fullRender,
  module: S,
};

fullRender();
