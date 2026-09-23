/*
 * RINGFENCE attacker AI.
 *
 * The AI never reads hidden information. It works on RF.attackerView(state),
 * where face-down tokens are 'unknown' unless revealed or seen by Recon, and
 * reasons about them with probabilities:
 *
 *   - Public odds from the rules engine (RF.attackerJewelOdds): Recon results,
 *     Sensors deployed in plain sight, and swaps that may or may not have
 *     happened (which average the two tokens' odds).
 *
 * Levels: Easy and Normal pick one action at a time by expected value
 * (Normal also scouts likely Sensors before stepping on them); Hard searches
 * two actions ahead within its turn. The evaluation asks,
 * for every possible jewel, "how many stones would I still need to place to
 * sit on it with a connected route to an exit?" (a node-weighted shortest
 * path where my own stones are free and unknown tokens carry sensor risk),
 * and "how bad does that get if the Defender cuts the weakest link?".
 */
(function (root, factory) {
  const AI = factory(root.RF || (typeof require === 'function' ? require('./rules.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = AI;
  else root.RFAI = AI;
})(typeof self !== 'undefined' ? self : this, function (RF) {
  'use strict';

  const INF = 1e9;

  const LEVELS = {
    // actions: the Attacker's actions per turn at this difficulty.
    easy: { noise: 30, robust: false, recon: false, reconThreshold: 1, depth: 1, actions: 3 },
    normal: { noise: 1.5, robust: true, recon: true, reconThreshold: 0.3, depth: 1, actions: 4 },
    // Hard searches two actions ahead within its turn (expectimax over what
    // a face-down token might be), so Recon is valued for what it reveals.
    hard: { noise: 0.5, robust: true, recon: false, reconThreshold: 1, depth: 2, beam: 6, actions: 4 },
  };

  const W = {
    near: 300, // value of a sure jewel at distance 0, scaled by 1/(1+d)
    robust: 150, // same, for the distance after the Defender's best single cut
    sensorRisk: 3, // extra "actions" an unknown-but-certain sensor costs on a path
    lostAction: 18, // value of each action lost when a Sensor ends the turn
    stone: 1, // small cost per stone, so it doesn't sprawl for nothing
    pass: 4, // penalty for ending the turn with actions left
  };

  // --------------------------------------------------------------- beliefs

  // Jewel/Sensor odds for every face-down token, from the public bookkeeping
  // in the rules engine (Recon results, deploys, possible swaps).
  function beliefs(v) {
    const odds = RF.attackerJewelOdds(v);
    const bel = {};
    for (const c in v.tokens) {
      const t = v.tokens[c];
      let pJ;
      if (t.faceUp || t.type === 'jewel') pJ = t.type === 'jewel' ? 1 : 0;
      else if (t.type === 'sensor') pJ = 0;
      else pJ = odds[c] || 0;
      bel[c] = { pJ, pS: 1 - pJ };
    }
    return bel;
  }

  // ----------------------------------------------------------------- paths

  // Cheapest set of cells to occupy so that `target` holds a stone connected
  // to an exit. Returns { cost, path } (path runs target → exit).
  function pathToExit(v, bel, target, extra) {
    extra = extra || {};
    const hard = (i) => !!(v.hardened[i] || (extra.hardened && extra.hardened[i]));
    const nodeCost = (i) => {
      if (v.stones[i]) return 0;
      if (RF.isInfra(i) && hard(i)) return INF;
      const b = bel[i];
      return 1 + (b && i !== target ? b.pS * W.sensorRisk : 0);
    };
    const isExit = (i) => RF.rowOf(i) === 0 || RF.REGION[i] === 'H' || (RF.isInfra(i) && !hard(i));

    const dist = new Array(RF.N).fill(INF);
    const prev = new Array(RF.N).fill(-1);
    const done = new Array(RF.N).fill(false);
    dist[target] = nodeCost(target);
    if (dist[target] >= INF) return { cost: INF, path: [] };
    for (;;) {
      let u = -1;
      for (let i = 0; i < RF.N; i++) if (!done[i] && dist[i] < INF && (u < 0 || dist[i] < dist[u])) u = i;
      if (u < 0) return { cost: INF, path: [] };
      if (isExit(u)) {
        const path = [];
        for (let x = u; x >= 0; x = prev[x]) path.push(x);
        return { cost: dist[u], path: path.reverse() };
      }
      done[u] = true;
      for (const w of RF.attackerNeighbors(v, u, extra)) {
        if (done[w]) continue;
        // Exploiting an allowed service costs extra actions to cross.
        const nb = !v.stones[w] && RF.NEIGHBORS[u].find((n) => n.cell === w);
        const d = dist[u] + nodeCost(w) + (nb ? RF.crossExtra(v, nb.key) : 0);
        if (d < dist[w]) {
          dist[w] = d;
          prev[w] = u;
        }
      }
    }
  }

  // Distance after the Defender's most damaging single response on this
  // path: one wall on a wallable edge, or hardening an infra cell used.
  function worstCut(v, bel, target, path, base) {
    let worst = base;
    for (let k = 0; k + 1 < path.length; k++) {
      const a = path[k];
      const b = path[k + 1];
      const nb = RF.NEIGHBORS[a].find((n) => n.cell === b);
      if (nb && !RF.wallError(v, nb.key)) {
        const r = pathToExit(v, bel, target, { walls: { [nb.key]: true } });
        if (r.cost > worst) worst = r.cost;
      }
    }
    for (const c of path) {
      if (RF.isInfra(c) && !v.hardened[c]) {
        const r = pathToExit(v, bel, target, { hardened: { [c]: true } });
        if (r.cost > worst) worst = r.cost;
      }
    }
    return worst;
  }

  // ------------------------------------------------------------ evaluation

  function evaluate(v, level) {
    if (v.jewelsTaken >= RF.CONFIG.jewelsToWin) return 1e6;
    const bel = beliefs(v);
    const items = [];
    for (const c in v.tokens) {
      const b = bel[c];
      if (b.pJ <= 0) continue;
      const cell = +c;
      const r = pathToExit(v, bel, cell);
      items.push({ cell, p: b.pJ, r, val: r.cost >= INF ? 0 : (b.pJ * W.near) / (1 + r.cost) });
    }
    items.sort((x, y) => y.val - x.val);
    const weights = [1, 0.6, 0.3, 0.15, 0.1, 0.05];
    let sum = 0;
    items.forEach((it, n) => {
      let val = it.val;
      if (level.robust && n < 2 && it.r.cost < INF) {
        const dc = worstCut(v, bel, it.cell, it.r.path, it.r.cost);
        val += dc >= INF ? 0 : (it.p * W.robust) / (1 + dc);
      }
      sum += val * (weights[n] || 0.05);
    });
    const stones = v.stones.reduce((a, b) => a + b, 0);
    return v.jewelsTaken * 1000 + sum - W.stone * stones;
  }

  // Possible results of an action as seen by the Attacker:
  // [{ p, state, penalty }]. Entering or scouting an unknown token branches
  // on what it might turn out to be.
  function outcomes(v, bel, a) {
    const branch = (forcedType) => {
      const c = RF.clone(v);
      if (forcedType) c.tokens[a.cell].type = forcedType;
      const res = RF.act(c, a);
      if (!res.ok) return null;
      const triggered = res.events.some((e) => e.kind === 'sensor');
      return { state: c, penalty: triggered ? W.lostAction * Math.max(0, v.actionsLeft - 1) : 0 };
    };
    const t = a.cell != null ? v.tokens[a.cell] : null;
    const hidden = t && !t.faceUp && t.type === 'unknown' &&
      (a.type === 'breach' || a.type === 'spread' || a.type === 'recon');
    if (!hidden) {
      const o = branch(null);
      return o ? [Object.assign({ p: 1 }, o)] : [];
    }
    const b = bel[a.cell];
    const out = [];
    [['jewel', b.pJ], ['sensor', b.pS]].forEach(([type, p]) => {
      if (p <= 0) return;
      const o = branch(type);
      if (o) out.push(Object.assign({ p }, o));
    });
    return out;
  }

  function actionValue(v, bel, a, level) {
    switch (a.type) {
      case 'exfil':
        return 1e7;
      case 'endTurn':
        return evaluate(v, level) - (v.actionsLeft > 0 ? W.pass : 0);
      case 'recon':
        // At depth 1 Recon's worth is purely informational, so by value it's
        // slightly worse than doing nothing; the policy decides when to use it.
        return evaluate(v, level) - W.pass - 1;
    }
    let ev = 0;
    for (const o of outcomes(v, bel, a)) ev += o.p * (evaluate(o.state, level) - o.penalty);
    return ev;
  }

  // Expectimax within the Attacker's own turn.
  function searchValue(v, bel, a, level, depth) {
    if (depth <= 1 || a.type === 'endTurn' || a.type === 'exfil') return actionValue(v, bel, a, level);
    let ev = 0;
    for (const o of outcomes(v, bel, a)) {
      const s2 = o.state;
      let val;
      if (s2.winner || s2.actionsLeft <= 0) val = evaluate(s2, level);
      else val = bestFollowUp(s2, level, depth - 1);
      ev += o.p * (val - o.penalty);
    }
    return ev;
  }

  function bestFollowUp(v, level, depth) {
    const bel = beliefs(v);
    const legal = RF.legalAttackerActions(v);
    if (legal.some((a) => a.type === 'exfil')) return actionValue(v, bel, { type: 'exfil' }, level);
    // Always evaluate at least "stop here" so a bad follow-up is never forced.
    let best = evaluate(v, level);
    const scored = legal
      .filter((a) => a.type !== 'endTurn')
      .map((a) => ({ a, val: a.type === 'recon' ? Infinity : actionValue(v, bel, a, level) }))
      .sort((x, y) => y.val - x.val)
      .slice(0, level.beam || 6);
    for (const { a, val } of scored) {
      const sv = depth > 1 || a.type === 'recon' ? searchValue(v, bel, a, level, Math.max(depth, 2)) : val;
      if (sv > best) best = sv;
    }
    return best;
  }

  // ---------------------------------------------------------------- policy

  /**
   * Pick the Attacker's next action.
   * @param state  full game state (only the attacker view is used)
   * @param opts   { level: 'easy'|'normal', rng: () => number }
   * @returns { action, note }
   */
  function chooseAction(state, opts) {
    opts = opts || {};
    const level = LEVELS[opts.level] || LEVELS.normal;
    const rng = opts.rng || Math.random;
    const v = RF.attackerView(state);
    const legal = RF.legalAttackerActions(v);

    const exfil = legal.find((a) => a.type === 'exfil');
    if (exfil) return { action: exfil, note: 'Route to an exit is open: exfiltrate.' };

    const bel = beliefs(v);
    let best = null;
    let bestVal = -Infinity;
    let pool = legal.map((a) => ({ a, val: actionValue(v, bel, a, level) }));
    if (level.depth > 1 && v.actionsLeft > 1) {
      // Search the most promising actions (and every Recon) one step deeper.
      pool.sort((x, y) => y.val - x.val);
      const deep = pool.filter((x, n) => n < level.beam || x.a.type === 'recon');
      pool = deep.map((x) => ({ a: x.a, val: searchValue(v, bel, x.a, level, level.depth) }));
    }
    for (const { a, val: raw } of pool) {
      const val = raw + (rng() - 0.5) * level.noise;
      if (val > bestVal) {
        bestVal = val;
        best = a;
      }
    }

    // Scout before stepping onto a token that is likely a Sensor, if there's
    // still an action left afterwards to use what we learn.
    if (level.recon && best && (best.type === 'spread' || best.type === 'breach')) {
      const t = v.tokens[best.cell];
      const b = bel[best.cell];
      if (t && t.type === 'unknown' && b.pS >= level.reconThreshold && v.actionsLeft >= 2) {
        const recon = legal.find((a) => a.type === 'recon' && a.cell === best.cell);
        if (recon) return { action: recon, note: noteFor(v, bel, 'Scouting ' + RF.cellName(best.cell) + ' first (sensor risk ' + pct(b.pS) + ').') };
      }
    }
    return { action: best, note: noteFor(v, bel) };
  }

  function noteFor(v, bel, prefix) {
    let bestC = null;
    let bestVal = -1;
    let bestCost = INF;
    for (const c in v.tokens) {
      const b = bel[c];
      if (b.pJ <= 0) continue;
      const r = pathToExit(v, bel, +c);
      const val = r.cost >= INF ? 0 : b.pJ / (1 + r.cost);
      if (val > bestVal) {
        bestVal = val;
        bestC = +c;
        bestCost = r.cost;
      }
    }
    const tgt = bestC == null
      ? 'No reachable jewel candidates.'
      : 'Main target ' + RF.cellName(bestC) + ' (jewel chance ' + pct(bel[bestC].pJ) + ', ~' +
        (bestCost >= INF ? '∞' : Math.round(bestCost)) + ' stones from exfil).';
    return (prefix ? prefix + ' ' : '') + tgt;
  }

  const pct = (p) => Math.round(p * 100) + '%';

  // ------------------------------------------------ Defender-side analysis

  // The state as the Defender can know it: only flows Security Intelligence
  // has revealed. Used to preview a response without peeking at hidden flows.
  function defenderKnown(s) {
    const c = RF.clone(s);
    const flows = {};
    for (const k in c.flows) if (c.discovered[k]) flows[k] = c.flows[k];
    c.flows = flows;
    return c;
  }

  // The Attacker's quickest way to steal one of the Defender's real jewels,
  // judged from what the Attacker can know:
  //   { cell, actions, path, revealed, nextTurn }
  // actions = stones still to place (including exploit costs) + the Exfil.
  // nextTurn = it could steal it on its very next turn. A jewel it hasn't
  // revealed yet can't be stolen before the turn after, because staging the
  // data takes a turn.
  function defenderThreat(s) {
    if (!s || s.winner) return null;
    const v = RF.attackerView(s);
    const bel = beliefs(v);
    let best = null;
    for (const c in s.tokens) {
      const t = s.tokens[c];
      if (t.type !== 'jewel') continue;
      const r = pathToExit(v, bel, +c);
      if (r.cost >= INF) continue;
      const actions = Math.ceil(r.cost - 1e-9) + 1;
      const revealed = !!t.faceUp;
      const nextTurn = revealed && actions <= RF.CONFIG.attackerActions;
      // Rank: can it steal next turn, then fewest actions (unrevealed jewels
      // need an extra turn to stage).
      const rank = actions + (revealed ? 0 : RF.CONFIG.attackerActions);
      if (!best || rank < best.rank) best = { cell: +c, actions, path: r.path, revealed, nextTurn, rank };
    }
    return best;
  }

  // Candidate Defender responses to the current threat, each previewed on the
  // Defender-known state: [{ label, action, gain }], best first.
  function suggestResponses(s) {
    const t = defenderThreat(s);
    if (!t || s.turn !== 'defender' || s.actionsLeft <= 0) return [];
    const cands = [];
    const path = t.path;
    for (let k = 0; k + 1 < path.length; k++) {
      const nb = RF.NEIGHBORS[path[k]].find((n) => n.cell === path[k + 1]);
      if (!nb) continue; // hub hop, not an edge
      const e = RF.EDGES[nb.key];
      const name = RF.cellName(e.a) + '–' + RF.cellName(e.b);
      if (!RF.wallError(s, nb.key)) cands.push({ label: 'Segment: wall ' + name, action: { type: 'segment', edges: [nb.key] } });
      else if (!s.walls[nb.key]) {
        const flow = s.discovered[nb.key];
        cands.push({ label: 'Isolate ' + name + (flow ? ' (breaks a business flow: −' + RF.CONFIG.outagePenalty + ' score)' : ''), action: { type: 'isolate', edge: nb.key } });
      }
    }
    for (const c of path) {
      if (RF.isInfra(c) && !s.hardened[c]) cands.push({ label: 'Harden ' + RF.REGION[c], action: { type: 'harden', cell: c } });
      if (!s.stones[c] && !s.tokens[c] && !RF.isInfra(c) && s.pool.sensor > 0)
        cands.push({ label: 'Deploy a Sensor on ' + RF.cellName(c), action: { type: 'deploy', cell: c } });
    }
    const jt = s.tokens[t.cell];
    if (jt && !jt.faceUp) {
      for (const c in s.tokens) {
        if (s.tokens[c].type === 'sensor' && !RF.swapError(s, t.cell, +c)) {
          cands.push({ label: 'Swap the jewel on ' + RF.cellName(t.cell) + ' with the Sensor on ' + RF.cellName(+c), action: { type: 'swap', a: t.cell, b: +c, really: true } });
        }
      }
    }
    const baseRank = t.rank;
    const out = [];
    const seen = new Set();
    for (const cand of cands) {
      if (seen.has(cand.label)) continue;
      seen.add(cand.label);
      const c = defenderKnown(s);
      if (!RF.act(c, cand.action).ok) continue;
      const nt = defenderThreat(c);
      const gain = nt ? nt.rank - baseRank : 99;
      // What it costs: Score lost (outages) and Insight spent.
      const scoreDelta = c.score - s.score;
      const spent = s.insight - c.insight;
      if (gain > 0) out.push(Object.assign(cand, { gain, after: nt, scoreDelta, spent }));
    }
    // Stopping the route matters most; among options that do about as much,
    // prefer the one that costs no Score, then the one that costs less Insight.
    const tier = (g) => (g >= 50 ? 3 : g >= RF.CONFIG.attackerActions ? 2 : 1);
    out.sort((x, y) => tier(y.gain) - tier(x.gain) || y.scoreDelta - x.scoreDelta || x.spent - y.spent || y.gain - x.gain);
    return out;
  }

  return { chooseAction, evaluate, beliefs, pathToExit, worstCut, defenderKnown, defenderThreat, suggestResponses, LEVELS, WEIGHTS: W };
});
