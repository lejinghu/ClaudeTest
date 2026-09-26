/*
 * Scripted Defenders for tools/sim.js (v0.6 territory rules). They know where
 * their own jewels are, as a human does, but only the business flows
 * Security Intelligence has shown them.
 *
 * Strategies, so the simulator can check that more than one plan works:
 *   careful   observe → harden the jewels' services → fence jewel apps →
 *             expand territory; answer threats with Isolate / Harden / Sensor
 *   territory fence as much (observed) territory as fast as possible
 *   fortress  jewel apps and all services only, then Sensors
 *   infra     harden every service first, then careful
 *   hasty     careful, but fences without observing first
 *   mindless  harden and fence whatever is affordable; never observes, never responds
 */
'use strict';
const RF = require('../js/rules.js');
const AI = require('../js/ai.js');

const apps = () => Object.keys(RF.APPS);
const jewelApps = (s) => [...new Set(Object.keys(s.tokens).filter((c) => s.tokens[c].type === 'jewel').map((c) => RF.REGION[c]))];
const hasStones = (s, app) => RF.APP_CELLS[app].some((c) => s.stones[c]);
const mapped = (s, app) => s.observed[app] === -1; // flows revealed
const size = (app) => RF.ringfenceCost(app);
const act = (s, a) => { const c = AI.defenderKnown(s); return RF.act(c, a).ok ? c : null; };

// Lower = more dangerous. Combines the jewel threat and the ransomware threat.
function danger(s) {
  const t = AI.defenderThreat(s);
  const r = AI.ransomThreat(s);
  const jewel = t ? t.rank : 99;
  const ransom = r.danger ? RF.CONFIG.attackerActions : 99;
  return Math.min(jewel, ransom);
}

function responses(s) {
  const out = [];
  const t = AI.defenderThreat(s);
  const cells = new Set(t ? t.path : []);
  // Backdoors into fenced apps and on the jewel route.
  RF.INFRA_CELLS.forEach((c) => { if (!s.hardened[c]) out.push({ type: 'harden', cell: c }); });
  if (t) {
    for (let k = 0; k + 1 < t.path.length; k++) {
      const nb = RF.NEIGHBORS[t.path[k]].find((n) => n.cell === t.path[k + 1]);
      if (nb && !s.walls[nb.key]) out.push({ type: 'isolate', edge: nb.key });
    }
  }
  // Allowed flows into fenced apps next to attacker stones.
  Object.keys(s.allows).forEach((k) => {
    const e = RF.EDGES[k];
    if (!s.walls[k] && (s.stones[e.a] || s.stones[e.b])) out.push({ type: 'isolate', edge: k });
  });
  for (let c = 0; c < RF.N; c++) {
    if ((cells.has(c) || RF.adjacentToStone(s, c)) && !RF.isInfra(c) && !s.stones[c] && !s.tokens[c]) out.push({ type: 'deploy', cell: c });
  }
  return out;
}

function respond(s) {
  const base = danger(s);
  if (base > RF.CONFIG.attackerActions + 1) return null;
  let best = null;
  let bestD = base;
  let bestCost = Infinity;
  for (const a of responses(s)) {
    const c = act(s, a);
    if (!c) continue;
    const d = danger(c);
    const cost = (s.score - c.score) * 3 + (s.insight - c.insight);
    if (d > bestD || (d === bestD && best && cost < bestCost)) { best = a; bestD = d; bestCost = cost; }
  }
  return best;
}

function plan(s, strategy) {
  const J = jewelApps(s);
  const afford = (n) => s.insight >= n;
  const observe = (list) => list.find((a) => s.observed[a] == null && afford(RF.CONFIG.observeCost));
  const fenceable = (list, needMap) => list.filter((a) => !s.fenced[a] && !hasStones(s, a) && (!needMap || mapped(s, a)) && afford(size(a)));
  const depsHard = (a) => RF.APPS[a].uses.every((svc) => s.hardened[RF.INFRA_CELL[svc]]);
  const hardenFor = (list) => {
    const svcs = [...new Set(list.flatMap((a) => RF.APPS[a].uses))].map((x) => RF.INFRA_CELL[x]).filter((c) => !s.hardened[c]);
    return afford(RF.CONFIG.hardenCost) && svcs.length ? { type: 'harden', cell: svcs[0] } : null;
  };
  const needMap = strategy !== 'hasty' && strategy !== 'mindless';
  const others = apps().filter((a) => !J.includes(a)).sort((a, b) => size(a) - size(b));

  if (strategy === 'mindless') {
    const h = hardenFor(apps());
    if (h) return h;
    const f = fenceable(J.concat(others), false)[0];
    return f ? { type: 'ringfence', app: f } : { type: 'endTurn' };
  }
  if (strategy === 'infra') { const h = hardenFor(apps()); if (h) return h; }
  if (needMap) { const o = observe(J); if (o) return { type: 'observe', app: o }; }
  if (strategy !== 'territory') { const h = hardenFor(J); if (h) return h; }
  const fj = fenceable(J, needMap)[0];
  if (fj && strategy !== 'territory') return { type: 'ringfence', app: fj };
  if (strategy === 'fortress') {
    const h = hardenFor(apps());
    if (h) return h;
    const t = AI.defenderThreat(s);
    if (t && afford(RF.CONFIG.deployCost) && s.pool.sensor > 0) {
      const c = t.path.find((x) => !RF.isInfra(x) && !s.stones[x] && !s.tokens[x]);
      if (c != null) return { type: 'deploy', cell: c };
    }
    return { type: 'endTurn' };
  }
  // Territory: observe and fence other apps, preferring ones whose services are hardened.
  const list = strategy === 'territory' ? J.concat(others).sort((a, b) => size(b) - size(a)) : others;
  const f = fenceable(list, needMap).sort((a, b) => depsHard(b) - depsHard(a))[0];
  if (f) return { type: 'ringfence', app: f };
  if (needMap && Object.values(s.observed).filter((r) => r >= 0).length < 2) { const o = observe(list); if (o) return { type: 'observe', app: o }; }
  const h = hardenFor(apps());
  if (h) return h;
  return { type: 'endTurn' }; // save Insight for next turn
}

function chooseAction(s, opts) {
  opts = opts || {};
  const strategy = opts.strategy || 'careful';
  if (s.actionsLeft <= 0) return { type: 'endTurn' };
  if (strategy !== 'mindless') {
    const r = respond(s);
    if (r) return r;
  }
  return plan(s, strategy);
}

const mindless = (s) => chooseAction(s, { strategy: 'mindless' });

module.exports = { chooseAction, mindless, danger };
