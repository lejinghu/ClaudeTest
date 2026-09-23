/*
 * RINGFENCE rules engine.
 *
 * Pure game logic with no DOM access. It loads as a classic <script> in the
 * browser (exposed as window.RF) and as a CommonJS module in Node (used by
 * tools/sim.js). Rules follow docs/RINGFENCE-GAME-DESIGN.md, Section 5.
 *
 * Cells are indexed 0..48, row-major. Row 0 is "row 1" on the printed board
 * (the internet edge); column 0 is "a".
 */
(function (root, factory) {
  const RF = factory();
  if (typeof module === 'object' && module.exports) module.exports = RF;
  else root.RF = RF;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SIZE = 7;
  const N = SIZE * SIZE;
  const COLS = 'abcdefg';

  // Tunable numbers (design doc Section 11). Kept in one place on purpose.
  const CONFIG = {
    actionsPerTurn: 3,
    startInsight: 3,
    assessGain: 2,
    hardenCost: 1,
    segmentCost: 1,
    wallsPerSegment: 2,
    deployCost: 1,
    scoreTarget: 10,
    jewelsToWin: 2,
    roundLimit: 12,
    walls: 12,
    stones: 20,
    deploySensors: 3,
    deployDecoys: 3,
    setupJewels: 3,
    scoreHarden: 1,
    scoreRingfence: 2,
    scoreZoneSealed: 2,
    scoreQuarantine: 1,
  };

  const LAYOUT = [
    'A A B B B C C',
    'A A B NTP B C C',
    'D D D D E E E',
    'F DNS G G G LDAP H',
    'F F F G J H H',
    'K K J J J L H',
    'K K K J L L L',
  ];

  const APPS = {
    A: { name: 'Developer desktops', zone: 'dev' },
    B: { name: 'Build agents', zone: 'dev' },
    C: { name: 'Test harness', zone: 'dev' },
    D: { name: 'CI/CD pipeline', zone: 'dev' },
    E: { name: 'Staging', zone: 'dev' },
    F: { name: 'HR system', zone: 'prod' },
    G: { name: 'Inventory', zone: 'prod' },
    H: { name: 'Web storefront', zone: 'prod', internetFacing: true },
    J: { name: 'App / API tier', zone: 'prod' },
    K: { name: 'Customer database', zone: 'prod' },
    L: { name: 'Payments', zone: 'prod' },
  };
  const INFRA = {
    NTP: 'Time service',
    DNS: 'Name resolution',
    LDAP: 'Directory',
  };
  const PROD_APPS = ['F', 'G', 'H', 'J', 'K', 'L'];

  const FLOWS = [
    ['d3', 'd4', 'CI/CD deploy'],
    ['d5', 'd6', 'Inventory ↔ API'],
    ['e5', 'f5', 'API ↔ Storefront'],
    ['b6', 'c6', 'API ↔ Customer DB'],
    ['e6', 'e7', 'API ↔ Payments'],
  ];

  // ---------------------------------------------------------------- geometry

  const REGION = [];
  LAYOUT.forEach((row) => row.split(' ').forEach((r) => REGION.push(r)));

  const rowOf = (i) => Math.floor(i / SIZE);
  const colOf = (i) => i % SIZE;
  const cellName = (i) => COLS[colOf(i)] + (rowOf(i) + 1);
  const cellIndex = (name) =>
    (parseInt(name.slice(1), 10) - 1) * SIZE + COLS.indexOf(name[0]);
  const isInfra = (i) => REGION[i] in INFRA;
  const zoneOf = (i) => (rowOf(i) < 3 ? 'dev' : 'prod');
  const edgeKey = (a, b) => (a < b ? a + '-' + b : b + '-' + a);

  const APP_CELLS = {};
  Object.keys(APPS).forEach((a) => (APP_CELLS[a] = []));
  const INFRA_CELLS = [];
  for (let i = 0; i < N; i++) {
    if (isInfra(i)) INFRA_CELLS.push(i);
    else APP_CELLS[REGION[i]].push(i);
  }

  const flowByKey = {};
  FLOWS.forEach(([a, b, name]) => {
    flowByKey[edgeKey(cellIndex(a), cellIndex(b))] = name;
  });

  const EDGES = {};
  const NEIGHBORS = [];
  for (let i = 0; i < N; i++) NEIGHBORS.push([]);
  function addEdge(a, b) {
    const key = edgeKey(a, b);
    EDGES[key] = {
      key,
      a,
      b,
      // 'v' = the two cells sit side by side, so the edge is a vertical line.
      orient: rowOf(a) === rowOf(b) ? 'v' : 'h',
      border: REGION[a] !== REGION[b],
      zone: rowOf(a) === 2 && rowOf(b) === 3,
      flow: flowByKey[key] || null,
    };
    NEIGHBORS[a].push({ cell: b, key });
    NEIGHBORS[b].push({ cell: a, key });
  }
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const i = r * SIZE + c;
      if (c + 1 < SIZE) addEdge(i, i + 1);
      if (r + 1 < SIZE) addEdge(i, i + SIZE);
    }
  }
  const ZONE_EDGES = Object.values(EDGES).filter((e) => e.zone && !e.flow).map((e) => e.key);

  // ------------------------------------------------------------------ rng

  function makeRng(seed) {
    let a = typeof seed === 'number' ? seed >>> 0 : hashString(String(seed));
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashString(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
  }

  // ---------------------------------------------------------------- setup

  // Setup is a map { cellIndex: 'jewel' | 'sensor' }.
  function validateSetup(setup) {
    const cells = Object.keys(setup).map(Number);
    const perApp = {};
    let jewels = 0;
    for (const c of cells) {
      if (isInfra(c) || APPS[REGION[c]].zone !== 'prod')
        return 'Tokens go on Prod application cells only.';
      if (perApp[REGION[c]]) return 'Only one token per Prod app.';
      perApp[REGION[c]] = true;
      if (setup[c] === 'jewel') jewels++;
      else if (setup[c] !== 'sensor') return 'Tokens must be Jewels or Sensors.';
    }
    const missing = PROD_APPS.filter((a) => !perApp[a]);
    if (missing.length) return 'Place a token in app ' + missing.join(', ') + '.';
    if (jewels !== CONFIG.setupJewels)
      return 'Place exactly ' + CONFIG.setupJewels + ' Crown Jewels (you have ' + jewels + ').';
    return null;
  }

  function randomSetup(rng) {
    const setup = {};
    const apps = PROD_APPS.slice();
    shuffle(apps, rng);
    apps.forEach((app, n) => {
      const cells = APP_CELLS[app];
      const cell = cells[Math.floor(rng() * cells.length)];
      setup[cell] = n < CONFIG.setupJewels ? 'jewel' : 'sensor';
    });
    return setup;
  }

  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function newGame(setup) {
    const err = validateSetup(setup);
    if (err) throw new Error(err);
    const tokens = {};
    Object.keys(setup).forEach((c) => {
      tokens[c] = { type: setup[c], origin: 'setup', faceUp: false, recon: false };
    });
    return {
      round: 1,
      turn: 'defender',
      actionsLeft: CONFIG.actionsPerTurn,
      breachUsed: false,
      insight: CONFIG.startInsight,
      score: 0,
      jewelsTaken: 0,
      wallsLeft: CONFIG.walls,
      stonesLeft: CONFIG.stones,
      pool: { sensor: CONFIG.deploySensors, decoy: CONFIG.deployDecoys },
      deployGone: { sensor: 0, decoy: 0 },
      stones: new Array(N).fill(0),
      walls: {},
      hardened: {},
      fenced: {},
      tokens,
      zoneSealed: false,
      winner: null,
      reason: '',
    };
  }

  const clone = (s) => JSON.parse(JSON.stringify(s));

  // ------------------------------------------------------------ board queries

  function isOpen(s, key, extra) {
    const e = EDGES[key];
    if (e.flow) return true;
    if (s.walls[key]) return false;
    if (extra && extra.walls && extra.walls[key]) return false;
    if (e.border && (s.fenced[REGION[e.a]] || s.fenced[REGION[e.b]])) return false;
    return true;
  }

  const isHardened = (s, i, extra) =>
    !!(s.hardened[i] || (extra && extra.hardened && extra.hardened[i]));

  // Cells an attacker stone on i is connected to: open edges, plus the hub
  // rule (unhardened infrastructure cells all touch each other).
  function attackerNeighbors(s, i, extra) {
    const out = [];
    for (const n of NEIGHBORS[i]) if (isOpen(s, n.key, extra)) out.push(n.cell);
    if (isInfra(i) && !isHardened(s, i, extra)) {
      for (const k of INFRA_CELLS) if (k !== i && !isHardened(s, k, extra)) out.push(k);
    }
    return out;
  }

  const canEnter = (s, i) => !s.stones[i] && !(isInfra(i) && s.hardened[i]);

  const isExit = (s, i) =>
    rowOf(i) === 0 || REGION[i] === 'H' || (isInfra(i) && !s.hardened[i]);

  const isBreachable = (i) => rowOf(i) === 0 || REGION[i] === 'H';

  function groupOf(s, start) {
    const seen = new Set([start]);
    const stack = [start];
    while (stack.length) {
      const i = stack.pop();
      for (const j of attackerNeighbors(s, i)) {
        if (s.stones[j] && !seen.has(j)) {
          seen.add(j);
          stack.push(j);
        }
      }
    }
    return [...seen];
  }

  function allGroups(s) {
    const seen = new Set();
    const groups = [];
    for (let i = 0; i < N; i++) {
      if (s.stones[i] && !seen.has(i)) {
        const g = groupOf(s, i);
        g.forEach((c) => seen.add(c));
        groups.push(g);
      }
    }
    return groups;
  }

  const groupHasExit = (s, group) => group.some((c) => isExit(s, c));

  function adjacentToStone(s, i) {
    return attackerNeighbors(s, i).some((j) => s.stones[j]);
  }

  // Why a wall cannot go on this edge, or null if it can.
  function wallError(s, key) {
    const e = EDGES[key];
    if (!e) return 'That is not an edge.';
    if (e.flow) return 'Business flow (' + e.flow + '): it can never be walled.';
    if (s.walls[key]) return 'There is already a wall there.';
    if (e.border) {
      if (!isOpen(s, key)) return 'A ring-fence already blocks that edge.';
      return null;
    }
    if (!s.fenced[REGION[e.a]])
      return 'Only border edges take walls. Ring-fence the app first to fine-tune inside it.';
    return null;
  }

  function wallableEdges(s) {
    return Object.keys(EDGES).filter((k) => !wallError(s, k));
  }

  const ringfenceCost = (app) => APP_CELLS[app].length;

  // ---------------------------------------------------------------- actions

  function act(s, action) {
    if (s.winner) return fail('The game is over.');
    const events = [];
    let err;
    if (action.type === 'endTurn') {
      endTurn(s, events);
      return { ok: true, events };
    }
    if (s.actionsLeft <= 0) return fail('No actions left. End your turn.');
    if (s.turn === 'defender') err = defenderAction(s, action, events);
    else err = attackerAction(s, action, events);
    if (err) return fail(err);
    return { ok: true, events };
  }

  const fail = (error) => ({ ok: false, error, events: [] });

  function defenderAction(s, a, ev) {
    switch (a.type) {
      case 'assess':
        s.insight += CONFIG.assessGain;
        ev.push({ kind: 'assess', text: 'Assess: +' + CONFIG.assessGain + ' Insight.' });
        break;
      case 'harden': {
        const c = a.cell;
        if (!isInfra(c)) return 'Only infrastructure services (NTP, DNS, LDAP) can be hardened.';
        if (s.hardened[c]) return REGION[c] + ' is already hardened.';
        if (s.insight < CONFIG.hardenCost) return 'Not enough Insight.';
        s.insight -= CONFIG.hardenCost;
        s.hardened[c] = true;
        s.score += CONFIG.scoreHarden;
        ev.push({ kind: 'harden', cell: c, text: 'Harden ' + REGION[c] + ' (+' + CONFIG.scoreHarden + ' score).' });
        if (s.stones[c]) {
          s.stones[c] = 0;
          s.stonesLeft++;
          ev.push({ kind: 'evict', cell: c, text: 'Attacker stone on ' + REGION[c] + ' evicted.' });
        }
        break;
      }
      case 'segment': {
        const keys = Array.isArray(a.edges) ? a.edges : [];
        if (keys.length < 1 || keys.length > CONFIG.wallsPerSegment)
          return 'Segment places 1 or ' + CONFIG.wallsPerSegment + ' walls.';
        if (new Set(keys).size !== keys.length) return 'Pick two different edges.';
        if (s.insight < CONFIG.segmentCost) return 'Not enough Insight.';
        if (s.wallsLeft < keys.length) return 'Not enough walls left in your supply.';
        for (const k of keys) {
          const we = wallError(s, k);
          if (we) return we;
        }
        s.insight -= CONFIG.segmentCost;
        keys.forEach((k) => {
          s.walls[k] = true;
          s.wallsLeft--;
        });
        ev.push({
          kind: 'segment',
          edges: keys,
          text: 'Segment: wall' + (keys.length > 1 ? 's' : '') + ' on ' +
            keys.map((k) => cellName(EDGES[k].a) + '–' + cellName(EDGES[k].b)).join(' and ') + '.',
        });
        break;
      }
      case 'ringfence': {
        const app = a.app;
        if (!APPS[app]) return 'Pick an application.';
        if (s.fenced[app]) return 'App ' + app + ' is already ring-fenced.';
        const cost = ringfenceCost(app);
        if (s.insight < cost) return 'Ring-fencing ' + app + ' costs ' + cost + ' Insight.';
        s.insight -= cost;
        s.fenced[app] = true;
        s.score += CONFIG.scoreRingfence;
        ev.push({ kind: 'ringfence', app, text: 'Ring-fence app ' + app + ' (' + APPS[app].name + ') (+' + CONFIG.scoreRingfence + ' score).' });
        break;
      }
      case 'deploy': {
        const c = a.cell;
        const kind = a.kind;
        if (kind !== 'sensor' && kind !== 'decoy') return 'Deploy a Sensor or a Decoy.';
        if (s.pool[kind] <= 0) return 'No ' + kind + 's left in your pool.';
        if (s.insight < CONFIG.deployCost) return 'Not enough Insight.';
        if (isInfra(c)) return 'Tokens cannot go on infrastructure cells.';
        if (s.stones[c]) return 'That cell has an attacker stone on it.';
        if (s.tokens[c]) return 'That cell already has a token.';
        s.insight -= CONFIG.deployCost;
        s.pool[kind]--;
        s.tokens[c] = { type: kind, origin: 'deploy', faceUp: false, recon: false };
        ev.push({ kind: 'deploy', cell: c, text: 'Deploy a face-down ' + kind + ' on ' + cellName(c) + '.' });
        break;
      }
      default:
        return 'Unknown Defender action.';
    }
    s.actionsLeft--;
    afterDefenderAction(s, ev);
    return null;
  }

  function afterDefenderAction(s, ev) {
    // Quarantine: groups with no open edge to an enterable cell are removed.
    for (const g of allGroups(s)) {
      const hasLiberty = g.some((i) =>
        attackerNeighbors(s, i).some((j) => canEnter(s, j))
      );
      if (!hasLiberty) {
        g.forEach((i) => (s.stones[i] = 0));
        s.stonesLeft += g.length;
        s.score += CONFIG.scoreQuarantine;
        ev.push({
          kind: 'quarantine',
          cells: g,
          text: 'Quarantined an attacker group of ' + g.length + ' (' +
            g.map(cellName).join(', ') + ') (+' + CONFIG.scoreQuarantine + ' score).',
        });
      }
    }
    if (!s.zoneSealed && ZONE_EDGES.every((k) => !isOpen(s, k))) {
      s.zoneSealed = true;
      s.score += CONFIG.scoreZoneSealed;
      ev.push({ kind: 'zone', text: 'Dev/Prod zone boundary sealed (+' + CONFIG.scoreZoneSealed + ' score). Leakage alerts are on.' });
    }
  }

  function attackerAction(s, a, ev) {
    const c = a.cell;
    switch (a.type) {
      case 'breach':
        if (s.breachUsed) return 'Only one Breach per turn.';
        if (!isBreachable(c)) return 'Breach targets row 1 or the internet-facing storefront (H).';
        if (!canEnter(s, c)) return 'That cell is occupied.';
        if (s.stonesLeft <= 0) return 'No stones left.';
        s.breachUsed = true;
        placeStone(s, c, ev, 'Breach ' + cellName(c) + '.');
        break;
      case 'spread': {
        if (!canEnter(s, c)) return 'That cell cannot be entered.';
        if (!adjacentToStone(s, c)) return 'Spread needs an open edge from one of your stones.';
        if (s.stonesLeft <= 0) return 'No stones left.';
        const leaked = s.zoneSealed && crossesZone(s, c);
        const viaFlow = NEIGHBORS[c].some((n) => s.stones[n.cell] && EDGES[n.key].flow);
        const viaHub = isInfra(c) && INFRA_CELLS.some((k) => k !== c && s.stones[k] && !s.hardened[k]);
        let how = '';
        if (viaHub && !NEIGHBORS[c].some((n) => s.stones[n.cell] && isOpen(s, n.key))) how = ' (hub hop)';
        else if (viaFlow) how = ' (via business flow)';
        placeStone(s, c, ev, 'Spread to ' + cellName(c) + how + '.');
        if (leaked) {
          s.insight += 1;
          ev.push({ kind: 'leak', cell: c, text: 'Leakage alert: attacker crossed the zone boundary. Defender +1 Insight.' });
        }
        break;
      }
      case 'recon': {
        const t = s.tokens[c];
        if (!t || t.faceUp) return 'Recon needs a face-down token.';
        if (!adjacentToStone(s, c)) return 'Recon needs an open edge from one of your stones.';
        t.recon = true;
        ev.push({ kind: 'recon', cell: c, text: 'Recon on ' + cellName(c) + '.' });
        break;
      }
      case 'exfil': {
        const t = s.tokens[c];
        if (!s.stones[c] || !t || t.type !== 'jewel' || !t.faceUp)
          return 'Exfil needs your stone on a revealed Crown Jewel.';
        if (!groupHasExit(s, groupOf(s, c)))
          return 'That stone’s group has no route to an exit.';
        delete s.tokens[c];
        s.jewelsTaken++;
        ev.push({ kind: 'exfil', cell: c, text: 'EXFILTRATED the Crown Jewel on ' + cellName(c) + '!' });
        if (s.jewelsTaken >= CONFIG.jewelsToWin) {
          s.winner = 'attacker';
          s.reason = 'The Attacker exfiltrated ' + s.jewelsTaken + ' Crown Jewels.';
        }
        break;
      }
      default:
        return 'Unknown Attacker action.';
    }
    s.actionsLeft = Math.max(0, s.actionsLeft - 1);
    return null;
  }

  function crossesZone(s, c) {
    const z = zoneOf(c);
    const from = attackerNeighbors(s, c).filter((j) => s.stones[j]);
    return from.length > 0 && from.every((j) => zoneOf(j) !== z);
  }

  function placeStone(s, c, ev, text) {
    s.stones[c] = 1;
    s.stonesLeft--;
    ev.push({ kind: 'stone', cell: c, text });
    const t = s.tokens[c];
    if (!t || t.faceUp) return;
    if (t.type === 'jewel') {
      t.faceUp = true;
      ev.push({ kind: 'jewel', cell: c, text: 'Crown Jewel found on ' + cellName(c) + '.' });
    } else if (t.type === 'sensor') {
      s.stones[c] = 0;
      s.stonesLeft++;
      if (t.origin === 'deploy' && s.deployGone) s.deployGone.sensor++;
      delete s.tokens[c];
      s.actionsLeft = 1; // the caller's decrement takes it to 0
      ev.push({ kind: 'sensor', cell: c, text: 'SENSOR on ' + cellName(c) + ' triggered: stone removed, Attacker’s turn ends.' });
    } else if (t.type === 'decoy') {
      if (t.origin === 'deploy' && s.deployGone) s.deployGone.decoy++;
      delete s.tokens[c];
      ev.push({ kind: 'decoy', cell: c, text: 'Decoy on ' + cellName(c) + ' discarded.' });
    }
  }

  function endTurn(s, ev) {
    if (s.turn === 'defender') {
      if (s.score >= CONFIG.scoreTarget) {
        s.winner = 'defender';
        s.reason = 'Segmentation Score reached ' + s.score + '. Zero Trust achieved.';
        ev.push({ kind: 'end', text: s.reason });
        return;
      }
      s.turn = 'attacker';
      s.breachUsed = false;
    } else {
      s.round++;
      if (s.round > CONFIG.roundLimit) {
        s.winner = 'defender';
        s.reason = 'Round ' + CONFIG.roundLimit + ' ended. The attack campaign was detected and evicted.';
        ev.push({ kind: 'end', text: s.reason });
        return;
      }
      s.turn = 'defender';
    }
    s.actionsLeft = CONFIG.actionsPerTurn;
    ev.push({ kind: 'turn', text: (s.turn === 'defender' ? 'Round ' + s.round + ': Defender' : 'Attacker') + ' to act.' });
  }

  // ------------------------------------------------ legal moves, hidden info

  function legalAttackerActions(s) {
    const out = [];
    if (s.winner || s.turn !== 'attacker' || s.actionsLeft <= 0) return [{ type: 'endTurn' }];
    const hasStones = s.stonesLeft > 0;
    for (let c = 0; c < N; c++) {
      if (hasStones && canEnter(s, c)) {
        if (!s.breachUsed && isBreachable(c)) out.push({ type: 'breach', cell: c });
        if (adjacentToStone(s, c)) out.push({ type: 'spread', cell: c });
      }
      const t = s.tokens[c];
      if (t && !t.faceUp && !t.recon && adjacentToStone(s, c)) out.push({ type: 'recon', cell: c });
      if (s.stones[c] && t && t.faceUp && t.type === 'jewel' && groupHasExit(s, groupOf(s, c)))
        out.push({ type: 'exfil', cell: c });
    }
    out.push({ type: 'endTurn' });
    return out;
  }

  // What the Attacker is allowed to know: face-down token types are hidden
  // unless revealed or seen by Recon, and so is the pool's Sensor/Decoy split.
  function attackerView(s) {
    const v = clone(s);
    Object.values(v.tokens).forEach((t) => {
      if (!t.faceUp && !t.recon) t.type = 'unknown';
    });
    v.poolTotal = v.pool.sensor + v.pool.decoy;
    delete v.pool;
    delete v.deployGone;
    return v;
  }

  return {
    SIZE, N, CONFIG, LAYOUT, APPS, INFRA, PROD_APPS, FLOWS, REGION, EDGES, NEIGHBORS,
    APP_CELLS, INFRA_CELLS, ZONE_EDGES,
    rowOf, colOf, cellName, cellIndex, isInfra, zoneOf, edgeKey,
    makeRng, shuffle, validateSetup, randomSetup, newGame, clone,
    isOpen, attackerNeighbors, canEnter, isExit, isBreachable, groupOf, allGroups,
    groupHasExit, adjacentToStone, wallError, wallableEdges, ringfenceCost,
    act, legalAttackerActions, attackerView,
  };
});
