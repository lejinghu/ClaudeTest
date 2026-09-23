#!/usr/bin/env node
/*
 * Headless RINGFENCE simulator.
 *
 *   node ringfence/tools/sim.js [games=100] [level=easy|normal|hard] [--fuzz]
 *
 * Plays the scripted Defender bot against the attacker AI and prints win
 * rates, game length and action mix. --fuzz also plays random-vs-random
 * games and checks engine invariants.
 */
'use strict';
const RF = require('../js/rules.js');
const AI = require('../js/ai.js');
const Bot = require('./defender-bot.js');

const args = process.argv.slice(2);
const games = parseInt(args.find((a) => /^\d+$/.test(a)) || '100', 10);
const level = args.find((a) => a === 'easy' || a === 'normal' || a === 'hard') || 'normal';
const fuzz = args.includes('--fuzz');

function checkInvariants(s) {
  const onBoard = s.stones.reduce((a, b) => a + b, 0);
  if (onBoard + s.stonesLeft !== RF.CONFIG.stones) throw new Error('stone count drift');
  if (Object.keys(s.walls).length + s.wallsLeft !== RF.CONFIG.walls) throw new Error('wall count drift');
  if (s.insight < 0) throw new Error('negative insight');
  if (s.actionsLeft < 0) throw new Error('negative actions');
  for (const c of RF.INFRA_CELLS) if (s.hardened[c] && s.stones[c]) throw new Error('stone on hardened infra');
  for (const c in s.tokens) {
    const t = s.tokens[c];
    if (s.stones[c] && !(t.faceUp && t.type === 'jewel')) throw new Error('stone on hidden token ' + RF.cellName(+c));
  }
}

function playGame(seed, defenderPick, attackerPick) {
  const rng = RF.makeRng(seed);
  const s = RF.newGame(RF.randomSetup(rng));
  const counts = {};
  let guard = 0;
  while (!s.winner) {
    if (++guard > 5000) throw new Error('game did not terminate (seed ' + seed + ')');
    const a = s.turn === 'defender' ? defenderPick(s, rng) : attackerPick(s, rng);
    const key = a.type === 'endTurn' ? 'endTurn' : s.turn + ':' + a.type;
    const res = RF.act(s, a);
    if (!res.ok) throw new Error(s.turn + ' chose illegal ' + JSON.stringify(a) + ': ' + res.error);
    counts[key] = (counts[key] || 0) + 1;
    if (s.turn === 'attacker' && s.actionsLeft === 0 && !s.winner && a.type !== 'endTurn') RF.act(s, { type: 'endTurn' });
    checkInvariants(s);
  }
  return { s, counts };
}

const aiAttacker = (s, rng) => AI.chooseAction(s, { level, rng }).action;
const botDefender = (s) => Bot.chooseAction(s);

function randomAttacker(s, rng) {
  const legal = RF.legalAttackerActions(s);
  return legal[Math.floor(rng() * legal.length)];
}
function randomDefender(s, rng) {
  if (s.actionsLeft <= 0 || rng() < 0.05) return { type: 'endTurn' };
  const opts = [{ type: 'assess' }];
  RF.INFRA_CELLS.forEach((cell) => opts.push({ type: 'harden', cell }));
  const edges = RF.wallableEdges(s);
  if (edges.length) opts.push({ type: 'segment', edges: [edges[Math.floor(rng() * edges.length)]] });
  Object.keys(RF.APPS).forEach((app) => opts.push({ type: 'ringfence', app }));
  opts.push({ type: 'deploy', cell: Math.floor(rng() * RF.N), kind: rng() < 0.5 ? 'sensor' : 'decoy' });
  const legal = opts.filter((a) => RF.act(RF.clone(s), a).ok);
  return legal[Math.floor(rng() * legal.length)];
}

if (fuzz) {
  for (let i = 0; i < 300; i++) playGame('fuzz' + i, randomDefender, randomAttacker);
  console.log('fuzz: 300 random games OK');
}

const t0 = Date.now();
let attackerWins = 0;
const rounds = [];
const reasons = {};
const mix = {};
for (let i = 0; i < games; i++) {
  const { s, counts } = playGame('g' + i, botDefender, aiAttacker);
  if (s.winner === 'attacker') attackerWins++;
  rounds.push(Math.min(s.round, RF.CONFIG.roundLimit));
  const r = s.winner + ': ' + s.reason.replace(/\d+/g, 'N');
  reasons[r] = (reasons[r] || 0) + 1;
  for (const k in counts) mix[k] = (mix[k] || 0) + counts[k];
}
rounds.sort((a, b) => a - b);
console.log(`${games} games, bot Defender vs ${level} AI Attacker (${((Date.now() - t0) / games).toFixed(0)} ms/game)`);
console.log(`Attacker win rate: ${((100 * attackerWins) / games).toFixed(1)}%`);
console.log(`Median round at game end: ${rounds[Math.floor(games / 2)]}`);
console.log('Outcomes:');
Object.entries(reasons).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`  ${n.toString().padStart(4)}  ${k}`));
console.log('Action mix:');
Object.entries(mix).sort().forEach(([k, n]) => console.log(`  ${k.padEnd(20)} ${n}`));
