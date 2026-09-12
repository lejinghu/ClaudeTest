// Blast Radius — state.js
//
// Pure game logic. ZERO DOM references. Every export is either a pure
// function (state [+ args] -> new state, never mutating its input) or a
// pure read-only selector (state -> derived value). This is what spec
// Section 2 requires and what makes Phase 6 tuning and headless testing
// possible: the exact same state + the exact same action always produces
// the exact same result.

import { WORKLOADS, FLOWS, FENCE_GROUPS, isFlowActiveOnTurn, computeDegrees } from "../data/estate.js";
import { seedToRngState, pick, weightedPick } from "./rng.js";

export const TOTAL_TURNS = 15;
export const STARTING_AP = 3;
export const MAX_PROBES = 4;
export const PROBE_COST = 1;
export const MOVE_PROBE_COST = 1;
export const FENCE_COST = 2;
export const REPAIR_COST = 1;
export const PATIENT_ZERO_TURN = 3;
export const ATTACKER_START_TURN = 4;
export const OUTAGE_POINTS_PER_TURN = 1 / 3;

const WORKLOADS_BY_ID = Object.fromEntries(WORKLOADS.map((w) => [w.id, w]));
const DEGREES = computeDegrees();
const PATIENT_ZERO_CANDIDATES = [
  ...WORKLOADS.filter((w) => w.zone === "dev").map((w) => w.id),
  "jump-01",
];

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export function createInitialState(seed) {
  return {
    seed,
    rngState: seedToRngState(seed),
    turn: 1,
    ap: STARTING_AP,
    gameOver: false,

    probes: new Set(),

    // A flow id lands here the moment its traffic could have been seen (a
    // probe on an active endpoint) OR the moment ring-fencing blocks it
    // (fencing tells the player it existed even though no probe ever saw
    // its traffic). It never leaves once added.
    observedFlowIds: new Set(),

    fencedGroups: new Set(),
    allowedFlowIds: new Set(),
    blockedFlowIds: new Set(),

    // Ground truth, not necessarily known to the player — see detectedIds.
    compromisedIds: new Set(),
    // Subset of compromisedIds the player has actually seen (probed at some
    // point while compromised). Permanent once set.
    detectedIds: new Set(),
    intrusionKnown: false,
    firstDetectionTurn: null,

    // One entry per currently-unrepaired outage (spec: "restore one broken
    // dependency" — a workload with two broken essential flows needs two
    // repairs).
    outages: [],
    cumulativeOutageTurns: 0,

    log: [],
  };
}

// ---------------------------------------------------------------------------
// Validation predicates — used by input.js to enable/disable controls.
// ---------------------------------------------------------------------------

export function canPlaceProbe(state, workloadId) {
  return (
    !state.gameOver &&
    state.ap >= PROBE_COST &&
    state.probes.size < MAX_PROBES &&
    !state.probes.has(workloadId)
  );
}

export function canMoveProbe(state, fromId, toId) {
  return (
    !state.gameOver &&
    state.ap >= MOVE_PROBE_COST &&
    state.probes.has(fromId) &&
    !state.probes.has(toId) &&
    fromId !== toId
  );
}

export function canFenceGroup(state, groupId) {
  return (
    !state.gameOver &&
    state.ap >= FENCE_COST &&
    !!FENCE_GROUPS[groupId] &&
    !state.fencedGroups.has(groupId)
  );
}

export function canRepairOutage(state, flowId) {
  return !state.gameOver && state.ap >= REPAIR_COST && state.outages.some((o) => o.flowId === flowId);
}

export function canEndTurn(state) {
  return !state.gameOver;
}

// ---------------------------------------------------------------------------
// Actions — each either returns a new state or, if the action is not
// currently legal, returns the SAME state reference unchanged (a no-op you
// can detect with `result === state`).
// ---------------------------------------------------------------------------

export function placeProbe(state, workloadId) {
  if (!canPlaceProbe(state, workloadId)) return state;
  const probes = new Set(state.probes);
  probes.add(workloadId);
  const name = workloadNameOf(workloadId);
  return {
    ...state,
    ap: state.ap - PROBE_COST,
    probes,
    log: appendLog(state, "probe", `Probe placed: ${name}`),
  };
}

