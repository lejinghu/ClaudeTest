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
  // v0.6: territory game. Secure apps and hardened services pay Zero Trust
  // points and Insight every round; the Attacker wins by stealing a jewel or
  // by planting ransomware in several ring-fenced apps.
  const CONFIG = {
    // Defender actions available in this version (older ones stay in the
    // engine for the simulator's history, but are switched off).
    enabledActions: ['observe', 'harden', 'ringfence', 'deploy', 'isolate'],
    observeCost: 0, // Security Intelligence on one app: its flows show next turn (costs an action)
    incomeBase: 3, // Insight at the start of every Defender turn from round 2
    incomePerSecureApp: 1, // plus this per clean ring-fenced app
    ztPerSecureApp: 1, // Zero Trust points per round for each clean fenced app
    ztPerHardened: 1, // ...and for each hardened service
    ransomwareApps: 7, // Attacker wins with footholds in this many apps (blast radius)
    ringfenceFlatCost: 3, // 0 = cost is the app's size
    backdoorExtra: 1, // extra actions to move through a shared-service backdoor
    appCrossExtra: 1, // extra actions to move into a different app (new host)
    actionsPerTurn: 3,
    attackerActions: 3, // the Attacker's actions per turn (a difficulty lever)
    startInsight: 4,
    assessGain: 2,
    hardenCost: 2,
    segmentCost: 1, // Insight per wallsPerInsight walls, rounded up
    wallsPerInsight: 2, // Segment places any number of walls in one action
    deployCost: 1,
    scoreTarget: 18, // Zero Trust points
    jewelsToWin: 1,
    roundLimit: 8,
    walls: 12,
    stones: 20,
    deploySensors: 3,
    setupJewels: 3,
    setupSensors: 3,
    scoreHarden: 0, // v0.6: points come per round instead
    scoreRingfence: 0,
    scoreQuarantine: 1,
    // Secret swap of two face-down tokens (design doc Section 5.3).
    swapCost: 3, // Insight
    swapScorePenalty: 0, // Score lost per swap (the "migration downtime" rule)
    swapsPerGame: 2,
    // Hidden business flows (design doc Section 5.7).
    flowsPerGame: 15,
    rareFlowShare: 0, // v0.6: no surprise month-end flows
    flowSeenRound: 99, // v0.6: flows show up only where you Observe
    rareSeenRound: 99,
    rareFlowRound: 4, // ...and run again (breaking if blocked) from this round
    outagePenalty: 2,
    allowCost: 0, // publishing the recommendation: one click, no Insight
    manualExceptionCost: 1, // extra, per exception the recommendation didn't include
    // How an Attacker crosses an edge that is open only because of an allow
    // rule (the allowed service between two apps):
    //   0 = freely, like any open edge
    //   1 = by exploiting the allowed service: +1 action (Spread costs 2)
    //   9 = never: allow rules only admit legitimate traffic
    allowedCrossing: 1,
    // Isolate: an emergency block on any edge, even a known business flow.
    // Breaking a running flow this way is an outage that stays broken.
    isolateCost: 2,
  };

  // The defaults, so a difficulty level can override some and later reset.
  const DEFAULTS = JSON.parse(JSON.stringify(CONFIG));
  function applyConfig(overrides) {
    Object.keys(DEFAULTS).forEach((k) => (CONFIG[k] = JSON.parse(JSON.stringify(DEFAULTS[k]))));
    Object.assign(CONFIG, overrides || {});
  }

  const LAYOUT = [
    'A A B B B C C',
    'A A B NTP B C C',
    'D D D D E E E',
    'F DNS G G G LDAP H',
    'F F F G J H H',
    'K K J J J L H',
    'K K K J L L L',
  ];

  // uses: the shared services each app depends on. An unhardened service is
  // a backdoor into every app that uses it.
  const APPS = {
    A: { name: 'Developer desktops', uses: ['NTP'] },
    B: { name: 'Build agents', uses: ['NTP'] },
    C: { name: 'Test harness', uses: ['NTP', 'LDAP'] },
    D: { name: 'CI/CD pipeline', uses: ['NTP', 'DNS'] },
    E: { name: 'Staging', uses: ['LDAP'] },
    F: { name: 'HR system', uses: ['DNS'] },
    G: { name: 'Inventory', uses: ['DNS'] },
    H: { name: 'Web storefront', internetFacing: true, uses: ['LDAP'] },
    J: { name: 'App / API tier', uses: ['DNS', 'LDAP'] },
    K: { name: 'Customer database', uses: ['DNS'] },
    L: { name: 'Payments', uses: ['LDAP'] },
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
  const INFRA_CELL = {};
  for (let i = 0; i < N; i++) {
    if (isInfra(i)) {
      INFRA_CELLS.push(i);
      INFRA_CELL[REGION[i]] = i;
    } else APP_CELLS[REGION[i]].push(i);
  }
  const INFRA_USERS = {};
  Object.keys(INFRA).forEach((k) => (INFRA_USERS[k] = Object.keys(APPS).filter((a) => APPS[a].uses.includes(k))));

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

  // A jewel on, or next to, a cell the Attacker can breach can be reached on
  // its very first turn.
  const isExposed = (c) => isBreachable(c) || NEIGHBORS[c].some((n) => isBreachable(n.cell));
  function exposedJewels(setup) {
    return Object.keys(setup).map(Number).filter((c) => setup[c] === 'jewel' && isExposed(c));
  }

  // Random setup: jewels go on cells away from every breach point, in apps
  // without an exit cell; sensors go anywhere else.
  function randomSetup(rng) {
    const setup = {};
    const hasExit = (app) => APPS[app].internetFacing || APP_CELLS[app].some((c) => rowOf(c) === 0);
    const safeCells = (app) => APP_CELLS[app].filter((c) => !isExposed(c));
    const safe = shuffle(Object.keys(APPS).filter((a) => !hasExit(a) && safeCells(a).length), rng);
    const jewelApps = safe.slice(0, CONFIG.setupJewels);
    const rest = shuffle(Object.keys(APPS).filter((a) => !jewelApps.includes(a)), rng).slice(0, CONFIG.setupSensors);
    const pickFrom = (cells) => cells[Math.floor(rng() * cells.length)];
    jewelApps.forEach((a) => (setup[pickFrom(safeCells(a))] = 'jewel'));
    rest.forEach((a) => (setup[pickFrom(APP_CELLS[a])] = 'sensor'));
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
      observed: {}, // app -> round Security Intelligence started observing it
      ransomware: 0, // ring-fenced apps holding attacker stones (updated each turn)
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
      broken: {}, // flows deliberately broken by Isolate (outage already charged)
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
  // An edge that would be blocked by a ring-fence if it weren't for an allow
  // rule: the allowed service is the only way across.
  function isAllowOnly(s, key) {
    const e = EDGES[key];
    return !!s.allows[key] && e.border && !!(s.fenced[REGION[e.a]] || s.fenced[REGION[e.b]]);
  }

  // Extra actions an attacker spends to cross edge `key` (see allowedCrossing).
  function crossExtra(s, key) {
    const e = EDGES[key];
    let x = CONFIG.allowedCrossing > 0 && CONFIG.allowedCrossing < 9 && isAllowOnly(s, key) ? CONFIG.allowedCrossing : 0;
    if (CONFIG.appCrossExtra && e.border && !isInfra(e.a) && !isInfra(e.b)) x += CONFIG.appCrossExtra;
    return x;
  }

  // Extra actions to move from cell u to its attacker-neighbour w: an edge's
  // exploit cost, or the cost of going through a shared-service backdoor.
  function linkExtra(s, u, w) {
    const nb = NEIGHBORS[u].find((n) => n.cell === w);
    return nb ? crossExtra(s, nb.key) : CONFIG.backdoorExtra;
  }

  const attackerCanCross = (s, key, extra) =>
    isOpen(s, key, extra) && !(CONFIG.allowedCrossing >= 9 && isAllowOnly(s, key));

  // Backdoors: an unhardened shared service connects to every cell of every
  // app that uses it (ring-fences allow infra traffic; only Harden stops it).
  function backdoorNeighbors(s, i, extra) {
    const out = [];
    if (isInfra(i)) {
      if (!isHardened(s, i, extra)) INFRA_USERS[REGION[i]].forEach((app) => APP_CELLS[app].forEach((c) => out.push(c)));
    } else {
      APPS[REGION[i]].uses.forEach((svc) => {
        const k = INFRA_CELL[svc];
        if (!isHardened(s, k, extra)) out.push(k);
      });
    }
    return out;
  }

  function attackerNeighbors(s, i, extra) {
    const out = [];
    for (const n of NEIGHBORS[i]) if (attackerCanCross(s, n.key, extra)) out.push(n.cell);
    for (const c of backdoorNeighbors(s, i, extra)) if (!out.includes(c)) out.push(c);
    return out;
  }

  const canEnter = (s, i) => !s.stones[i] && !(isInfra(i) && s.hardened[i]);

  // Exits: the internet edge (row 1), the internet-facing storefront, and an
  // unhardened DNS (DNS tunnelling).
  const isExit = (s, i) =>
    rowOf(i) === 0 || REGION[i] === 'H' || (REGION[i] === 'DNS' && !s.hardened[i]);

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

  // Actions a Spread onto cell c costs: 1, or more if the only way in is by
  // exploiting an allowed service.
  function spreadCost(s, c) {
    let best = Infinity;
    for (const n of NEIGHBORS[c]) {
      if (s.stones[n.cell] && attackerCanCross(s, n.key)) best = Math.min(best, 1 + crossExtra(s, n.key));
    }
    if (backdoorNeighbors(s, c).some((k) => s.stones[k])) best = Math.min(best, 1 + CONFIG.backdoorExtra);
    return best;
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

  const ringfenceCost = (app) => CONFIG.ringfenceFlatCost || APP_CELLS[app].length;
  const segmentCost = (walls) => CONFIG.segmentCost * Math.ceil(walls / CONFIG.wallsPerInsight);

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
    if (CONFIG.enabledActions && !CONFIG.enabledActions.includes(a.type)) return 'That action isn’t part of this version.';
    switch (a.type) {
      case 'observe': {
        const app = a.app;
        if (!APPS[app]) return 'Pick an application to observe.';
        if (s.observed[app] != null) return 'Security Intelligence is already observing app ' + app + '.';
        if (s.insight < CONFIG.observeCost) return 'Observing costs ' + CONFIG.observeCost + ' Insight.';
        s.insight -= CONFIG.observeCost;
        s.observed[app] = s.round;
        ev.push({ kind: 'observe', app, text: 'Observe app ' + app + ' (' + APPS[app].name + '): its flows will show at the start of your next turn.' });
        break;
      }
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
        ev.push({ kind: 'harden', cell: c, text: 'Harden ' + REGION[c] + ': the backdoor into ' + INFRA_USERS[REGION[c]].join(', ') + ' is closed' +
          (REGION[c] === 'DNS' ? ', and DNS tunnelling with it' : '') + '.' });
        if (s.stones[c]) {
          s.stones[c] = 0;
          s.stonesLeft++;
          ev.push({ kind: 'evict', cell: c, text: 'Attacker stone on ' + REGION[c] + ' evicted.' });
        }
        break;
      }
      case 'segment': {
        const keys = Array.isArray(a.edges) ? a.edges : [];
        if (keys.length < 1) return 'Pick at least one edge to wall.';
        if (new Set(keys).size !== keys.length) return 'Pick two different edges.';
        const cost = segmentCost(keys.length);
        if (s.insight < cost) return keys.length + ' wall' + (keys.length > 1 ? 's cost ' : ' costs ') + cost + ' Insight.';
        if (s.wallsLeft < keys.length) return 'Not enough walls left in your supply.';
        for (const k of keys) {
          const we = wallError(s, k);
          if (we) return we;
        }
        s.insight -= cost;
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
      case 'isolate': {
        const key = a.edge;
        const e = EDGES[key];
        if (!e) return 'Pick an edge to isolate.';
        if (s.walls[key]) return 'That edge is already walled.';
        if (s.wallsLeft < 1) return 'No walls left in your supply.';
        if (s.insight < CONFIG.isolateCost) return 'Isolating costs ' + CONFIG.isolateCost + ' Insight.';
        s.insight -= CONFIG.isolateCost;
        s.walls[key] = 'iso';
        s.wallsLeft--;
        ev.push({ kind: 'isolate', edges: [key], text: 'ISOLATE: emergency block on ' + cellName(e.a) + '–' + cellName(e.b) + '.' });
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
        // The Security Intelligence recommendation is published with the
        // lockdown: every observed flow on the border gets an allow rule.
        recommendedExceptions(s, app).forEach((k) => (s.allows[k] = 'rec'));
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
      if (s.walls[key] === 'iso') {
        // Deliberately isolated: the flow stays broken, charged once.
        if (s.broken[key]) continue;
        s.broken[key] = true;
        s.discovered[key] = true;
        s.score -= CONFIG.outagePenalty;
        s.outages++;
        ev.push({
          kind: 'outage', edge: key,
          text: 'OUTAGE (isolation): ' + APPS[REGION[e.a]].name + ' ↔ ' + APPS[REGION[e.b]].name + ' (' + cellName(e.a) + '–' + cellName(e.b) +
            ') is cut on purpose. It stays blocked (−' + CONFIG.outagePenalty + ' score).',
        });
        continue;
      }
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
    // Apps under observation since an earlier round: reveal their flows.
    for (const app in s.observed) {
      if (s.observed[app] >= s.round || s.observed[app] < 0) continue;
      s.observed[app] = -1; // done
      const keys = appBorderEdges(app).filter((k) => s.flows[k]);
      keys.forEach((k) => (s.discovered[k] = true));
      ev.push({
        kind: 'discover', edges: keys,
        text: 'Security Intelligence mapped app ' + app + ': ' + (keys.length ? keys.length + ' business flow' + (keys.length > 1 ? 's' : '') + ' (' +
          keys.map((k) => cellName(EDGES[k].a) + '–' + cellName(EDGES[k].b)).join(', ') + ')' : 'no business flows') + '.',
      });
    }
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
        const cost = spreadCost(s, c);
        if (cost > s.actionsLeft)
          return 'The only way in is by exploiting an allowed service, which takes ' + cost + ' actions.';
        const viaFlow = NEIGHBORS[c].some((n) => s.stones[n.cell] && isAllowOnly(s, n.key));
        const viaHub = backdoorNeighbors(s, c).some((k) => s.stones[k]);
        let how = '';
        if (viaHub && !NEIGHBORS[c].some((n) => s.stones[n.cell] && isOpen(s, n.key))) {
          const svc = isInfra(c) ? REGION[c] : APPS[REGION[c]].uses.find((x) => s.stones[INFRA_CELL[x]] && !s.hardened[INFRA_CELL[x]]);
          how = ' (through the unhardened ' + svc + ' backdoor)';
        }
        else if (cost > 1) how = ' by exploiting an allowed service (' + cost + ' actions)';
        if (viaHub && cost > 1 && how.includes('backdoor')) how = how.replace(')', ', ' + cost + ' actions)');
        else if (viaFlow) how = ' (through an allowed flow)';
        s.actionsLeft -= cost - 1; // the usual decrement below covers the first action
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
        if (t.revealedRound === s.round) return 'Staging the data takes time: exfiltrate this jewel next turn.';
        if (!groupHasExit(s, groupOf(s, c)))
          return 'That stone’s group has no route to an exit.';
        delete s.tokens[c];
        s.jewelsTaken++;
        ev.push({ kind: 'exfil', cell: c, text: 'EXFILTRATED the Crown Jewel on ' + cellName(c) + '!' });
        if (s.jewelsTaken >= CONFIG.jewelsToWin) {
          s.winner = 'attacker';
          s.reason = 'The Attacker exfiltrated ' + (s.jewelsTaken === 1 ? 'a Crown Jewel' : s.jewelsTaken + ' Crown Jewels') + '.';
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
      t.revealedRound = s.round; // staging the data takes until next turn
      ev.push({ kind: 'jewel', cell: c, text: 'Crown Jewel found on ' + cellName(c) + '. The Attacker can exfiltrate it from its next turn.' });
    } else if (t.type === 'sensor') {
      s.stones[c] = 0;
      s.stonesLeft++;
      delete s.tokens[c];
      s.actionsLeft = 1; // the caller's decrement takes it to 0
      ev.push({ kind: 'sensor', cell: c, text: 'SENSOR on ' + cellName(c) + ' triggered: stone removed, Attacker’s turn ends.' });
    }
  }

  // Ring-fenced apps with no attacker stone inside.
  const secureApps = (s) => Object.keys(APPS).filter((a) => s.fenced[a] && !APP_CELLS[a].some((c) => s.stones[c]));
  // Apps the Attacker has a foothold in: its blast radius.
  const ransomedApps = (s) => Object.keys(APPS).filter((a) => APP_CELLS[a].some((c) => s.stones[c]));

  function endTurn(s, ev) {
    if (s.turn === 'defender') {
      if (s.score >= CONFIG.scoreTarget) {
        s.winner = 'defender';
        s.reason = 'Zero Trust score reached ' + s.score + '.';
        ev.push({ kind: 'end', text: s.reason });
        return;
      }
      s.turn = 'attacker';
      s.breachUsed = false;
      s.swappedThisTurn = false;
    } else {
      const held = ransomedApps(s);
      s.ransomware = held.length;
      if (CONFIG.ransomwareApps && held.length >= CONFIG.ransomwareApps) {
        s.winner = 'attacker';
        s.reason = 'Ransomware: footholds in ' + held.length + ' of ' + Object.keys(APPS).length + ' apps (' + held.join(', ') + '). The blast radius was too big.';
        ev.push({ kind: 'end', text: s.reason });
        return;
      }
      s.round++;
      if (s.round > CONFIG.roundLimit) {
        s.winner = 'defender';
        s.reason = 'Round ' + CONFIG.roundLimit + ' ended. The attack campaign was detected and evicted.';
        ev.push({ kind: 'end', text: s.reason });
        return;
      }
      s.turn = 'defender';
    }
    s.actionsLeft = s.turn === 'attacker' ? CONFIG.attackerActions : CONFIG.actionsPerTurn;
    ev.push({ kind: 'turn', text: (s.turn === 'defender' ? 'Round ' + s.round + ': Defender' : 'Attacker') + ' to act.' });
    if (s.turn === 'defender') {
      discoverFlows(s, ev);
      checkOutages(s, ev);
      roundIncome(s, ev);
    }
  }

  // Start of each Defender turn from round 2: secure territory pays.
  function roundIncome(s, ev) {
    if (!CONFIG.incomeBase && !CONFIG.ztPerSecureApp) return;
    const secure = secureApps(s);
    const hardened = INFRA_CELLS.filter((c) => s.hardened[c]).length;
    const insight = CONFIG.incomeBase + secure.length * CONFIG.incomePerSecureApp;
    const zt = secure.length * CONFIG.ztPerSecureApp + hardened * CONFIG.ztPerHardened;
    s.insight += insight;
    s.score += zt;
    s.ransomware = ransomedApps(s).length;
    ev.push({
      kind: 'income', text: 'Income: +' + insight + ' Insight, +' + zt + ' Zero Trust (' + secure.length + ' secure app' + (secure.length === 1 ? '' : 's') +
        ', ' + hardened + ' hardened service' + (hardened === 1 ? '' : 's') + ').',
    });
  }

  // ------------------------------------------------ legal moves, hidden info

  function legalAttackerActions(s) {
    const out = [];
    if (s.winner || s.turn !== 'attacker' || s.actionsLeft <= 0) return [{ type: 'endTurn' }];
    const hasStones = s.stonesLeft > 0;
    for (let c = 0; c < N; c++) {
      if (hasStones && canEnter(s, c)) {
        if (!s.breachUsed && isBreachable(c)) out.push({ type: 'breach', cell: c });
        if (adjacentToStone(s, c) && spreadCost(s, c) <= s.actionsLeft) out.push({ type: 'spread', cell: c });
      }
      const t = s.tokens[c];
      if (t && !t.faceUp && !t.recon && adjacentToStone(s, c)) out.push({ type: 'recon', cell: c });
      if (s.stones[c] && t && t.faceUp && t.type === 'jewel' && t.revealedRound !== s.round && groupHasExit(s, groupOf(s, c)))
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
    SIZE, N, CONFIG, DEFAULTS, applyConfig, LAYOUT, APPS, INFRA, REGION, EDGES, NEIGHBORS,
    APP_CELLS, INFRA_CELLS, APP_PAIRS,
    rowOf, colOf, cellName, cellIndex, isInfra, edgeKey, attackerJewelOdds, swapError,
    INFRA_CELL, INFRA_USERS, backdoorNeighbors, secureApps, ransomedApps,
    makeRng, shuffle, validateSetup, randomSetup, generateFlows, newGame, clone, exposedJewels,
    appBorderEdges, recommendedExceptions, isFlowActive, allowCost, isAllowOnly, crossExtra, linkExtra, spreadCost,
    isOpen, attackerNeighbors, canEnter, isExit, isBreachable, groupOf, allGroups,
    groupHasExit, adjacentToStone, wallError, wallableEdges, ringfenceCost, segmentCost,
    act, legalAttackerActions, attackerView,
  };
});
