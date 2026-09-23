/*
 * A simple scripted Defender, used only by tools/sim.js to exercise the
 * attacker AI and get rough balance numbers. It knows where its own jewels
 * are (as the real Defender does) and plays a plain "respond to threats,
 * otherwise follow 1-2-3-4" script. It is deliberately not clever.
 *
 * Like a human, it only knows the business flows Security Intelligence has
 * shown it, so its lookahead never peeks at hidden flows.
 */
'use strict';
const RF = require('../js/rules.js');
const AI = require('../js/ai.js');

// Fewest attacker actions (stones + the exfil itself) to steal any real jewel,
// judged the way the attacker would see the board.
function threat(s) {
  const v = RF.attackerView(s);
  const bel = AI.beliefs(v);
  let best = Infinity;
  for (const c in s.tokens) {
    const t = s.tokens[c];
    if (t.type !== 'jewel') continue;
    const r = AI.pathToExit(v, bel, +c);
    if (r.cost < best) best = r.cost + 1;
  }
  return best;
}

// What the Defender can know: only the flows Security Intelligence revealed.
function known(s) {
  const c = RF.clone(s);
  const flows = {};
  for (const k in c.flows) if (c.discovered[k]) flows[k] = c.flows[k];
  c.flows = flows;
  return c;
}

function tryAction(s, a) {
  const c = known(s);
  const res = RF.act(c, a);
  return res.ok ? c : null;
}

function candidateResponses(s, canFence) {
  const out = [];
  if (s.insight >= RF.CONFIG.hardenCost)
    RF.INFRA_CELLS.filter((c) => !s.hardened[c]).forEach((cell) => out.push({ type: 'harden', cell }));
  if (s.insight >= RF.segmentCost(1) && s.wallsLeft > 0) {
    // Greedy: keep adding the wall that most delays the Attacker, while it
    // still helps and the Insight and wall supply allow. One action.
    const edges = RF.wallableEdges(s);
    const chosen = [];
    let current = -1;
    while (chosen.length < s.wallsLeft && s.insight >= RF.segmentCost(chosen.length + 1)) {
      let bestK = null;
      let bestT = current;
      for (const k of edges) {
        if (chosen.includes(k)) continue;
        const c = tryAction(s, { type: 'segment', edges: chosen.concat(k) });
        const t = c ? threat(c) : -1;
        if (t > bestT) { bestT = t; bestK = k; }
      }
      if (!bestK) break;
      chosen.push(bestK);
      current = bestT;
    }
    if (chosen.length) out.push({ type: 'segment', edges: chosen });
  }
  if (canFence) Object.keys(RF.APPS).forEach((app) => {
    // Ring-fence publishes the recommendation for known flows by itself.
    if (!s.fenced[app] && s.insight >= RF.ringfenceCost(app)) out.push({ type: 'ringfence', app });
  });
  if (s.insight >= RF.CONFIG.deployCost && s.pool.sensor > 0) {
    for (let c = 0; c < RF.N; c++) {
      if (!RF.isInfra(c) && !s.stones[c] && !s.tokens[c] && RF.adjacentToStone(s, c))
        out.push({ type: 'deploy', cell: c });
    }
  }
  // Isolate edges on the Attacker's route that walls can't cover (known
  // business flows, allowed exceptions): an outage beats losing the jewel.
  if (s.insight >= RF.CONFIG.isolateCost && s.wallsLeft > 0) {
    const t = AI.defenderThreat(s);
    if (t) for (let k = 0; k + 1 < t.path.length; k++) {
      const nb = RF.NEIGHBORS[t.path[k]].find((n) => n.cell === t.path[k + 1]);
      if (nb && RF.wallError(s, nb.key) && !s.walls[nb.key]) out.push({ type: 'isolate', edge: nb.key });
    }
  }
  return out.concat(swapCandidates(s));
}

// Real swaps of a jewel with a Sensor that the rules allow right now.
function swapCandidates(s) {
  const out = [];
  const cells = Object.keys(s.tokens).map(Number).filter((c) => !s.tokens[c].faceUp);
  for (const j of cells) {
    if (s.tokens[j].type !== 'jewel') continue;
    for (const k of cells) {
      if (s.tokens[k].type === 'sensor' && !RF.swapError(s, j, k)) out.push({ type: 'swap', a: j, b: k, really: true });
    }
  }
  return out;
}