export function moveProbe(state, fromId, toId) {
  if (!canMoveProbe(state, fromId, toId)) return state;
  const probes = new Set(state.probes);
  probes.delete(fromId);
  probes.add(toId);
  return {
    ...state,
    ap: state.ap - MOVE_PROBE_COST,
    probes,
    log: appendLog(state, "probe", `Probe moved: ${workloadNameOf(fromId)} -> ${workloadNameOf(toId)}`),
  };
}

export function repairOutage(state, flowId) {
  if (!canRepairOutage(state, flowId)) return state;
  const outage = state.outages.find((o) => o.flowId === flowId);
  const outages = state.outages.filter((o) => o.flowId !== flowId);
  return {
    ...state,
    ap: state.ap - REPAIR_COST,
    outages,
    log: appendLog(state, "outage", `Outage repaired: ${workloadNameOf(outage.workloadId)}`),
  };
}

/**
 * Read-only preview of what fencing `groupId` would do right now — used by
 * the confirm dialog (spec 6.4) so the player sees the consequence before
 * committing. Never mutates state.
 */
export function previewFenceGroup(state, groupId) {
  const group = FENCE_GROUPS[groupId];
  if (!group) return { allowedCount: 0, blockedCount: 0, essentialBlockedCount: 0 };
  const memberSet = new Set(group.members);
  let allowedCount = 0;
  let blockedCount = 0;
  let essentialBlockedCount = 0;
  for (const flow of FLOWS) {
    if (!(memberSet.has(flow.from) || memberSet.has(flow.to))) continue;
    if (state.allowedFlowIds.has(flow.id) || state.blockedFlowIds.has(flow.id)) continue;
    if (state.observedFlowIds.has(flow.id)) {
      allowedCount++;
    } else {
      blockedCount++;
      if (flow.essential) essentialBlockedCount++;
    }
  }
  return { allowedCount, blockedCount, essentialBlockedCount };
}

export function fenceGroup(state, groupId) {
  if (!canFenceGroup(state, groupId)) return state;
  const group = FENCE_GROUPS[groupId];
  const memberSet = new Set(group.members);

  const observedFlowIds = new Set(state.observedFlowIds);
  const allowedFlowIds = new Set(state.allowedFlowIds);
  const blockedFlowIds = new Set(state.blockedFlowIds);
  const outages = [...state.outages];
  let allowedCount = 0;
  let blockedCount = 0;

  for (const flow of FLOWS) {
    if (!(memberSet.has(flow.from) || memberSet.has(flow.to))) continue;
    // A flow already resolved by an earlier fence (its other endpoint was
    // in a group fenced previously) keeps that resolution — it is not
    // re-evaluated.
    if (allowedFlowIds.has(flow.id) || blockedFlowIds.has(flow.id)) continue;

    if (observedFlowIds.has(flow.id)) {
      allowedFlowIds.add(flow.id);
      allowedCount++;
    } else {
      blockedFlowIds.add(flow.id);
      observedFlowIds.add(flow.id); // blocking it is how the player learns it existed
      blockedCount++;
      if (flow.essential) {
        outages.push({ flowId: flow.id, workloadId: flow.to });
      }
    }
  }

  const fencedGroups = new Set(state.fencedGroups);
  fencedGroups.add(groupId);

  return {
    ...state,
    ap: state.ap - FENCE_COST,
    fencedGroups,
    observedFlowIds,
    allowedFlowIds,
    blockedFlowIds,
    outages,
    log: appendLog(state, "fence", `${groupId} ring-fenced: ${allowedCount} flows allowed, ${blockedCount} blocked`),
  };
}

/**
 * Resolves the current turn end-to-end (spec 3.1 step 3, a through f) and
 * advances to the next turn. Unspent AP is discarded, per spec.
 */
