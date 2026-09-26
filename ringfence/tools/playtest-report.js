#!/usr/bin/env node
/*
 * Summarise human playtest records downloaded from the prototype.
 *
 *   node ringfence/tools/playtest-report.js file1.json [file2.json ...]
 *
 * Accepts single-game files ("Download this game") and multi-game files
 * ("Download all playtests"). Duplicate games are counted once.
 */
'use strict';
const fs = require('fs');

const files = process.argv.slice(2);
if (!files.length) {
  console.error('Usage: node ringfence/tools/playtest-report.js <record.json> [...]');
  process.exit(1);
}

const byId = new Map();
for (const f of files) {
  const data = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const r of Array.isArray(data) ? data : [data]) {
    if (r && r.result) byId.set(r.startedAt + '|' + r.seed, r);
  }
}
const games = [...byId.values()];
if (!games.length) {
  console.log('No finished games found.');
  process.exit(0);
}

const pct = (n, d) => (d ? ((100 * n) / d).toFixed(0) + '%' : '–');
const median = (xs) => {
  if (!xs.length) return null;
  const a = xs.slice().sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const fmt = (x, digits = 1) => (x == null ? '–' : x.toFixed(digits));

function summary(label, list) {
  const wins = list.filter((g) => g.result.playerWon).length;
  const ratings = list.map((g) => g.rating).filter((r) => r != null);
  return [
    label.padEnd(17),
    String(list.length).padStart(5),
    pct(wins, list.length).padStart(10),
    fmt(mean(ratings)).padStart(8) + ` (${ratings.length})`,
    fmt(median(list.map((g) => g.result.durationMs / 60000))).padStart(9),
    fmt(median(list.map((g) => g.result.rounds)), 0).padStart(8),
    fmt(median(list.flatMap((g) => g.turnMs || []).map((ms) => ms / 1000)), 0).padStart(11),
    fmt(mean(list.map((g) => g.result.outages))).padStart(9),
  ].join('  ');
}

console.log(`RINGFENCE playtest report: ${games.length} game(s) from ${files.length} file(s)\n`);
console.log('Group              Games  Player wins  Fun (n)   Minutes  Rounds  Turn secs  Outages');
console.log(summary('All', games));
// v0.7 records say which side the human played; older ones are all Defender.
const roleOf = (g) => g.role || 'defender';
for (const role of ['defender', 'attacker']) {
  for (const level of ['easy', 'normal', 'hard']) {
    const list = games.filter((g) => roleOf(g) === role && g.level === level);
    if (list.length) console.log(summary((role === 'defender' ? 'Def vs AI ' : 'Atk vs bot ') + level, list));
  }
}
for (const rule of ['insight', 'score']) {
  const list = games.filter((g) => g.swapRule === rule);
  if (list.length && list.length !== games.length) console.log(summary('Swap: ' + rule, list));
}
const versions = [...new Set(games.map((g) => g.version))];
if (versions.length > 1) for (const v of versions) console.log(summary('Version ' + v, games.filter((g) => g.version === v)));

console.log('\nTargets (either side): player wins about 70% on Easy, 55-60% on Normal, 40-45% on Hard; about 5 minutes; fun at least 4.');

const ratings = games.map((g) => g.rating).filter((r) => r != null);
if (ratings.length) {
  const dist = [1, 2, 3, 4, 5].map((n) => `${n}: ${ratings.filter((r) => r === n).length}`).join('   ');
  console.log(`\nFun ratings  ${dist}`);
}

const mix = {};
let total = 0;
for (const g of games) if (roleOf(g) === 'defender') for (const a of g.actions) if (a.who === 'D') { mix[a.a] = (mix[a.a] || 0) + 1; total++; }
console.log('\nHuman Defender action mix (share of all their actions):');
Object.entries(mix).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`  ${k.padEnd(10)} ${pct(n, total).padStart(4)}  (${n})`));
console.log('  An action under 5% or over 40% is worth a look: it may be useless or dominant.');

const losses = {};
for (const g of games) if (!g.result.playerWon && roleOf(g) === 'defender') {
  const last = [...g.actions].reverse().find((a) => a.who === 'A' && a.a === 'exfil');
  const key = last ? 'jewel stolen (' + last.cell + ')' : g.result.reason;
  losses[key] = (losses[key] || 0) + 1;
}
if (Object.keys(losses).length) {
  console.log('\nHow Defender players lost:');
  Object.entries(losses).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`  ${String(n).padStart(3)}  ${k}`));
}

const comments = games.filter((g) => g.comment);
if (comments.length) {
  console.log('\nComments:');
  comments.forEach((g) => console.log(`  [${g.rating ?? '-'}/5, ${roleOf(g)} ${g.level}, ${g.result.playerWon ? 'won' : 'lost'}] ${g.comment}`));
}
