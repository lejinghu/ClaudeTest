/*
 * A simple scripted Defender, used only by tools/sim.js to exercise the
 * attacker AI and get rough balance numbers. It knows where its own jewels
 * are (as the real Defender does) and plays a plain "respond to threats,
 * otherwise follow 1-2-3-4" script. It is deliberately not clever.
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

function tryAction(s, a) {
  const c = RF.clone(s);
  const res = RF.act(c, a);
  return res.ok ? c : null;
}

function candidateResponses(s) {
  const out = [];
  if (s.insight >= RF.CONFIG.hardenCost)
    RF.INFRA_CELLS.filter((c) => !s.hardened[c]).forEach((cell) => out.push({ type: 'harden', cell }));
  if (s.insight >= RF.CONFIG.segmentCost && s.wallsLeft > 0) {
    // Greedy pair: best single wall, then the best second wall given the first.
    const edges = RF.wallableEdges(s);
    let best1 = null;
    let bestT = -1;
    for (const k of edges) {
      const c = tryAction(s, { type: 'segment', edges: [k] });
      const t = c ? threat(c) : -1;
      if (t > bestT) { bestT = t; best1 = k; }
    }
    if (best1) {
      let best2 = null;
      let bestT2 = bestT;
      if (s.wallsLeft > 1) {
        for (const k of edges) {
          if (k === best1) continue;
          const c = tryAction(s, { type: 'segment', edges: [best1, k] });
          const t = c ? threat(c) : -1;
          if (t > bestT2) { bestT2 = t; best2 = k; }
        }
      }
      out.push({ type: 'segment', edges: best2 ? [best1, best2] : [best1] });
    }
  }
  Object.keys(RF.APPS).forEach((app) => {
    if (!s.fenced[app] && s.insight >= RF.ringfenceCost(app)) out.push({ type: 'ringfence', app });
  });
  if (s.insight >= RF.CONFIG.deployCost && s.pool.sensor > 0) {
    for (let c = 0; c < RF.N; c++) {
      if (!RF.isInfra(c) && !s.stones[c] && !s.tokens[c] && RF.adjacentToStone(s, c))
        out.push({ type: 'deploy', cell: c, kind: 'sensor' });
    }
  }
  return out;
}

function chooseAction(s) {
  if (s.actionsLeft <= 0) return { type: 'endTurn' };
  const T = threat(s);

  if (T <= 4) {
    let best = null;
    let bestT = T;
    let bestGain = -1;
    for (const a of candidateResponses(s)) {
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

  // Progress: 1-2-3-4, cheapest points first.
  const unhardened = RF.INFRA_CELLS.filter((c) => !s.hardened[c]);
  if (unhardened.length && s.insight >= RF.CONFIG.hardenCost) return { type: 'harden', cell: unhardened[0] };

  const jewelApps = new Set(
    Object.keys(s.tokens).filter((c) => s.tokens[c].type === 'jewel').map((c) => RF.REGION[c])
  );
  const fenceable = Object.keys(RF.APPS)
    .filter((a) => !s.fenced[a])
    .sort((a, b) => (jewelApps.has(b) - jewelApps.has(a)) || RF.ringfenceCost(a) - RF.ringfenceCost(b));
  const affordable = fenceable.find((a) => s.insight >= RF.ringfenceCost(a));
  if (affordable && jewelApps.has(affordable)) return { type: 'ringfence', app: affordable };

  if (!s.zoneSealed && s.insight >= RF.CONFIG.segmentCost) {
    const open = RF.ZONE_EDGES.filter((k) => !RF.wallError(s, k));
    if (open.length && open.length <= 4 && s.wallsLeft >= Math.min(2, open.length))
      return { type: 'segment', edges: open.slice(0, 2) };
  }
  if (affordable) return { type: 'ringfence', app: affordable };
  return { type: 'assess' };
}

module.exports = { chooseAction, threat };
