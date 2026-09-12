// Blast Radius — input.js
//
// Translates raw DOM/pointer/keyboard events into abstract intents (a tap on
// a workload, a tap on empty space, a debug-toggle request, a pan/zoom
// change) via callbacks. Holds interaction bookkeeping (pointer tracking,
// view transform) but no game state and no game rules — main.js decides what
// each intent means for the game and calls into state.js.

const TAP_MAX_MOVE_PX = 10; // spec 6.4
const TAP_MAX_DURATION_MS = 500; // spec 6.4
const ZOOM_MIN = 0.8;
const ZOOM_MAX = 3;
const LONG_PRESS_MS = 800; // spec 8: touch equivalent of the "D" debug key

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Wires Pointer Events on `svg` for pan (one finger / mouse drag), pinch or
 * wheel zoom, and tap detection (spec 6.2, 6.4). One code path for mouse,
 * touch and stylus, as required.
 *
 * options:
 *   getBaseViewBox() -> { width, height }   the fit-to-screen viewBox for
 *                                            the current layout mode
 *   onTap({ workloadId, clientX, clientY }) called on a real tap; workloadId
 *                                            is null for a tap on empty space
 *   findWorkloadId(target) -> id|null       resolves an event target to a
 *                                            workload id (or null)
 */
export function createViewController(svg, { getBaseViewBox, onTap, findWorkloadId }) {
  let base = getBaseViewBox();
  let zoom = 1;
  let cx = base.width / 2;
  let cy = base.height / 2;

  const pointers = new Map(); // pointerId -> { x, y } (client coords)
  let mode = null; // null | "pan" | "pinch"
  let panAnchor = null; // { x, y, cx0, cy0 }
  let pinchAnchor = null; // { dist0, zoom0 }
  let tapCandidate = null; // { pointerId, x, y, t, moved }

  function currentViewBox() {
    const w = base.width / zoom;
    const h = base.height / zoom;
    const halfW = w / 2;
    const halfH = h / 2;
    let x = cx - halfW;
    let y = cy - halfH;
    // Clamp so the map cannot be panned past its own edges (spec 6.2).
    // `base` is the window shown at zoom 1; `world` is the full board, which
    // may be taller than that window (tall mode pans vertically).
    const worldW = (base.world && base.world.width) || base.width;
    const worldH = (base.world && base.world.height) || base.height;
    if (w >= worldW) {
      x = (worldW - w) / 2;
    } else {
      x = clamp(x, 0, worldW - w);
    }
    if (h >= worldH) {
      y = (worldH - h) / 2;
    } else {
      y = clamp(y, 0, worldH - h);
    }
    return { x, y, w, h };
  }

  function applyViewBox() {
    const vb = currentViewBox();
    svg.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  }

  function clientDeltaToViewBoxDelta(dx, dy) {
    const rect = svg.getBoundingClientRect();
    const vb = currentViewBox();
    const scaleX = rect.width > 0 ? vb.w / rect.width : 1;
    const scaleY = rect.height > 0 ? vb.h / rect.height : 1;
    return { dx: dx * scaleX, dy: dy * scaleY };
  }

  function startPan(pointerId) {
    const p = pointers.get(pointerId);
    mode = "pan";
    panAnchor = { x: p.x, y: p.y, cx0: cx, cy0: cy };
  }

  function startPinch() {
    const [a, b] = [...pointers.values()];
    mode = "pinch";
    pinchAnchor = { dist0: Math.max(1, distance(a, b)), zoom0: zoom };
  }

  function onPointerDown(e) {
    svg.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 1) {
      tapCandidate = {
        pointerId: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        t: Date.now(),
        moved: 0,
        target: e.target,
      };
      startPan(e.pointerId);
    } else if (pointers.size === 2) {
      tapCandidate = null; // a second finger means this is never a tap
      startPinch();
    }
  }

  function onPointerMove(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (tapCandidate && tapCandidate.pointerId === e.pointerId) {
      tapCandidate.moved = Math.max(
        tapCandidate.moved,
        distance({ x: tapCandidate.x, y: tapCandidate.y }, { x: e.clientX, y: e.clientY })
      );
    }

    if (mode === "pinch" && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.max(1, distance(a, b));
      zoom = clamp(pinchAnchor.zoom0 * (dist / pinchAnchor.dist0), ZOOM_MIN, ZOOM_MAX);
      applyViewBox();
    } else if (mode === "pan" && pointers.size === 1) {
      const p = pointers.get(e.pointerId);
      const { dx, dy } = clientDeltaToViewBoxDelta(p.x - panAnchor.x, p.y - panAnchor.y);
      cx = panAnchor.cx0 - dx;
      cy = panAnchor.cy0 - dy;
      applyViewBox();
    }
  }

  function endPointer(e) {
    const wasTap =
      tapCandidate &&
      tapCandidate.pointerId === e.pointerId &&
      pointers.size === 1 &&
      tapCandidate.moved < TAP_MAX_MOVE_PX &&
      Date.now() - tapCandidate.t < TAP_MAX_DURATION_MS;

    pointers.delete(e.pointerId);

    if (wasTap) {
      const workloadId = findWorkloadId(tapCandidate.target);
      onTap({ workloadId, clientX: tapCandidate.x, clientY: tapCandidate.y });
    }
    tapCandidate = null;

    if (pointers.size === 0) {
      mode = null;
    } else if (pointers.size === 1) {
      // Dropped from pinch (or a stray extra pointer) back to one finger —
      // re-anchor panning from here so the view doesn't jump.
      const [remainingId] = pointers.keys();
      startPan(remainingId);
    }
  }

  function onWheel(e) {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    zoom = clamp(zoom * factor, ZOOM_MIN, ZOOM_MAX);
    applyViewBox();
  }

  svg.addEventListener("pointerdown", onPointerDown);
  svg.addEventListener("pointermove", onPointerMove);
  svg.addEventListener("pointerup", endPointer);
  svg.addEventListener("pointercancel", endPointer);
  svg.addEventListener("wheel", onWheel, { passive: false });

  applyViewBox();

  return {
    resetView() {
      zoom = 1;
      cx = base.width / 2;
      cy = base.height / 2;
      applyViewBox();
    },
    setBaseViewBox(newBase) {
      base = newBase;
      zoom = 1;
      cx = base.width / 2;
      cy = base.height / 2;
      applyViewBox();
    },
  };
}

/** Global "D" key toggles the debug overlay (spec Section 8). */
export function attachDebugKey(onToggle) {
  window.addEventListener("keydown", (e) => {
    if (e.key === "d" || e.key === "D") {
      if (e.target && ["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;
      onToggle();
    }
  });
}

/** Long-press (800ms) touch equivalent of the debug key (spec Section 8). */
export function attachLongPress(el, onLongPress) {
  let timer = null;
  let moved = false;
  let start = null;

  function clear() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  el.addEventListener("pointerdown", (e) => {
    moved = false;
    start = { x: e.clientX, y: e.clientY };
    clear();
    timer = setTimeout(() => {
      if (!moved) onLongPress();
    }, LONG_PRESS_MS);
  });
  el.addEventListener("pointermove", (e) => {
    if (!start) return;
    if (distance(start, { x: e.clientX, y: e.clientY }) > TAP_MAX_MOVE_PX) {
      moved = true;
      clear();
    }
  });
  el.addEventListener("pointerup", clear);
  el.addEventListener("pointercancel", clear);
}