// Swap a jewel away when the Attacker has scouted it or is closing in on it,
// if that makes the jewels clearly harder to reach.
// eager: swap whenever it gains any distance and the Attacker is within 6.
function swapIfWorthIt(s, T, eager) {
  const scouted = Object.keys(s.tokens).some((c) => s.tokens[c].recon && s.tokens[c].type === 'jewel');
  if (!scouted && T > (eager ? 6 : 5)) return null;
  let best = null;
  let bestT = eager ? T : T + 1; // normally must gain at least 2 actions of distance
  for (const a of swapCandidates(s)) {
    const c = tryAction(s, a);
    const t = c ? threat(c) : -1;
    if (t > bestT) { bestT = t; best = a; }
  }
  return best;
}

// patient: wait for one round of flow data before locking anything down.
function chooseAction(s, opts) {
  opts = opts || {};
  const patient = opts.patient !== false;
  const canFence = !patient || s.round >= RF.CONFIG.flowSeenRound;
  if (s.actionsLeft <= 0) return { type: 'endTurn' };
  const T = threat(s);

  const swap = swapIfWorthIt(s, T, opts.eagerSwap);
  if (swap) return swap;

  if (T <= 4) {
    let best = null;
    let bestT = T;
    let bestGain = -1;
    for (const a of candidateResponses(s, canFence)) {
      const c = tryAction(s, a);
      if (!c) continue;
      const t = threat(c);
      const gain = c.score - s.score;
      if (t > bestT || (t === bestT && best && gain > bestGain)) {
        best = a; bestT = t; bestGain = gain;
      }
    }
    if (best) return best;
    if (s.actionsLeft >= 2 || s.insight === 0) return { type: 'assess' };
  }

  // Newly observed flows that current policy blocks will break: allow them.
  for (const app of Object.keys(RF.APPS)) {
    if (s.fenced[app] && RF.recommendedExceptions(s, app).some((k) => !RF.isOpen(s, k)) && s.insight >= RF.CONFIG.allowCost)
      return { type: 'allow', app };
  }

  // Progress: 1-2-3-4, cheapest points first.
  const unhardened = RF.INFRA_CELLS.filter((c) => !s.hardened[c]);
  if (unhardened.length && s.insight >= RF.CONFIG.hardenCost) return { type: 'harden', cell: unhardened[0] };

  const jewelApps = new Set(
    Object.keys(s.tokens).filter((c) => s.tokens[c].type === 'jewel').map((c) => RF.REGION[c])
  );
  const fenceable = Object.keys(RF.APPS)
    .filter((a) => !s.fenced[a])
    .sort((a, b) => (jewelApps.has(b) - jewelApps.has(a)) || RF.ringfenceCost(a) - RF.ringfenceCost(b));
  const affordable = canFence ? fenceable.find((a) => s.insight >= RF.ringfenceCost(a)) : null;
  const lockDown = (app) => ({ type: 'ringfence', app });
  if (affordable && jewelApps.has(affordable)) return lockDown(affordable);

  if (affordable) return lockDown(affordable);
  return { type: 'assess' };
}

// The strategy a player falls into when segmentation is "free": ignore the
// Attacker and the flow data, harden infra, and ring-fence whatever is
// affordable, with no exceptions.
function mindless(s) {
  if (s.actionsLeft <= 0) return { type: 'endTurn' };
  const infra = RF.INFRA_CELLS.find((c) => !s.hardened[c]);
  if (infra != null && s.insight >= RF.CONFIG.hardenCost) return { type: 'harden', cell: infra };
  // A human always knows which apps hold their jewels, so those go first.
  const jewelApps = new Set(
    Object.keys(s.tokens).filter((c) => s.tokens[c].type === 'jewel').map((c) => RF.REGION[c])
  );
  const unfenced = Object.keys(RF.APPS).filter((a) => !s.fenced[a]);
  const wanted = unfenced.filter((a) => jewelApps.has(a)).concat(unfenced.filter((a) => !jewelApps.has(a)));
  const next = wanted[0];
  const app = next && s.insight >= RF.ringfenceCost(next) ? next : null;
  if (app) return { type: 'ringfence', app };
  return { type: 'assess' };
}

module.exports = { chooseAction, mindless, threat };
