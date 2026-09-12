// Blast Radius — layout.js
//
// Pure geometry. Exports positions(mode) -> { viewBox, positions, bands }
// where `positions` maps workload id -> {x, y} and `bands` is a list of
// zone-band rectangles used for the visual zone grouping (spec 6.1).
//
// No DOM access. No game state. Same mode always yields the same output.

import { WORKLOADS } from "../data/estate.js";

const ZONE_ORDER = ["shared", "prod", "dev", "mgmt"];
const ZONE_LABELS = { shared: "shared", prod: "prod", dev: "dev", mgmt: "mgmt" };

const ROW_PITCH = 110; // spec 6.1: "Row pitch is 110px"
const LABEL_HEIGHT = 24; // spec 6.1: "24px label"
const BAND_PADDING = 16; // spec 6.1: "16px padding"
const FIRST_ROW_OFFSET = 55; // spec 6.1: "first row's centre sits 55px below the band's label baseline"

const ROW_X_CENTERS = {
  3: [90, 210, 330],
  2: [150, 270],
  1: [210],
};

function idsForZone(zone) {
  return WORKLOADS.filter((w) => w.zone === zone).map((w) => w.id);
}

// Node visual sizing per mode (spec 6.3).
export const NODE_STYLE = {
  wide: { radius: 18, label: 11, hit: 24 },
  tall: { radius: 22, label: 13, hit: 30 },
};

// Edge stroke widths per mode (spec 6.3).
export const EDGE_STYLE = {
  wide: { allowed: 1, blocked: 1.5 },
  tall: { allowed: 1.5, blocked: 2 },
};

function bandHeightForRowCount(rowCount) {
  return LABEL_HEIGHT + rowCount * ROW_PITCH + BAND_PADDING;
}

// ---------------------------------------------------------------------------
// tall mode: four stacked bands, each a grid of up to 3 nodes per row.
// ---------------------------------------------------------------------------

const TALL_VIEWBOX = { width: 420, height: 1348 };
const TALL_TOP_MARGIN = 20;
const TALL_BAND_GAP = 16;

// Row-size pattern per zone (spec 6.1 table: "3 + 2", "3+3+3+1", etc).
// Node-to-row assignment follows declaration order in estate.js.
const TALL_ROW_PATTERN = {
  shared: [3, 2],
  prod: [3, 3, 3, 1],
  dev: [3, 2],
  mgmt: [2, 2],
};

function tallLayout() {
  const positions = {};
  const bands = [];
  let bandTop = TALL_TOP_MARGIN;

  for (const zone of ZONE_ORDER) {
    const ids = idsForZone(zone);
    const rowSizes = TALL_ROW_PATTERN[zone];
    const expectedCount = rowSizes.reduce((a, b) => a + b, 0);
    if (ids.length !== expectedCount) {
      throw new Error(
        `layout.js: zone "${zone}" has ${ids.length} workloads but row pattern expects ${expectedCount}`
      );
    }

    const bandHeight = bandHeightForRowCount(rowSizes.length);

    let cursor = 0;
    rowSizes.forEach((rowSize, rowIndex) => {
      const xCenters = ROW_X_CENTERS[rowSize];
      if (!xCenters) throw new Error(`layout.js: no x-centre table for row size ${rowSize}`);
      const y = bandTop + LABEL_HEIGHT + FIRST_ROW_OFFSET + rowIndex * ROW_PITCH;
      for (let i = 0; i < rowSize; i++) {
        const id = ids[cursor];
        positions[id] = { x: xCenters[i], y };
        cursor++;
      }
    });

    bands.push({
      zone,
      label: ZONE_LABELS[zone],
      x: 0,
      y: bandTop,
      width: TALL_VIEWBOX.width,
      height: bandHeight,
      labelX: TALL_VIEWBOX.width / 2,
      labelY: bandTop + 16,
    });

    bandTop += bandHeight + TALL_BAND_GAP;
  }

  return { mode: "tall", viewBox: TALL_VIEWBOX, positions, bands };
}

// ---------------------------------------------------------------------------
// wide mode: four vertical zone columns (spec 6.1 table).
// ---------------------------------------------------------------------------

const WIDE_VIEWBOX = { width: 960, height: 800 };
const WIDE_COLUMN_PAD_X = 100;
const WIDE_TOP_MARGIN = 40;
const WIDE_BOTTOM_MARGIN = 40;

function wideColumnCenters(count, bandTop) {
  const centers = [];
  let y = bandTop + LABEL_HEIGHT + FIRST_ROW_OFFSET;
  for (let i = 0; i < count; i++) {
    centers.push(y);
    y += ROW_PITCH;
  }
  return centers;
}

function wideLayout() {
  const positions = {};
  const bands = [];
  const usableHeight = WIDE_VIEWBOX.height - WIDE_TOP_MARGIN - WIDE_BOTTOM_MARGIN;

  // Each entry: zone id, label, list of {x, ids} single-file sub-columns.
  const prodIds = idsForZone("prod");
  const columns = [
    { zone: "shared", subcolumns: [{ x: 140, ids: idsForZone("shared") }] },
    {
      zone: "prod",
      subcolumns: [
        { x: 340, ids: prodIds.slice(0, 5) },
        { x: 460, ids: prodIds.slice(5, 10) },
      ],
    },
    { zone: "dev", subcolumns: [{ x: 660, ids: idsForZone("dev") }] },
    { zone: "mgmt", subcolumns: [{ x: 860, ids: idsForZone("mgmt") }] },
  ];

  for (const { zone, subcolumns } of columns) {
    const count = subcolumns[0].ids.length;
    const bandHeight = bandHeightForRowCount(count);
    const bandTop = WIDE_TOP_MARGIN + (usableHeight - bandHeight) / 2;
    const centers = wideColumnCenters(count, bandTop);

    for (const { x, ids } of subcolumns) {
      ids.forEach((id, i) => {
        positions[id] = { x, y: centers[i] };
      });
    }

    const xs = subcolumns.map((c) => c.x);
    const minX = Math.min(...xs) - WIDE_COLUMN_PAD_X;
    const maxX = Math.max(...xs) + WIDE_COLUMN_PAD_X;
    const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;

    bands.push({
      zone,
      label: ZONE_LABELS[zone],
      x: minX,
      y: bandTop,
      width: maxX - minX,
      height: bandHeight,
      labelX: centerX,
      labelY: bandTop + 16,
    });
  }

  return { mode: "wide", viewBox: WIDE_VIEWBOX, positions, bands };
}

// ---------------------------------------------------------------------------

export function positions(mode) {
  if (mode === "wide") return wideLayout();
  if (mode === "tall") return tallLayout();
  throw new Error(`layout.js: unknown mode "${mode}"`);
}

// spec 6.1: mode is chosen by viewport width, never by user agent sniffing.
export function modeForWidth(width) {
  return width >= 900 ? "wide" : "tall";
}