export function endTurn(state) {
  if (state.gameOver) return state;

  const turn = state.turn;
  let rngState = state.rngState;
  let log = state.log;
  const observedFlowIds = new Set(state.observedFlowIds);
  const compromisedIds = new Set(state.compromisedIds);
  const detectedIds = new Set(state.detectedIds);
  let intrusionKnown = state.intrusionKnown;
  let firstDetectionTurn = state.firstDetectionTurn;

  // --- a. flow activity + b. observation ---------------------------------
  for (const flow of FLOWS) {
    if (observedFlowIds.has(flow.id)) continue;
    if (state.blockedFlowIds.has(flow.id)) continue; // blocked traffic carries nothing to observe
    if (!isFlowActiveOnTurn(flow, turn)) continue;
    if (state.probes.has(flow.from) || state.probes.has(flow.to)) {
      observedFlowIds.add(flow.id);
      log = appendLog(
        { log, turn },
        "discovery",
        `Flow discovered: ${flow.from} -> ${flow.to} (${flow.port})`
      );
    }
  }

  // --- c. attacker spread --------------------------------------------------
  if (turn === PATIENT_ZERO_TURN) {
    const result = pick(rngState, PATIENT_ZERO_CANDIDATES);
    rngState = result.rngState;
    compromisedIds.add(result.value);
    intrusionKnown = true;
    log = appendLog({ log, turn }, "attacker", "An intrusion is underway.");
  } else if (turn >= ATTACKER_START_TURN) {
    const reachable = new Set();
    for (const flow of FLOWS) {
      if (state.blockedFlowIds.has(flow.id)) continue;
      const fromCompromised = compromisedIds.has(flow.from);
      const toCompromised = compromisedIds.has(flow.to);
      if (fromCompromised && !toCompromised) reachable.add(flow.to);
      if (toCompromised && !fromCompromised) reachable.add(flow.from);
    }
    if (reachable.size > 0) {
      const candidates = [...reachable];
      const result = weightedPick(rngState, candidates, (id) => DEGREES[id]);
      rngState = result.rngState;
      compromisedIds.add(result.value);
    }
  }

  // --- d. detection ----------------------------------------------------
  for (const id of compromisedIds) {
    if (detectedIds.has(id)) continue;
    if (state.probes.has(id)) {
      detectedIds.add(id);
      log = appendLog({ log, turn }, "attacker", `Alert: intrusion detected on ${workloadNameOf(id)}`);
      if (firstDetectionTurn === null) firstDetectionTurn = turn;
    }
  }

  // --- e. outage damage --------------------------------------------------
  const cumulativeOutageTurns = state.cumulativeOutageTurns + state.outages.length;

  // --- f. score is a derived value; see computeScore() below -------------

  const isLastTurn = turn >= TOTAL_TURNS;

  return {
    ...state,
    rngState,
    log,
    observedFlowIds,
    compromisedIds,
    detectedIds,
    intrusionKnown,
    firstDetectionTurn,
    cumulativeOutageTurns,
    turn: isLastTurn ? turn : turn + 1,
    ap: isLastTurn ? 0 : STARTING_AP,
    gameOver: isLastTurn,
  };
}

// ---------------------------------------------------------------------------
// Scoring (spec Section 5)
// ---------------------------------------------------------------------------

export function computeScore(state) {
  // A workload counts as protected only if it is both uncompromised AND
  // serving. The business does not care whether an application is down
  // because an attacker took it or because a firewall rule cut its
  // dependency -- so both cost the same. This is what stops "block
  // everything on turn 1" from being the dominant strategy.
  const lost = new Set(state.compromisedIds);
  for (const outage of state.outages) lost.add(outage.workloadId);

  const containment = 60 * ((WORKLOADS.length - lost.size) / WORKLOADS.length);
  const infraGroupsFenced = ["infra-dns", "infra-core"].filter((g) => state.fencedGroups.has(g)).length;
  const infrastructure = 20 * (infraGroupsFenced / 2);
  // Gentle, gradual penalty. At 4 points per outage-turn the whole 20 points
  // vanished after five turns of a single outage, so uptime was effectively
  // binary and every strategy that fenced at all scored zero here. A third of
  // a point per outage-turn keeps a real gradient across the range good play
  // actually produces (roughly 0-60 outage-turns).
  const uptime = Math.max(0, 20 - OUTAGE_POINTS_PER_TURN * state.cumulativeOutageTurns);
  const total = Math.round(containment + infrastructure + uptime);
  return { containment, infrastructure, uptime, total };
}

export function scoreBand(total) {
  if (total >= 90) return "Zero Trust Achieved";
  if (total >= 75) return "Strong Posture";
  if (total >= 55) return "Partially Segmented";
  if (total >= 30) return "Flat Network";
  return "Total Compromise";
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function workloadNameOf(id) {
  const w = WORKLOADS_BY_ID[id];
  return w ? w.name : id;
}

function appendLog(stateLike, kind, text) {
  return [...stateLike.log, { turn: stateLike.turn, kind, text }];
}

export { WORKLOADS_BY_ID };
