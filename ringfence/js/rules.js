/*
 * RINGFENCE rules engine.
 *
 * Pure game logic with no DOM access. It loads as a classic <script> in the
 * browser (exposed as window.RF) and as a CommonJS module in Node (used by
 * tools/sim.js). Rules follow docs/RINGFENCE-GAME-DESIGN.md, Section 5.
 *
 * Cells are indexed 0..48, row-major. Row 0 is "row 1" on the printed board
 * (the internet edge); column 0 is "a".
 *
 * Business flows are hidden and drawn at random each game. Security
 * Intelligence reveals them over time: everyday flows after one round of
 * traffic history, rare (month-end) flows once the look-back reaches last
 * month's run, one round before they run again. Locking down an app is two
 * steps, as in the real workflow: publish allow rules (exceptions) for its
 * flows, then ring-fence it to block everything else. A real flow that ends
 * up blocked is an outage.
 *
 * v0.3: there are no environments (Dev/Prod) or Decoys. The Defender can
 * secretly swap two face-down tokens, or pretend to. The Attacker's jewel
 * odds for each token are public bookkeeping (token.ak), so an unseen swap
 * blurs whatever Recon had learned.
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
    setupJewels: 3,
    setupSensors: 3,
    scoreHarden: 1,
    scoreRingfence: 3,
    scoreQuarantine: 1,
    // Secret swap of two face-down tokens (design doc Section 5.3).
    swapCost: 3, // Insight
    swapScorePenalty: 0, // Score lost per swap (the "migration downtime" rule)
    swapsPerGame: 2,
    // Hidden business flows (design doc Section 5.7).
    flowsPerGame: 11,
    rareFlowShare: 0.3,
    flowSeenRound: 2, // everyday flows show up after one round of traffic
    rareSeenRound: 4, // month-end flows show up once the look-back reaches them
    rareFlowRound: 5, // ...and run again (breaking if blocked) from this round
    outagePenalty: 2,
    allowCost: 0, // publishing the recommendation: one click, no Insight
    manualExceptionCost: 1, // extra, per exception the recommendation didn't include
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
    A: { name: 'Developer desktops' },
    B: { name: 'Build agents' },
    C: { name: 'Test harness' },
    D: { name: 'CI/CD pipeline' },
    E: { name: 'Staging' },
    F: { name: 'HR system' },
    G: { name: 'Inventory' },
    H: { name: 'Web storefront', internetFacing: true },
    J: { name: 'App / API tier' },
    K: { name: 'Customer database' },
    L: { name: 'Payments' },
  };
  const INFRA = {
    NTP: 'Time service',
    DNS: 'Name resolution',
    LDAP: 'Directory',
  };

  // ---------------------------------------------------------------- geometry

  const REGION = [];
  LAYOUT.forEach((row) => row.split(' ').forEach((r) => REGION.push(r)));

  const rowOf = (i) => Math.floor(i / SIZE);
  const colOf = (i) => i % SIZE;
  const cellName = (i) => COLS[colOf(i)] + (rowOf(i) + 1);
  const cellIndex = (name) =>
    (parseInt(name.slice(1), 10) - 1) * SIZE + COLS.indexOf(name[0]);
  const isInfra = (i) => REGION[i] in INFRA;
  const edgeKey = (a, b) => (a < b ? a + '-' + b : b + '-' + a);

  const APP_CELLS = {};
  Object.keys(APPS).forEach((a) => (APP_CELLS[a] = []));
  const INFRA_CELLS = [];
  for (let i = 0; i < N; i++) {
    if (isInfra(i)) INFRA_CELLS.push(i);
    else APP_CELLS[REGION[i]].push(i);
  }

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
  // Edges where two different applications touch: the only places a
  // business flow can run. Keyed by app pair, e.g. 'G|J'.
  const APP_PAIRS = {};
  Object.values(EDGES).forEach((e) => {
    if (!e.border || isInfra(e.a) || isInfra(e.b)) return;
    const pair = [REGION[e.a], REGION[e.b]].sort().join('|');
    (APP_PAIRS[pair] = APP_PAIRS[pair] || []).push(e.key);
  });

  // Edges on an app's outer border (to another app or infra).
  function appBorderEdges(app) {
    return Object.values(EDGES)
      .filter((e) => e.border && (REGION[e.a] === app) !== (REGION[e.b] === app))
      .map((e) => e.key);
  }

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

  // Setup is a map { cellIndex: 'jewel' | 'sensor' }: 3 Jewels and 3 Sensors,
  // each in a different application.
  function validateSetup(setup) {
    const cells = Object.keys(setup).map(Number);
    const perApp = {};
    let jewels = 0;
    let sensors = 0;
    for (const c of cells) {
      if (isInfra(c)) return 'Tokens go on application cells, not infrastructure.';
      if (perApp[REGION[c]]) return 'Only one token per app.';
      perApp[REGION[c]] = true;
      if (setup[c] === 'jewel') jewels++;
      else if (setup[c] === 'sensor') sensors++;
      else return 'Tokens must be Jewels or Sensors.';
    }
    if (jewels !== CONFIG.setupJewels || sensors !== CONFIG.setupSensors)
      return 'Place ' + CONFIG.setupJewels + ' Crown Jewels and ' + CONFIG.setupSensors + ' Sensors (you have ' +
        jewels + ' and ' + sensors + ').';
    return null;
  }

  // Random setup: jewels go in apps without an exit cell (a jewel on an exit
  // can be stolen in two actions); sensors go anywhere else.
  function randomSetup(rng) {
    const setup = {};
    const hasExit = (app) => APPS[app].internetFacing || APP_CELLS[app].some((c) => rowOf(c) === 0);
    const safe = shuffle(Object.keys(APPS).filter((a) => !hasExit(a)), rng);
    const jewelApps = safe.slice(0, CONFIG.setupJewels);
    const rest = shuffle(Object.keys(APPS).filter((a) => !jewelApps.includes(a)), rng).slice(0, CONFIG.setupSensors);
    const pick = (app) => APP_CELLS[app][Math.floor(rng() * APP_CELLS[app].length)];
    jewelApps.forEach((a) => (setup[pick(a)] = 'jewel'));
    rest.forEach((a) => (setup[pick(a)] = 'sensor'));
    return setup;
  }

  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // Draw this game's hidden business flows: every app talks to at least one
  // neighbour, each flow runs over one specific shared edge, and some flows
  // are rare (month-end jobs) that Security Intelligence sees only late.
  function generateFlows(rng) {
    const pairs = Object.keys(APP_PAIRS).sort();
    const used = new Set();
    const flows = {};
    const degree = {};
    const add = (pair) => {
      used.add(pair);
      const keys = APP_PAIRS[pair];
      const key = keys[Math.floor(rng() * keys.length)];
      flows[key] = { rare: rng() < CONFIG.rareFlowShare };
      pair.split('|').forEach((a) => (degree[a] = (degree[a] || 0) + 1));
    };
    for (const app of shuffle(Object.keys(APPS), rng)) {
      if (degree[app]) continue;
      const options = pairs.filter((p) => !used.has(p) && p.split('|').includes(app));
      if (options.length) add(options[Math.floor(rng() * options.length)]);
    }
    const rest = shuffle(pairs.filter((p) => !used.has(p)), rng);
    while (Object.keys(flows).length < CONFIG.flowsPerGame && rest.length) add(rest.pop());
    return flows;
  }

  function newGame(setup, opts) {
    opts = opts || {};
    const err = validateSetup(setup);
    if (err) throw new Error(err);
    const tokens = {};
    Object.keys(setup).forEach((c) => {
      // ak: the Attacker's jewel odds for this token (public). null = use the
      // prior spread over all setup tokens it knows nothing about.
      tokens[c] = { type: setup[c], origin: 'setup', faceUp: false, recon: false, ak: null };
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
      pool: { sensor: CONFIG.deploySensors },
      swapsUsed: 0,
      swappedThisTurn: false,
      stones: new Array(N).fill(0),
      walls: {},
      hardened: {},
      fenced: {},
      tokens,
      winner: null,
      reason: '',
      flows: opts.flows || generateFlows(opts.rng || Math.random), // hidden truth
      discovered: {}, // flows Security Intelligence has shown the Defender
      allows: {}, // exception rules: key -> 'rec' | 'manual' | 'emergency'
      outages: 0,
    };
  }

  const clone = (s) => JSON.parse(JSON.stringify(s));

  // ------------------------------------------------------------ board queries

  // Rule order, as in a real policy: explicit walls (drop), then exception
  // (allow) rules, then the ring-fence's default drop, else open.
  function isOpen(s, key, extra) {
    const e = EDGES[key];
    if (s.walls[key]) return false;
    if (extra && extra.walls && extra.walls[key]) return false;
    if (s.allows[key]) return true;
    if (e.border && (s.fenced[REGION[e.a]] || s.fenced[REGION[e.b]])) return false;
    return true;
  }

  const isFlowActive = (s, key) =>
    !!s.flows[key] && (!s.flows[key].rare || s.round >= CONFIG.rareFlowRound);

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
    if (s.allows[key]) return 'An exception (allow rule) covers that edge.';
    if (s.discovered[key]) return 'Security Intelligence has seen a business flow there. Walling it would cause an outage.';
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

  // The Security Intelligence recommendation for locking down an app:
  // allow every observed flow on its border that isn't already allowed.
  function recommendedExceptions(s, app) {
    return appBorderEdges(app).filter((k) => s.discovered[k] && !s.allows[k] && !s.walls[k]);
  }

  const ringfenceCost = (app) => APP_CELLS[app].length;

  // The Attacker's chance that each face-down token is a Crown Jewel, from
  // public information only: Recon results, what was deployed mid-game, and
  // which tokens were (maybe) swapped. Tokens with no information share
  // whatever jewel probability is left over.
  function attackerJewelOdds(s) {
    let remaining = CONFIG.setupJewels - s.jewelsTaken;
    const unknown = [];
    const odds = {};
    for (const c in s.tokens) {
      const t = s.tokens[c];
      if (t.faceUp) {
        if (t.type === 'jewel') remaining--;
        continue;
      }
      if (t.ak == null) unknown.push(c);
      else {
        odds[c] = t.ak;
        remaining -= t.ak;
      }
    }
    const share = unknown.length ? Math.max(0, Math.min(1, remaining / unknown.length)) : 0;
    unknown.forEach((c) => (odds[c] = share));
    return odds;
  }

  function swapError(s, a, b) {
    if (a === b) return 'Pick two different tokens.';
    for (const c of [a, b]) {
      const t = s.tokens[c];
      if (!t || t.faceUp) return 'Swap needs two face-down tokens.';
      if (NEIGHBORS[c].some((n) => s.stones[n.cell])) return 'Tokens next to an attacker stone can’t be moved.';
    }
    if (s.swappedThisTurn) return 'Only one swap per turn.';
    if (s.swapsUsed >= CONFIG.swapsPerGame) return 'No swaps left this game.';
    if (s.insight < CONFIG.swapCost) return 'Swapping costs ' + CONFIG.swapCost + ' Insight.';
    return null;
  }

  // Allow cost: 1, plus 1 per manual exception (one the recommendation didn't include).
  function allowCost(s, edges) {
    return CONFIG.allowCost +
      edges.filter((k) => !s.discovered[k] && !s.allows[k]).length * CONFIG.manualExceptionCost;
  }

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
      case 'allow': {
        const app = a.app;
        if (!APPS[app]) return 'Pick an application.';
        // Defaults to the Security Intelligence recommendation for the app.
        const edges = (Array.isArray(a.edges) ? [...new Set(a.edges)] : recommendedExceptions(s, app))
          .filter((k) => !s.allows[k]);
        const border = new Set(appBorderEdges(app));
        if (!edges.length)
          return 'Nothing new to allow: Security Intelligence hasn’t observed any flows on app ' + app + '’s border yet.';
        for (const k of edges) {
          if (!border.has(k)) return 'Exceptions must be on app ' + app + '’s border.';
          if (s.walls[k]) return 'There is a wall on that edge. An exception would contradict it.';
        }
        const cost = allowCost(s, edges);
        if (s.insight < cost) return 'Publishing these exceptions costs ' + cost + ' Insight.';
        s.insight -= cost;
        let rec = 0;
        let manual = 0;
        edges.forEach((k) => {
          if (s.discovered[k]) { s.allows[k] = 'rec'; rec++; } else { s.allows[k] = 'manual'; manual++; }
        });
        const parts = [];
        if (rec) parts.push(rec + ' recommended');
        if (manual) parts.push(manual + ' manual');
        ev.push({
          kind: 'allow', app, edges,
          text: 'Allow: published ' + parts.join(' and ') + ' exception' + (edges.length > 1 ? 's' : '') + ' for app ' + app + ' (' + APPS[app].name + ').',
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
        const open = appBorderEdges(app).filter((k) => s.allows[k]).length;
        ev.push({
          kind: 'ringfence', app,
          text: 'Ring-fence app ' + app + ' (' + APPS[app].name + '): ' +
            (open ? open + ' exception' + (open > 1 ? 's' : '') + ' kept open, ' : 'no exceptions, ') +
            'everything else blocked (+' + CONFIG.scoreRingfence + ' score).',
        });
        break;
      }
      case 'deploy': {
        const c = a.cell;
        if (s.pool.sensor <= 0) return 'No Sensors left in your pool.';
        if (s.insight < CONFIG.deployCost) return 'Not enough Insight.';
        if (isInfra(c)) return 'Tokens cannot go on infrastructure cells.';
        if (s.stones[c]) return 'That cell has an attacker stone on it.';
        if (s.tokens[c]) return 'That cell already has a token.';
        s.insight -= CONFIG.deployCost;
        s.pool.sensor--;
        // Placed in plain sight mid-game, so the Attacker knows it's a Sensor
        // until a swap blurs it.
        s.tokens[c] = { type: 'sensor', origin: 'deploy', faceUp: false, recon: false, ak: 0 };
        ev.push({ kind: 'deploy', cell: c, text: 'Deploy a face-down Sensor on ' + cellName(c) + '.' });
        break;
      }
      case 'swap': {
        const err = swapError(s, a.a, a.b);
        if (err) return err;
        const odds = attackerJewelOdds(s);
        const mixed = (odds[a.a] + odds[a.b]) / 2;
        s.insight -= CONFIG.swapCost;
        s.score -= CONFIG.swapScorePenalty;
        s.swapsUsed++;
        s.swappedThisTurn = true;
        if (a.really) [s.tokens[a.a], s.tokens[a.b]] = [s.tokens[a.b], s.tokens[a.a]];
        [s.tokens[a.a], s.tokens[a.b]].forEach((t) => {
          t.recon = false;
          t.ak = mixed;
        });
        const costs = [];
        if (CONFIG.swapCost) costs.push(CONFIG.swapCost + ' Insight');
        if (CONFIG.swapScorePenalty) costs.push('−' + CONFIG.swapScorePenalty + ' score');
        ev.push({
          kind: 'swap', cells: [a.a, a.b], really: !!a.really,
          text: 'Swap: shuffled the tokens on ' + cellName(a.a) + ' and ' + cellName(a.b) +
            (a.really ? ' (they really swapped)' : ' (a bluff: nothing moved)') + (costs.length ? ', ' + costs.join(', ') : '') + '.',
        });
        break;
      }
      default:
        return 'Unknown Defender action.';
    }
    s.actionsLeft--;
    afterDefenderAction(s, ev);
    return null;
  }

  // Any active business flow that policy now blocks is an outage: the change
  // is rolled back with an emergency allow rule, and it costs Score.
  function checkOutages(s, ev) {
    for (const key in s.flows) {
      if (!isFlowActive(s, key) || isOpen(s, key)) continue;
      const e = EDGES[key];
      if (s.walls[key]) {
        delete s.walls[key];
        s.wallsLeft++;
      }
      s.allows[key] = 'emergency';
      s.discovered[key] = true;
      s.score -= CONFIG.outagePenalty;
      s.outages++;
      ev.push({
        kind: 'outage', edge: key,
        text: 'OUTAGE: ' + APPS[REGION[e.a]].name + ' ↔ ' + APPS[REGION[e.b]].name + ' (' + cellName(e.a) + '–' + cellName(e.b) + ')' +
          (s.flows[key].rare ? ', a month-end flow,' : '') + ' was blocked. Emergency allow rule added (−' + CONFIG.outagePenalty + ' score).',
      });
    }
  }

  // Security Intelligence reveals flows once there's enough traffic history.
  function discoverFlows(s, ev) {
    const found = [];
    for (const key in s.flows) {
      if (s.discovered[key]) continue;
      const seen = s.flows[key].rare ? CONFIG.rareSeenRound : CONFIG.flowSeenRound;
      if (s.round >= seen) {
        s.discovered[key] = true;
        found.push(key);
      }
    }
    if (!found.length) return;
    const blocked = found.filter((k) => !isOpen(s, k));
    let text = 'Security Intelligence observed ' + found.length + ' new business flow' + (found.length > 1 ? 's' : '') + '.';
    if (blocked.length) {
      text += ' ' + blocked.length + ' of them ' + (blocked.length > 1 ? 'are' : 'is') + ' blocked by your policy (' +
        blocked.map((k) => cellName(EDGES[k].a) + '–' + cellName(EDGES[k].b)).join(', ') +
        '). Allow ' + (blocked.length > 1 ? 'them' : 'it') + ' before round ' + CONFIG.rareFlowRound + ' or it becomes an outage.';
    }
    ev.push({ kind: 'discover', edges: found, text });
  }

  function afterDefenderAction(s, ev) {
    checkOutages(s, ev);
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
        const viaFlow = NEIGHBORS[c].some((n) => s.stones[n.cell] && s.allows[n.key]);
        const viaHub = isInfra(c) && INFRA_CELLS.some((k) => k !== c && s.stones[k] && !s.hardened[k]);
        let how = '';
        if (viaHub && !NEIGHBORS[c].some((n) => s.stones[n.cell] && isOpen(s, n.key))) how = ' (hub hop)';
        else if (viaFlow) how = ' (through an allowed flow)';
        placeStone(s, c, ev, 'Spread to ' + cellName(c) + how + '.');
        break;
      }
      case 'recon': {
        const t = s.tokens[c];
        if (!t || t.faceUp) return 'Recon needs a face-down token.';
        if (!adjacentToStone(s, c)) return 'Recon needs an open edge from one of your stones.';
        t.recon = true;
        t.ak = t.type === 'jewel' ? 1 : 0;
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
      delete s.tokens[c];
      s.actionsLeft = 1; // the caller's decrement takes it to 0
      ev.push({ kind: 'sensor', cell: c, text: 'SENSOR on ' + cellName(c) + ' triggered: stone removed, Attacker’s turn ends.' });
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
      s.swappedThisTurn = false;
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
    if (s.turn === 'defender') {
      discoverFlows(s, ev);
      checkOutages(s, ev);
    }
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
  // unless revealed or seen by Recon (and not swapped since). token.ak holds
  // its public jewel odds.
  function attackerView(s) {
    const v = clone(s);
    Object.values(v.tokens).forEach((t) => {
      if (!t.faceUp && !t.recon) t.type = 'unknown';
    });
    // The Defender's flow data is theirs alone. Allow rules on the board are public.
    v.flows = {};
    v.discovered = {};
    return v;
  }

  return {
    SIZE, N, CONFIG, LAYOUT, APPS, INFRA, REGION, EDGES, NEIGHBORS,
    APP_CELLS, INFRA_CELLS, APP_PAIRS,
    rowOf, colOf, cellName, cellIndex, isInfra, edgeKey, attackerJewelOdds, swapError,
    makeRng, shuffle, validateSetup, randomSetup, generateFlows, newGame, clone,
    appBorderEdges, recommendedExceptions, isFlowActive, allowCost,
    isOpen, attackerNeighbors, canEnter, isExit, isBreachable, groupOf, allGroups,
    groupHasExit, adjacentToStone, wallError, wallableEdges, ringfenceCost,
    act, legalAttackerActions, attackerView,
  };
});
