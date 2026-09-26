/*
 * RINGFENCE browser UI. Play the Defender against the AI Attacker, or the
 * Attacker against the vDefend Defender bot.
 * Renders the board as inline SVG and drives turns through RF.act().
 * After editing, rebuild the standalone page: node ringfence/tools/build.js
 */
(function () {
  'use strict';
  const RF = window.RF;
  const AI = window.RFAI;
  const BOT = window.RFBOT;
  const PIX = window.RFPIX;
  const SND = window.RFSOUND || { play() {}, unlock() {}, setMuted() {}, setMusic() {} };
  const $ = (id) => document.getElementById(id);
  const SVGNS = 'http://www.w3.org/2000/svg';

  // Board geometry (SVG user units).
  const CS = 64;
  const ML = 28;
  const MT = 46;
  const W = ML + RF.SIZE * CS + 10;
  const H = MT + RF.SIZE * CS + 10;
  const cx = (i) => ML + RF.colOf(i) * CS;
  const cy = (i) => MT + RF.rowOf(i) * CS;

  // ------------------------------------------------------------ settings

  const params = new URLSearchParams(location.search);
  const VERSION = 'v0.7';
  const settings = { role: 'defender', level: 'normal', speed: '600', reasoning: false, swapRule: 'insight', showThreat: true, muted: false, music: true };
  try {
    Object.assign(settings, JSON.parse(localStorage.getItem('ringfence.settings') || '{}'));
  } catch (e) { /* storage unavailable: defaults are fine */ }
  if (AI.LEVELS[params.get('ai')]) settings.level = params.get('ai');
  if (params.get('role') === 'attacker' || params.get('role') === 'defender') settings.role = params.get('role');

  // When you play the Attacker, the difficulty picks the Defender bot's
  // playbook. The AI Attacker wins about 55% / 37% / 23% against these
  // (node ringfence/tools/sim.js 200 normal --strategy=...).
  const BOT_LEVELS = {
    easy: { strategy: 'territory', config: {}, name: 'Rookie admin', blurb: 'fences lots of apps, but forgets its jewels' },
    normal: { strategy: 'careful', config: {}, name: 'vDefend team', blurb: 'follows the DFW 1-2-3-4 playbook' },
    hard: { strategy: 'careful', config: { startInsight: 6 }, name: 'vDefend + SSP pros', blurb: 'the playbook, with a bigger budget' },
  };
  const DEF_LEVELS = {
    easy: { name: 'Script kiddie', blurb: 'wanders around' },
    normal: { name: 'Ransomware crew', blurb: 'goes for your jewels and your apps' },
    hard: { name: 'APT', blurb: 'plans ahead and scouts' },
  };
  const isAtk = () => settings.role === 'attacker';
  const saveSettings = () => {
    try { localStorage.setItem('ringfence.settings', JSON.stringify(settings)); } catch (e) { /* ignore */ }
  };

  const seedStr = params.get('seed') || String(Date.now());
  let rng = RF.makeRng(seedStr);

  // Two swap cost rules are being playtested (design doc Section 11).
  const SWAP_RULES = {
    insight: { swapCost: 3, swapScorePenalty: 0, swapsPerGame: 2, label: '3 Insight, max 2 per game' },
    score: { swapCost: 0, swapScorePenalty: 1, swapsPerGame: 99, label: '−1 score each, no limit' },
  };
  if (SWAP_RULES[params.get('swap')]) settings.swapRule = params.get('swap');
  function applySwapRule() {
    const r = SWAP_RULES[settings.swapRule] || SWAP_RULES.insight;
    RF.CONFIG.swapCost = r.swapCost;
    RF.CONFIG.swapScorePenalty = r.swapScorePenalty;
    RF.CONFIG.swapsPerGame = r.swapsPerGame;
  }

  // --------------------------------------------------------------- state

  const ui = {
    phase: 'setup', // setup | play | over
    setup: null,
    state: null,
    mode: null, // harden | segment | allow | ringfence | deploy | swap
    pending: [],
    draft: null, // allow: { app, edges: Set } · ringfence: { app } · swap: { a, b }
    undo: [],
    log: [],
    recent: new Set(),
    fresh: -1,
    busy: false,
    selected: null,
    stats: null,
    record: null, // playtest record for the current game
    turnStart: 0,
    role: 'defender', // the side the human plays in the current game
    amode: 'move', // Attacker role: move | recon | exfil
    hint: null, // Attacker role: the suggested action
  };

  function newStats() {
    return { observe: 0, assess: 0, harden: 0, segment: 0, walls: 0, allow: 0, ringfence: 0, deploy: 0, swap: 0, isolate: 0, sensorHits: 0, quarantines: 0, recons: 0, outages: 0,
      breach: 0, spread: 0, jewelsFound: 0, evicted: 0, maxBlast: 0 };
  }

  // The title screen: pick a side and a difficulty.
  function showTitle() {
    ui.phase = 'title';
    ui.state = null;
    ui.busy = false;
    hide('overlay-end');
    renderTitle();
    show('overlay-title');
    render();
  }

  function renderTitle() {
    document.querySelectorAll('#title-level [data-level]').forEach((b) => b.classList.toggle('sel', b.dataset.level === settings.level));
    document.querySelectorAll('#title-roles [data-role]').forEach((b) => b.classList.toggle('sel', b.dataset.role === settings.role));
    $('title-def-foe').textContent = 'vs AI Attacker: ' + DEF_LEVELS[settings.level].name + ', ' + DEF_LEVELS[settings.level].blurb + '.';
    $('title-atk-foe').textContent = 'vs Defender bot: ' + BOT_LEVELS[settings.level].name + ', ' + BOT_LEVELS[settings.level].blurb + '.';
    renderSoundButtons();
  }

  function chooseRole(role) {
    settings.role = role;
    saveSettings();
    $('set-level').value = settings.level;
    hide('overlay-title');
    SND.play('select');
    newGame();
  }

  function newGame() {
    ui.role = settings.role;
    document.body.classList.toggle('role-attacker', ui.role === 'attacker');
    ui.phase = 'setup';
    ui.setup = RF.randomSetup(rng);
    ui.state = null;
    ui.mode = null;
    ui.pending = [];
    ui.draft = null;
    ui.undo = [];
    ui.log = [];
    ui.recent = new Set();
    ui.selected = null;
    ui.busy = false;
    ui.stats = newStats();
    ui.amode = 'move';
    ui.hint = null;
    hide('overlay-end');
    // As the Attacker, the Defender bot hides its tokens and moves first.
    if (ui.role === 'attacker') return startGame();
    render();
  }

  function startGame() {
    const err = RF.validateSetup(ui.setup);
    if (err) return toast(err);
    const atk = ui.role === 'attacker';
    RF.applyConfig(atk ? (BOT_LEVELS[settings.level] || BOT_LEVELS.normal).config : (AI.LEVELS[settings.level] || AI.LEVELS.normal).config);
    ui.state = RF.newGame(ui.setup, { rng });
    ui.record = {
      version: VERSION,
      startedAt: new Date().toISOString(),
      seed: seedStr,
      role: ui.role,
      level: settings.level,
      bot: atk ? BOT_LEVELS[settings.level].strategy : null,
      swapRule: settings.swapRule,
      threatHighlight: !!settings.showThreat,
      setup: Object.fromEntries(Object.entries(ui.setup).map(([c, t]) => [RF.cellName(+c), t])),
      actions: [],
      turnMs: [],
      result: null,
      rating: null,
      comment: '',
    };
    ui.turnStart = ui.gameStart = Date.now();
    ui.phase = 'play';
    ui.selected = null;
    SND.play('turn');
    addLog('sys', 'Round 1');
    if (atk) {
      addLog('A', 'You are the Attacker. The ' + BOT_LEVELS[settings.level].name + ' Defender has hidden 3 Crown Jewels and 3 Sensors in its apps. ' +
        'You can see where the face-down tokens are, but not what they are.');
      addLog('A', 'Win by stealing one jewel, or by getting footholds in ' + RF.CONFIG.ransomwareApps + ' apps (ransomware). ' +
        'The Defender wins at ' + RF.CONFIG.scoreTarget + ' Zero Trust points, or if you are still out after round ' + RF.CONFIG.roundLimit + '.');
      render();
      return runDefenderBot();
    }
    addLog('D', 'Your tokens are hidden. The Attacker can see where they are, but not what they are.');
    addLog('D', 'Observe an app to map its business flows (they show on your next turn). Ring-fence it to allow those flows and block the rest. ' +
      'Secure apps and hardened services earn Zero Trust points and Insight every round. Reach ' + RF.CONFIG.scoreTarget +
      ' points, or survive to the end of round ' + RF.CONFIG.roundLimit + '. The Attacker wins by stealing one jewel, or with footholds in ' +
      RF.CONFIG.ransomwareApps + ' apps (ransomware).');
    render();
  }

  // ------------------------------------------------------------- actions

  // One sound per action: the most important thing that happened.
  const SOUND_ORDER = ['exfil', 'sensor', 'jewel', 'quarantine', 'evict', 'outage', 'isolate', 'ringfence', 'harden', 'observe', 'deploy', 'recon', 'stone', 'discover', 'income', 'turn'];

  function apply(action, who) {
    const res = RF.act(ui.state, action);
    if (!res.ok) {
      toast(res.error);
      SND.play('error');
      return null;
    }
    const atk = ui.role === 'attacker';
    for (const ev of res.events) {
      let text = ev.text;
      const st = ui.stats;
      if (ev.kind === 'recon') {
        st.recons++;
        const t = ui.state.tokens[ev.cell];
        if (t) text = atk ? 'Recon on ' + RF.cellName(ev.cell) + ': it is a ' + t.type.toUpperCase() + '.'
          : 'Attacker ran Recon on ' + RF.cellName(ev.cell) + '. They now know it is a ' + t.type.toUpperCase() + '.';
      }
      if (ev.kind === 'sensor') st.sensorHits++;
      if (ev.kind === 'quarantine') st.quarantines++;
      if (ev.kind === 'outage') st.outages++;
      if (ev.kind === 'jewel') st.jewelsFound++;
      if (ev.kind === 'evict') st.evicted++;
      if (ev.kind === 'turn') {
        if (ui.state.turn === 'defender') addLog('sys', 'Round ' + ui.state.round);
        continue;
      }
      if (atk) text = attackerText(ev, text);
      if (text == null) continue;
      const big = ['exfil', 'sensor', 'jewel', 'quarantine', 'end', 'outage', 'discover', 'swap'].includes(ev.kind);
      addLog(who, (!atk && who === 'A' && ev.kind === 'stone' ? 'Attacker: ' : '') + text, big);
    }
    ui.stats.maxBlast = Math.max(ui.stats.maxBlast, RF.ransomedApps(ui.state).length);
    const kinds = res.events.map((e) => e.kind);
    const top = SOUND_ORDER.find((k) => kinds.includes(k));
    if (top === 'stone') SND.play(action.type === 'breach' ? 'breach' : 'spread');
    else if (top === 'evict') SND.play('quarantine');
    else if (top === 'isolate') SND.play('wall');
    else if (top) SND.play(top);
    return res;
  }

  // Event texts are written for the Defender. As the Attacker you see the
  // same events, minus what the Defender's Security Intelligence knows.
  function attackerText(ev, text) {
    const c = ev.cell != null ? RF.cellName(ev.cell) : '';
    switch (ev.kind) {
      case 'stone': return 'You: ' + text;
      case 'jewel': return 'CROWN JEWEL found on ' + c + '! Exfiltrate it from your next turn, while its group still has a route to an exit.';
      case 'sensor': return 'SENSOR on ' + c + '! SSP IDS/IPS caught you: the stone is removed and your turn ends.';
      case 'quarantine': return 'QUARANTINED: your group on ' + ev.cells.map(RF.cellName).join(', ') + ' had no open edges left and was removed.';
      case 'evict': return 'Your stone on ' + RF.REGION[ev.cell] + ' was evicted when the Defender hardened it.';
      case 'observe': return 'Defender: Security Intelligence is watching app ' + ev.app + ' (' + RF.APPS[ev.app].name + '). It will know that app’s flows next turn.';
      case 'discover': return /mapped app/.test(text) ? 'Defender: Security Intelligence has mapped ' + text.match(/mapped app (\w)/)[1] + '’s business flows.' : null;
      case 'deploy': return 'Defender deploys a Sensor on ' + c + ' (you saw it, so you know what it is).';
      case 'income': return 'Defender ' + text.charAt(0).toLowerCase() + text.slice(1);
      case 'exfil': return 'You EXFILTRATED the Crown Jewel on ' + c + '!';
      case 'end': return text;
      default: return 'Defender: ' + text;
    }
  }

  // ------------------------------------------------------ playtest record

  function describe(action) {
    const out = { a: action.type };
    if (action.cell != null) out.cell = RF.cellName(action.cell);
    if (action.app) out.app = action.app;
    if (action.edges) out.edges = action.edges.map((k) => RF.cellName(RF.EDGES[k].a) + '-' + RF.cellName(RF.EDGES[k].b));
    if (action.type === 'swap') {
      out.cells = [RF.cellName(action.a), RF.cellName(action.b)];
      out.really = !!action.really;
    }
    return out;
  }

  function recordAction(who, action, events) {
    if (!ui.record) return;
    const entry = Object.assign({ r: ui.state.round, who, t: Date.now() - ui.gameStart }, describe(action));
    const notable = events.filter((e) => ['outage', 'sensor', 'jewel', 'exfil', 'quarantine', 'discover'].includes(e.kind)).map((e) => e.kind);
    if (notable.length) entry.ev = notable;
    ui.record.actions.push(entry);
  }

  function loadHistory() {
    try { return JSON.parse(localStorage.getItem('ringfence.playtests') || '[]'); } catch (e) { return []; }
  }
  function saveRecord() {
    if (!ui.record || !ui.record.result) return;
    try {
      const all = loadHistory().filter((r) => r.startedAt !== ui.record.startedAt);
      all.push(ui.record);
      localStorage.setItem('ringfence.playtests', JSON.stringify(all.slice(-100)));
    } catch (e) { /* storage unavailable: the download buttons still work */ }
    renderPlaytestCount();
  }
  function renderPlaytestCount() {
    const n = loadHistory().length;
    $('pt-count').textContent = n + ' game' + (n === 1 ? '' : 's') + ' saved in this browser';
    $('btn-dl-all').textContent = 'Download all playtests (' + n + ')';
  }
  function download(name, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }
  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

  // ------------------------------------------------------------ threat

  function defenderDo(action) {
    if (ui.busy || ui.phase !== 'play' || ui.state.turn !== 'defender') return;
    ui.undo.push({ state: RF.clone(ui.state), log: ui.log.length, stats: Object.assign({}, ui.stats), rec: ui.record ? ui.record.actions.length : 0 });
    const res = apply(action, 'D');
    if (!res) {
      ui.undo.pop();
      render();
      return;
    }
    recordAction('D', action, res.events);
    const st = ui.stats;
    if (action.type in st) st[action.type]++;
    if (action.type === 'segment') st.walls += action.edges.length;
    if (res.events.some((e) => e.kind === 'outage')) {
      // An outage reveals a hidden flow, so it can't be taken back.
      ui.undo = [];
      toast('Outage! You blocked a real business flow. This can’t be undone.');
    }
    ui.mode = null;
    ui.pending = [];
    ui.draft = null;
    render();
  }

  function undo() {
    const snap = ui.undo.pop();
    if (!snap) return;
    ui.state = snap.state;
    ui.log.length = snap.log;
    if (ui.record) ui.record.actions.length = snap.rec;
    ui.stats = snap.stats;
    ui.mode = null;
    ui.pending = [];
    ui.draft = null;
    render();
  }

  function endDefenderTurn() {
    if (ui.busy || ui.phase !== 'play' || ui.state.turn !== 'defender') return;
    ui.mode = null;
    ui.pending = [];
    ui.draft = null;
    ui.undo = [];
    if (ui.record) ui.record.turnMs.push(Date.now() - ui.turnStart);
    apply({ type: 'endTurn' }, 'D');
    if (ui.state.winner) return finish();
    runAttacker();
  }

  function runAttacker() {
    ui.busy = true;
    ui.recent = new Set();
    render();
    const step = () => {
      const s = ui.state;
      if (ui.phase !== 'play') return;
      if (s.winner) return finish();
      if (s.turn !== 'attacker') {
        ui.busy = false;
        ui.fresh = -1;
        ui.turnStart = Date.now();
        render();
        return;
      }
      if (s.actionsLeft <= 0) {
        apply({ type: 'endTurn' }, 'A');
        return step();
      }
      const { action, note } = AI.chooseAction(s, { level: settings.level, rng });
      if (settings.reasoning && note) addLog('ai', 'AI: ' + note);
      if (action.type === 'endTurn') {
        addLog('A', 'Attacker ends their turn early.');
      }
      const res = apply(action, 'A');
      if (res) recordAction('A', action, res.events);
      ui.fresh = -1;
      if (res && action.cell != null) {
        ui.recent.add(action.cell);
        if (ui.state.stones[action.cell]) ui.fresh = action.cell;
      }
      render();
      setTimeout(step, delay());
    };
    setTimeout(step, delay());
  }

  // ------------------------------------------- Attacker role (vs the bot)

  function attackerDo(action) {
    const s = ui.state;
    if (ui.busy || ui.phase !== 'play' || s.turn !== 'attacker') return;
    ui.hint = null;
    const res = apply(action, 'A');
    if (!res) return render();
    recordAction('A', action, res.events);
    if (action.type in ui.stats) ui.stats[action.type]++;
    ui.recent = new Set(action.cell != null ? [action.cell] : []);
    ui.fresh = action.cell != null && s.stones[action.cell] ? action.cell : -1;
    ui.selected = null;
    if (s.winner) return finish();
    // A Sensor ends the turn; so does running out of actions.
    if (s.actionsLeft <= 0) {
      ui.busy = true;
      render();
      setTimeout(() => { ui.busy = false; endAttackerTurn(); }, Math.max(500, delay()));
      return;
    }
    if (ui.amode !== 'move' && !legalFor(ui.amode).size) ui.amode = 'move';
    render();
  }

  function endAttackerTurn() {
    const s = ui.state;
    if (ui.busy || ui.phase !== 'play' || s.turn !== 'attacker') return;
    ui.hint = null;
    if (ui.record) ui.record.turnMs.push(Date.now() - ui.turnStart);
    apply({ type: 'endTurn' }, 'A');
    if (s.winner) return finish();
    runDefenderBot();
  }

  function runDefenderBot() {
    ui.busy = true;
    ui.recent = new Set();
    ui.mode = null;
    render();
    const strategy = (BOT_LEVELS[settings.level] || BOT_LEVELS.normal).strategy;
    let guard = 0;
    const step = () => {
      const s = ui.state;
      if (ui.phase !== 'play') return;
      if (s.winner) return finish();
      if (s.turn !== 'defender') {
        ui.busy = false;
        ui.fresh = -1;
        ui.amode = 'move';
        ui.turnStart = Date.now();
        SND.play('turn');
        render();
        return;
      }
      let action = ++guard > 20 || s.actionsLeft <= 0 ? { type: 'endTurn' } : BOT.chooseAction(s, { strategy });
      if (action.type !== 'endTurn' && !RF.act(RF.clone(s), action).ok) action = { type: 'endTurn' };
      if (action.type === 'endTurn' && s.actionsLeft > 0) addLog('D', 'Defender saves its remaining actions.');
      const res = apply(action, 'D');
      if (res) recordAction('D', action, res.events);
      if (res && action.type in ui.stats) ui.stats[action.type]++;
      ui.recent = new Set();
      if (res && action.cell != null) ui.recent.add(action.cell);
      if (res && action.app) RF.APP_CELLS[action.app].forEach((c) => ui.recent.add(c));
      if (res && action.edge) { const e = RF.EDGES[action.edge]; ui.recent.add(e.a); ui.recent.add(e.b); }
      render();
      setTimeout(step, action.type === 'endTurn' ? 250 : delay());
    };
    setTimeout(step, delay());
  }

  const delay = () => parseInt(settings.speed, 10) || 600;

  // Cells where the chosen Attacker action is legal right now.
  function legalFor(mode) {
    const s = ui.state;
    const out = new Map();
    if (!s || s.turn !== 'attacker' || s.winner) return out;
    for (const a of RF.legalAttackerActions(s)) {
      if (a.cell == null) continue;
      const m = a.type === 'breach' || a.type === 'spread' ? 'move' : a.type;
      if (m !== mode) continue;
      // Prefer a cheap Spread; keep the Breach for somewhere new.
      const prev = out.get(a.cell);
      if (!prev || (a.type === 'spread' && RF.spreadCost(s, a.cell) === 1)) out.set(a.cell, a);
    }
    return out;
  }

  function attackerClick(c) {
    const s = ui.state;
    if (ui.busy || s.turn !== 'attacker') {
      ui.selected = c;
      return render();
    }
    const tryModes = ui.amode === 'move' ? ['move', 'exfil', 'recon'] : [ui.amode];
    for (const m of tryModes) {
      const a = legalFor(m).get(c);
      if (a) return attackerDo(a);
    }
    ui.selected = ui.selected === c ? null : c;
    render();
  }

  function pickAttackerMode(m) {
    if (ui.busy || ui.phase !== 'play' || ui.state.turn !== 'attacker') return;
    if (m === 'hint') return showHint();
    ui.amode = m;
    ui.selected = null;
    SND.play('click');
    render();
  }

  function showHint() {
    const { action } = AI.chooseAction(ui.state, { level: 'normal', rng });
    ui.hint = action;
    SND.play('select');
    render();
  }

  const describeAttack = (a) => {
    const c = a.cell != null ? RF.cellName(a.cell) : '';
    if (a.type === 'breach') return 'Breach into ' + c;
    if (a.type === 'spread') { const n = RF.spreadCost(ui.state, a.cell); return 'Spread to ' + c + (n > 1 ? ' (' + n + ' actions)' : ''); }
    if (a.type === 'recon') return 'Recon the token on ' + c;
    if (a.type === 'exfil') return 'Exfiltrate the jewel on ' + c;
    return 'End your turn';
  };

  function finish() {
    ui.phase = 'over';
    ui.busy = false;
    render();
    const s = ui.state;
    const atk = ui.role === 'attacker';
    const won = s.winner === ui.role;
    SND.play(won ? 'win' : 'lose');
    $('overlay-end').classList.toggle('won', won);
    $('end-title').textContent = atk
      ? (won ? 'BREACH COMPLETE: you got in' : 'ACCESS DENIED: vDefend stopped you')
      : (won ? 'You defended the datacenter' : 'The Attacker got away with the data');
    $('end-reason').textContent = s.reason + ' Zero Trust ' + s.score + '/' + RF.CONFIG.scoreTarget +
      ', blast radius ' + RF.ransomedApps(s).length + '/' + RF.CONFIG.ransomwareApps + ', round ' + Math.min(s.round, RF.CONFIG.roundLimit) + '.';
    const st = ui.stats;
    const hardened = RF.INFRA_CELLS.filter((c) => s.hardened[c]).length;
    const fenced = Object.keys(s.fenced).filter((a) => s.fenced[a]);
    const secureEnd = RF.secureApps(s).length;
    const blast = RF.ransomedApps(s).length;
    const items = [
      ['Observed ' + st.observe + ' app' + (st.observe === 1 ? '' : 's') + ' before acting', 'Security Intelligence: map an application’s traffic before you enforce policy on it.'],
      ['Hardened ' + hardened + ' of 3 shared services', 'Stage 2: Infrastructure Services. An unhardened DNS, NTP or LDAP is a backdoor into every app that uses it.'],
      ['Ring-fenced ' + fenced.length + ' app' + (fenced.length === 1 ? '' : 's') + (fenced.length ? ' (' + fenced.join(', ') + ')' : '') + ', ' + secureEnd + ' still secure at the end',
        'Stage 4: Application microsegmentation. Recommended allow rules for the observed flows, and everything else blocked.'],
      ['Blast radius: the Attacker reached ' + blast + ' of ' + Object.keys(RF.APPS).length + ' apps', 'Microsegmentation limits how far one compromise can spread.'],
      [st.outages ? 'Caused ' + st.outages + ' outage' + (st.outages > 1 ? 's' : '') + ' (−' + st.outages * RF.CONFIG.outagePenalty + ' points)' : 'Caused no outages',
        'Locking down an app you haven’t observed breaks its business flows.'],
      ['Isolated ' + st.isolate + ' edge' + (st.isolate === 1 ? '' : 's') + ' in an emergency', 'Incident response: quarantine, even when it breaks a business flow.'],
      ['Sensors caught the Attacker ' + st.sensorHits + '×', 'SSP threat prevention: distributed IDS/IPS inspects the traffic the firewall allows.'],
    ];
    if (atk) {
      items.length = 0;
      items.push(
        ['Your blast radius peaked at ' + st.maxBlast + ' of the ' + RF.CONFIG.ransomwareApps + ' apps ransomware needs', 'Every app you reach without crossing a ring-fence widens the blast radius. Microsegmentation is what keeps it small.'],
        ['The Defender hardened ' + hardened + ' of 3 shared services' + (st.evicted ? ', evicting you ' + st.evicted + '×' : ''),
          'Stage 2: Infrastructure Services. A hardened DNS, NTP or LDAP is no longer a backdoor into every app that uses it, and DNS stops being an exit.'],
        ['The Defender ring-fenced ' + fenced.length + ' app' + (fenced.length === 1 ? '' : 's') + (fenced.length ? ' (' + fenced.join(', ') + ')' : ''),
          'Stage 4: Application microsegmentation. Allowed flows only, so every crossing cost you extra actions.'],
        ['Observed ' + st.observe + ' app' + (st.observe === 1 ? '' : 's') + ' first, and caused ' + s.outages + ' outage' + (s.outages === 1 ? '' : 's'),
          'Security Intelligence maps the business flows before enforcement, so lockdown doesn’t break the apps.'],
        ['Sensors caught you ' + st.sensorHits + '×; Isolate blocked ' + st.isolate + ' edge' + (st.isolate === 1 ? '' : 's') + '; ' + st.quarantines + ' group' + (st.quarantines === 1 ? '' : 's') + ' quarantined',
          'SSP distributed IDS/IPS inspects even the traffic the firewall allows, and incident response cuts you off.'],
        ['You found ' + st.jewelsFound + ' jewel' + (st.jewelsFound === 1 ? '' : 's') + ' and ran Recon ' + st.recons + '×', 'Attackers need to find the crown jewels before they can steal them. Sensors make every guess risky.'],
      );
    }
    $('end-debrief').innerHTML = '<h3>' + (atk ? 'What stood in your way' : 'In this game you…') + '</h3><ul class="debrief">' +
      items.map(([a, b]) => '<li><b>' + esc(a) + '</b><span>' + esc(b) + '</span></li>').join('') + '</ul>';
    if (ui.record) {
      ui.record.result = {
        winner: s.winner,
        playerWon: s.winner === ui.role,
        reason: s.reason,
        rounds: Math.min(s.round, RF.CONFIG.roundLimit),
        score: s.score,
        jewelsTaken: s.jewelsTaken,
        outages: s.outages,
        swaps: s.swapsUsed,
        durationMs: Date.now() - ui.gameStart,
      };
      saveRecord();
    }
    const mins = ui.record ? Math.max(1, Math.round(ui.record.result.durationMs / 60000)) : null;
    $('fb-status').textContent = mins ? 'This game took about ' + mins + ' minute' + (mins > 1 ? 's' : '') + '.' : '';
    $('fb-comment').value = '';
    document.querySelectorAll('#rate [data-rate]').forEach((b) => b.classList.remove('sel'));
    show('overlay-end');
  }

  // --------------------------------------------------------------- input

  function onBoardClick(e) {
    const edgeEl = e.target.closest('[data-edge]');
    const cellEl = e.target.closest('[data-cell]');
    if (ui.phase === 'setup') {
      if (cellEl) setupClick(+cellEl.dataset.cell);
      return;
    }
    if (ui.phase !== 'play') {
      if (cellEl) { ui.selected = +cellEl.dataset.cell; render(); }
      return;
    }
    if (ui.role === 'attacker') {
      if (cellEl) attackerClick(+cellEl.dataset.cell);
      return;
    }
    if (ui.mode === 'segment' && edgeEl) return segmentClick(edgeEl.dataset.edge);
    if (ui.mode === 'isolate' && edgeEl) {
      ui.draft = { edge: edgeEl.dataset.edge };
      return render();
    }
    if (ui.mode === 'allow' && edgeEl && ui.draft) {
      const k = edgeEl.dataset.edge;
      if (ui.draft.edges.has(k)) ui.draft.edges.delete(k);
      else ui.draft.edges.add(k);
      return render();
    }
    if (!cellEl) return;
    const c = +cellEl.dataset.cell;
    const s = ui.state;
    if (ui.busy || s.turn !== 'defender') {
      ui.selected = c;
      return render();
    }
    switch (ui.mode) {
      case 'harden':
        return defenderDo({ type: 'harden', cell: c });
      case 'observe':
        if (RF.isInfra(c)) return toast('Pick an application to observe.');
        return defenderDo({ type: 'observe', app: RF.REGION[c] });
      case 'allow':
        if (RF.isInfra(c)) return toast('Pick an application. Infrastructure is protected by Harden.');
        ui.draft = { app: RF.REGION[c], edges: new Set(RF.recommendedExceptions(s, RF.REGION[c])) };
        return render();
      case 'ringfence':
        if (RF.isInfra(c)) return toast('Infrastructure cells are hardened, not ring-fenced.');
        if (s.fenced[RF.REGION[c]]) return toast('App ' + RF.REGION[c] + ' is already ring-fenced.');
        ui.draft = { app: RF.REGION[c] };
        return render();
      case 'deploy':
        return defenderDo({ type: 'deploy', cell: c });
      case 'swap': {
        const t = s.tokens[c];
        if (!t || t.faceUp) return toast('Pick a face-down token.');
        const d = ui.draft || {};
        if (d.a === c) { ui.draft = null; return render(); }
        if (d.a == null || d.b != null) ui.draft = { a: c };
        else {
          const err = RF.swapError(s, d.a, c);
          if (err) return toast(err);
          ui.draft = { a: d.a, b: c };
        }
        return render();
      }
      case 'segment':
        return toast('Tap an edge between two cells (the highlighted bars).');
      default:
        ui.selected = ui.selected === c ? null : c;
        render();
    }
  }

  function segmentClick(key) {
    if (ui.pending.includes(key)) {
      ui.pending = ui.pending.filter((k) => k !== key);
      return render();
    }
    const err = RF.wallError(ui.state, key);
    if (err) return toast(err);
    if (ui.pending.length >= ui.state.wallsLeft) return toast('No walls left in your supply.');
    ui.pending.push(key);
    render();
  }

  function setupClick(c) {
    if (RF.isInfra(c)) return toast('Tokens go on application cells, not infrastructure.');
    const app = RF.REGION[c];
    const existing = Object.keys(ui.setup).map(Number).find((k) => RF.REGION[k] === app);
    if (existing === c) {
      // Cycle: Jewel → Sensor → removed.
      if (ui.setup[c] === 'jewel') ui.setup[c] = 'sensor';
      else delete ui.setup[c];
    } else if (existing != null) {
      ui.setup[c] = ui.setup[existing];
      delete ui.setup[existing];
    } else {
      const n = Object.keys(ui.setup).length;
      if (n >= RF.CONFIG.setupJewels + RF.CONFIG.setupSensors) return toast('All 6 tokens are placed. Tap one to remove it first.');
      const jewels = Object.values(ui.setup).filter((t) => t === 'jewel').length;
      ui.setup[c] = jewels < RF.CONFIG.setupJewels ? 'jewel' : 'sensor';
    }
    render();
  }

  function pickMode(mode) {
    if (ui.busy || ui.phase !== 'play' || ui.state.turn !== 'defender') return;
    if (mode === 'assess') return defenderDo({ type: 'assess' });
    ui.mode = ui.mode === mode ? null : mode;
    ui.pending = [];
    ui.draft = null;
    ui.selected = null;
    render();
  }

  function publishAllow() {
    const d = ui.draft;
    if (!d) return;
    const edges = [...d.edges].filter((k) => !ui.state.allows[k]);
    defenderDo({ type: 'allow', app: d.app, edges });
  }

  function confirmFence() {
    if (ui.draft) defenderDo({ type: 'ringfence', app: ui.draft.app });
  }

  // ---------------------------------------------------------- rendering

  function render() {
    renderBoard();
    renderPanel();
  }

  function el(tag, attrs, parent) {
    const n = document.createElementNS(SVGNS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  function targetCells() {
    const s = ui.state;
    const out = new Set();
    if (ui.phase === 'setup') {
      for (let i = 0; i < RF.N; i++) if (!RF.isInfra(i)) out.add(i);
      return out;
    }
    if (s && ui.role === 'attacker') {
      if (ui.busy || ui.phase !== 'play') return out;
      legalFor(ui.amode).forEach((a, c) => out.add(c));
      return out;
    }
    if (!s || ui.busy || s.turn !== 'defender') return out;
    for (let i = 0; i < RF.N; i++) {
      if (ui.mode === 'harden' && RF.isInfra(i) && !s.hardened[i]) out.add(i);
      if (ui.mode === 'observe' && !RF.isInfra(i) && s.observed[RF.REGION[i]] == null) out.add(i);
      if (ui.mode === 'swap') {
        const t = s.tokens[i];
        if (ui.draft && (ui.draft.a === i || ui.draft.b === i)) out.add(i);
        else if (t && !t.faceUp && !RF.NEIGHBORS[i].some((n) => s.stones[n.cell]) && !(ui.draft && ui.draft.b != null)) out.add(i);
        continue;
      }
      if (ui.draft) {
        if (RF.REGION[i] === ui.draft.app) out.add(i);
        continue;
      }
      if (ui.mode === 'allow' && !RF.isInfra(i)) out.add(i);
      if (ui.mode === 'ringfence' && !RF.isInfra(i) && !s.fenced[RF.REGION[i]] && s.insight >= RF.ringfenceCost(RF.REGION[i])) out.add(i);
      if (ui.mode === 'deploy' && !RF.isInfra(i) && !s.stones[i] && !s.tokens[i]) out.add(i);
    }
    return out;
  }

  function renderBoard() {
    const svg = $('board');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.textContent = '';
    const s = ui.state;
    // As the Attacker you only see what the Attacker may know, until the game ends.
    const vs = s && ui.role === 'attacker' && ui.phase !== 'over' ? RF.attackerView(s) : s;
    const setupTokens = ui.phase === 'setup' ? ui.setup : null;

    // Internet band and axes.
    el('rect', { class: 'internet-band', x: ML, y: 4, width: RF.SIZE * CS, height: 22, rx: 6 }, svg);
    el('text', { class: 't-internet', x: ML + (RF.SIZE * CS) / 2, y: 19, 'text-anchor': 'middle' }, svg).textContent = 'INTERNET';
    for (let c = 0; c < RF.SIZE; c++)
      el('text', { class: 't-axis', x: ML + c * CS + CS / 2, y: MT - 6, 'text-anchor': 'middle' }, svg).textContent = 'abcdefg'[c];
    for (let r = 0; r < RF.SIZE; r++)
      el('text', { class: 't-axis', x: ML - 10, y: MT + r * CS + CS / 2 + 4, 'text-anchor': 'middle' }, svg).textContent = r + 1;

    // Cells.
    const cells = el('g', {}, svg);
    for (let i = 0; i < RF.N; i++) {
      const reg = RF.REGION[i];
      const infra = RF.isInfra(i);
      const cls = 'cell ' + (infra ? 'infra' + (s && s.hardened[i] ? ' hardened' : '') : 'app-' + reg);
      el('rect', { class: cls, x: cx(i), y: cy(i), width: CS, height: CS }, cells);
      if (infra) {
        el('rect', { class: 'infra-ring svc-' + reg, x: cx(i) + 3, y: cy(i) + 3, width: CS - 6, height: CS - 6, rx: 6 }, cells);
        el('text', { class: 't-infra', x: cx(i) + CS / 2, y: cy(i) + 15, 'text-anchor': 'middle' }, cells).textContent = reg;
        sprite(reg.toLowerCase(), cx(i) + CS / 2, cy(i) + 31, 22, cells, 'svc-icon');
        if (!(s && s.hardened[i])) {
          el('text', { class: 't-users', x: cx(i) + CS / 2, y: cy(i) + CS - 8, 'text-anchor': 'middle' }, cells).textContent =
            '→ ' + RF.INFRA_USERS[reg].join(' ');
        }
        if (s && s.hardened[i]) sprite('shield', cx(i) + CS / 2, cy(i) + 50, 17, cells, 'hard-shield');
      } else {
        sprite('rack', cx(i) + CS / 2, cy(i) + CS / 2 + 2, 30, cells, 'rack');
      }
      if (!infra && isFirstCellOfApp(i)) {
        let mark = '';
        if (s && s.fenced[reg]) mark += ' ◎';
        if (vs && vs.observed[reg] === -1) mark += ' 👁';
        else if (vs && vs.observed[reg] != null) mark += ' 👁…';
        if (s && RF.APP_CELLS[reg].some((c) => s.stones[c])) sprite('skull', cx(i) + CS - 10, cy(i) + CS - 10, 11, cells, 'skull');
        el('text', { class: 't-app', x: cx(i) + 5, y: cy(i) + 13 }, cells).textContent = reg + mark;
        // Dots: the shared services this app depends on.
        RF.APPS[reg].uses.forEach((svc, n) => {
          const d = el('circle', { class: 'dep svc-' + svc, cx: cx(i) + 8 + n * 10, cy: cy(i) + CS - 8, r: 3.8 }, cells);
          el('title', {}, d).textContent = 'Uses ' + svc + (s && !s.hardened[RF.INFRA_CELL[svc]] ? ' (unhardened: a backdoor)' : ' (hardened)');
        });
      }
      // Compromised apps are tinted: that's the blast radius.
      if (s && !infra && RF.APP_CELLS[reg].some((c) => s.stones[c])) {
        el('rect', { class: 'compromised', x: cx(i), y: cy(i), width: CS, height: CS }, cells);
      }
      if (reg === 'H') {
        const gx = cx(i) + CS - 11;
        const gy = cy(i) + 11;
        el('circle', { class: 'globe', cx: gx, cy: gy, r: 5.5 }, cells);
        el('ellipse', { class: 'globe', cx: gx, cy: gy, rx: 2.4, ry: 5.5 }, cells);
        el('line', { class: 'globe', x1: gx - 5.5, y1: gy, x2: gx + 5.5, y2: gy }, cells);
      }
    }

    // Region borders.
    const borders = el('g', {}, svg);
    for (const key in RF.EDGES) {
      const e = RF.EDGES[key];
      if (!e.border) continue;
      const [x1, y1, x2, y2] = edgeLine(e);
      el('line', { class: 'border', x1, y1, x2, y2 }, borders);
    }

    // Ring-fences and walls.
    const walls = el('g', {}, svg);
    if (s) {
      for (const key in RF.EDGES) {
        const e = RF.EDGES[key];
        if (!e.border || s.allows[key]) continue;
        if (s.fenced[RF.REGION[e.a]] || s.fenced[RF.REGION[e.b]]) {
          const [x1, y1, x2, y2] = edgeLine(e, 5);
          el('line', { class: 'fence', x1, y1, x2, y2 }, walls);
        }
      }
      for (const key in s.walls) wallRect(RF.EDGES[key], s.walls[key] === 'iso' ? 'wall iso' : 'wall', walls);
      if (ui.mode === 'isolate' && ui.draft && ui.draft.edge) wallRect(RF.EDGES[ui.draft.edge], 'wall iso pending', walls);
      ui.pending.forEach((key) => wallRect(RF.EDGES[key], 'wall pending', walls));
    }

    // Business flows and exception (allow) rules.
    const flows = el('g', {}, svg);
    if (s) {
      if (ui.draft && ui.mode === 'ringfence') {
        // Preview: what the lockdown will block.
        for (const key of RF.appBorderEdges(ui.draft.app)) {
          if (s.allows[key] || s.walls[key] || !RF.isOpen(s, key) || s.discovered[key]) continue;
          const [x1, y1, x2, y2] = edgeLine(RF.EDGES[key], 5);
          el('line', { class: 'fence preview', x1, y1, x2, y2 }, flows);
        }
      }
      const keys = new Set([...Object.keys(vs.discovered), ...Object.keys(s.allows)]);
      if (ui.phase === 'over') Object.keys(s.flows).forEach((k) => keys.add(k));
      if (ui.draft && ui.mode === 'allow') ui.draft.edges.forEach((k) => keys.add(k));
      for (const key of keys) {
        const allow = s.allows[key];
        const drafted = !allow && ui.draft && ((ui.mode === 'allow' && ui.draft.edges.has(key)) ||
          (ui.mode === 'ringfence' && RF.recommendedExceptions(s, ui.draft.app).includes(key)));
        let cls;
        let title;
        if (allow === 'emergency') { cls = 'allow emergency'; title = 'Emergency allow rule, added after an outage'; }
        else if (allow) { cls = 'allow'; title = allow === 'manual' ? 'Manual exception (allow rule)' : 'Exception from the Security Intelligence recommendation'; }
        else if (drafted) { cls = 'allow draft'; title = 'Exception you are about to publish'; }
        else if (s.discovered[key]) { cls = 'flow'; title = 'Observed business flow: not allowed yet'; }
        else { cls = 'flow unseen'; title = 'Business flow Security Intelligence never observed'; }
        drawFlow(RF.EDGES[key], cls, title, flows);
      }
    }

    // Tokens and stones.
    const pieces = el('g', {}, svg);
    const tokens = setupTokens
      ? Object.fromEntries(Object.entries(setupTokens).map(([c, type]) => [c, { type, faceUp: false, recon: false }]))
      : (vs ? vs.tokens : {});
    for (const c in tokens) drawToken(+c, tokens[c], pieces);
    if (s) {
      for (let i = 0; i < RF.N; i++) {
        if (!s.stones[i]) continue;
        const x = cx(i) + CS / 2;
        const y = cy(i) + CS / 2 + 2;
        el('ellipse', { class: 'bug-shadow', cx: x, cy: y + 14, rx: 12, ry: 3 }, pieces);
        const g = el('g', { class: 'bug' + (i === ui.fresh ? ' fresh' : '') + ((RF.rowOf(i) + RF.colOf(i)) % 2 ? ' alt' : '') }, pieces);
        sprite((RF.rowOf(i) + RF.colOf(i)) % 2 ? 'virus2' : 'virus', x, y, 30, g, 'sprite');
      }
    }
    // Attacker role: the suggested move, and moves that cost extra actions.
    if (s && ui.role === 'attacker' && ui.phase === 'play' && !ui.busy && s.turn === 'attacker') {
      if (ui.hint && ui.hint.cell != null) {
        el('rect', { class: 'hint-cell', x: cx(ui.hint.cell) + 3, y: cy(ui.hint.cell) + 3, width: CS - 6, height: CS - 6, rx: 6, 'pointer-events': 'none' }, pieces);
      }
      if (ui.amode === 'move') {
        legalFor('move').forEach((a, c) => {
          const n = a.type === 'spread' ? RF.spreadCost(s, c) : 1;
          if (n > 1) el('text', { class: 't-cost', x: cx(c) + CS - 5, y: cy(c) + 14, 'text-anchor': 'end' }, pieces).textContent = '×' + n;
        });
        legalFor('exfil').forEach((a, c) => {
          el('text', { class: 't-exfil', x: cx(c) + CS / 2, y: cy(c) + 12, 'text-anchor': 'middle' }, pieces).textContent = 'EXFIL';
        });
      }
    }

    // Threat highlight: the Attacker's quickest route to a real jewel.
    const threat = settings.showThreat && s && ui.role === 'defender' && ui.phase === 'play' && s.turn === 'defender' ? AI.defenderThreat(s) : null;
    if (threat) {
      const g = el('g', { class: 'threat ' + threatLevel(threat), 'pointer-events': 'none' }, svg);
      threat.path.forEach((c) => {
        if (s.stones[c]) return;
        el('rect', { class: 'threat-cell', x: cx(c) + 5, y: cy(c) + 5, width: CS - 10, height: CS - 10, rx: 8 }, g);
      });
      el('circle', { class: 'threat-target', cx: cx(threat.cell) + CS / 2, cy: cy(threat.cell) + CS / 2 + 2, r: 24 }, g);
    }

    // Hit areas (cells, then edges on top in segment mode).
    const targets = targetCells();
    const hits = el('g', {}, svg);
    for (let i = 0; i < RF.N; i++) {
      let cls = 'cell-hit';
      if (targets.has(i)) cls += ' target';
      if (ui.selected === i) cls += ' selected';
      if (ui.recent.has(i)) cls += ' recent';
      const r = el('rect', { class: cls, x: cx(i) + 1.5, y: cy(i) + 1.5, width: CS - 3, height: CS - 3, rx: 4, 'data-cell': i }, hits);
      el('title', {}, r).textContent = cellTitle(i);
    }
    if (ui.mode === 'allow' && ui.draft && s && !ui.busy) {
      for (const key of RF.appBorderEdges(ui.draft.app)) {
        if (s.allows[key] || s.walls[key]) continue;
        const e = RF.EDGES[key];
        if (!ui.draft.edges.has(key)) wallRect(e, 'edge-hint', hits, 3);
        const X = cx(e.b);
        const Y = cy(e.b);
        const attrs = e.orient === 'v'
          ? { x: X - 12, y: Y + 8, width: 24, height: CS - 16 }
          : { x: X + 8, y: Y - 12, width: CS - 16, height: 24 };
        attrs.class = 'edge-hit';
        attrs['data-edge'] = key;
        el('rect', attrs, hits);
      }
    }
    if (ui.mode === 'isolate' && s && !ui.busy) {
      for (const key in RF.EDGES) {
        if (s.walls[key]) continue;
        const e = RF.EDGES[key];
        const X = cx(e.b);
        const Y = cy(e.b);
        const attrs = e.orient === 'v'
          ? { x: X - 12, y: Y + 8, width: 24, height: CS - 16 }
          : { x: X + 8, y: Y - 12, width: CS - 16, height: 24 };
        attrs.class = 'edge-hit';
        attrs['data-edge'] = key;
        el('rect', attrs, hits);
      }
    }
    if (ui.mode === 'segment' && s && !ui.busy) {
      for (const key of RF.wallableEdges(s)) {
        if (ui.pending.includes(key)) continue;
        const e = RF.EDGES[key];
        wallRect(e, 'edge-hint', hits, 3);
        const X = cx(e.b);
        const Y = cy(e.b);
        const attrs = e.orient === 'v'
          ? { x: X - 12, y: Y + 8, width: 24, height: CS - 16 }
          : { x: X + 8, y: Y - 12, width: CS - 16, height: 24 };
        attrs.class = 'edge-hit';
        attrs['data-edge'] = key;
        el('rect', attrs, hits);
      }
      ui.pending.forEach((key) => {
        const e = RF.EDGES[key];
        const X = cx(e.b);
        const Y = cy(e.b);
        const attrs = e.orient === 'v'
          ? { x: X - 12, y: Y + 8, width: 24, height: CS - 16 }
          : { x: X + 8, y: Y - 12, width: CS - 16, height: 24 };
        attrs.class = 'edge-hit';
        attrs['data-edge'] = key;
        el('rect', attrs, hits);
      });
    }
  }

  // danger: it can steal a jewel on its next turn. warn: it can reach one next
  // turn, or steal one within two turns. calm: further away.
  const threatLevel = (t) => (t.nextTurn ? 'danger' : t.rank <= 2 * RF.CONFIG.attackerActions ? 'warn' : 'calm');

  function renderThreat() {
    const box = $('threat');
    const s = ui.state;
    if (!settings.showThreat || !s || ui.phase !== 'play' || s.turn !== 'defender' || s.winner) {
      box.hidden = true;
      return;
    }
    const t = AI.defenderThreat(s);
    box.hidden = false;
    if (!t) {
      const rt = AI.ransomThreat(s);
      box.className = 'threat-box ' + (rt.danger ? 'danger' : 'calm');
      box.innerHTML = '<b>Threat:</b> the Attacker has no route to your jewels right now.<div class="small" style="margin-top:6px"><b>Blast radius:</b> footholds in ' +
        rt.held.length + ' of the ' + rt.need + ' apps it needs' + (rt.reachable.length ? '; it could add about ' + rt.reachable.length + ' more next turn (' + rt.reachable.join(', ') + ')' : '') + '.</div>';
      return;
    }
    const lvl = AI.ransomThreat(s).danger && threatLevel(t) !== 'danger' ? 'danger' : threatLevel(t);
    const where = '<b>' + RF.cellName(t.cell) + '</b>';
    let text;
    if (t.nextTurn) text = '⚠ <b>Threat:</b> it has found your jewel on ' + where + ' and can steal it on its next turn.';
    else if (t.revealed) text = '<b>Threat:</b> it has found your jewel on ' + where + ' and is about ' + t.actions + ' actions from stealing it.';
    else if (t.actions - 1 <= RF.CONFIG.attackerActions) text = '<b>Threat:</b> it could reach your jewel on ' + where + ' next turn, and steal it the turn after.';
    else text = '<b>Threat:</b> the Attacker is about ' + t.actions + ' actions from stealing your jewel on ' + where + '.';
    let html = text + ' <span class="muted small">The dashed route is the way it would go if it knew where the jewel is.</span>';
    const rt = AI.ransomThreat(s);
    html += '<div class="small" style="margin-top:6px"><b>Blast radius:</b> footholds in ' + rt.held.length + ' of the ' + rt.need +
      ' apps it needs' + (rt.reachable.length ? '; it could add about ' + rt.reachable.length + ' more next turn (' + rt.reachable.join(', ') + ')' : '') +
      (rt.danger ? '. <b class="bad">Ransomware is a real risk next turn.</b>' : '.') + '</div>';
    if (lvl !== 'calm' && s.actionsLeft > 0 && !ui.busy) {
      const sugg = AI.suggestResponses(s).slice(0, 3);
      if (sugg.length) {
        html += '<div class="suggest"><span class="small">Responses that would slow it down:</span>' +
          sugg.map((x, n) => '<button class="btn" data-suggest="' + n + '" type="button">' + esc(x.label) +
            ' <em>(' + (x.gain >= 50 ? 'blocks the route' : '+' + x.gain + ' actions for it') + (x.spent ? ', ' + x.spent + ' Insight' : '') +
            (x.scoreDelta < 0 ? ', ' + x.scoreDelta + ' score' : '') + ')</em></button>').join('') + '</div>';
        ui.suggestions = sugg;
      } else {
        html += '<div class="suggest small">No single action stops this route. Consider Isolate, a Swap, or a Sensor on the path.</div>';
      }
    }
    box.className = 'threat-box ' + lvl;
    box.innerHTML = html;
  }

  function drawFlow(e, cls, title, parent) {
    const mx = (cx(e.a) + cx(e.b)) / 2 + CS / 2;
    const my = (cy(e.a) + cy(e.b)) / 2 + CS / 2;
    const [dx, dy] = e.orient === 'v' ? [12, 0] : [0, 12];
    const g = el('g', { class: cls }, parent);
    el('title', {}, g).textContent = title + ' (' + RF.cellName(e.a) + '–' + RF.cellName(e.b) + ')';
    el('line', { class: 'flow-line', x1: mx - dx, y1: my - dy, x2: mx + dx, y2: my + dy }, g);
    el('circle', { class: 'flow-end', cx: mx - dx, cy: my - dy, r: 3 }, g);
    el('circle', { class: 'flow-end', cx: mx + dx, cy: my + dy, r: 3 }, g);
    if (cls.includes('emergency')) {
      el('circle', { class: 'flow-bang', cx: mx, cy: my, r: 6 }, g);
      el('text', { class: 't-bang', x: mx, y: my + 3.5, 'text-anchor': 'middle' }, g).textContent = '!';
    }
  }

  function isFirstCellOfApp(i) {
    return RF.APP_CELLS[RF.REGION[i]][0] === i;
  }

  // Line along an edge, optionally inset from the corners.
  function edgeLine(e, inset) {
    inset = inset || 0;
    const X = cx(e.b);
    const Y = cy(e.b);
    return e.orient === 'v' ? [X, Y + inset, X, Y + CS - inset] : [X + inset, Y, X + CS - inset, Y];
  }

  function wallRect(e, cls, parent, thick) {
    const t = thick || 4;
    const X = cx(e.b);
    const Y = cy(e.b);
    const attrs = e.orient === 'v'
      ? { x: X - t, y: Y + 3, width: 2 * t, height: CS - 6 }
      : { x: X + 3, y: Y - t, width: CS - 6, height: 2 * t };
    attrs.class = cls;
    attrs.rx = t;
    return el('rect', attrs, parent);
  }

  // A pixel sprite centred on (x, y), h units tall.
  function sprite(name, x, y, h, parent, cls) {
    const href = PIX && PIX.url(name);
    if (!href) return null;
    const sz = PIX.size(name);
    const w = (h * sz.w) / sz.h;
    return el('image', { href, x: x - w / 2, y: y - h / 2, width: w, height: h, class: 'px ' + (cls || ''), 'pointer-events': 'none' }, parent);
  }

  function drawToken(c, t, parent) {
    const hasStone = ui.state && ui.state.stones[c];
    const x = hasStone ? cx(c) + CS - 14 : cx(c) + CS / 2;
    const y = hasStone ? cy(c) + CS - 14 : cy(c) + CS / 2 + 2;
    const r = hasStone ? 10 : 14;
    const g = el('g', { class: 'token' + (t.faceUp ? ' up' : '') }, parent);
    if (t.type === 'unknown') {
      sprite('card', x, y, 2 * r + 2, g, 'card');
    } else {
      el('rect', { class: 'tok-card' + (t.faceUp ? ' up' : ''), x: x - r, y: y - r, width: 2 * r, height: 2 * r, rx: 3 }, g);
      sprite(t.type === 'jewel' ? 'gem' : 'sensor', x, y, 1.45 * r, g, t.type === 'jewel' ? 'gem' : 'radar');
    }
    if (t.recon && !t.faceUp) sprite('eye', x + r - 1, y - r + 1, 8, g, 'seen');
    // The Attacker's current jewel odds for this token (public information).
    if (ui.state && !t.faceUp && !hasStone && !(ui.role === 'attacker' && t.type !== 'unknown')) {
      const odds = RF.attackerJewelOdds(ui.state)[c];
      if (odds != null) el('text', { class: 't-odds', x, y: y + r + 9, 'text-anchor': 'middle' }, g).textContent = Math.round(odds * 100) + '%';
    }
  }

  function cellTitle(i) {
    const reg = RF.REGION[i];
    const s = ui.state;
    let t = RF.cellName(i) + ': ';
    if (RF.isInfra(i)) t += reg + ' (' + RF.INFRA[reg] + '), infrastructure service' + (s && s.hardened[i] ? ', HARDENED' : '');
    else t += 'app ' + reg + ', ' + RF.APPS[reg].name + (RF.APPS[reg].internetFacing ? ' (internet-facing)' : '') + (s && s.fenced[reg] ? ', ring-fenced' : '');
    return t;
  }

  function cellInfo(i) {
    const atk = ui.role === 'attacker' && ui.phase !== 'over';
    const s = atk && ui.state ? RF.attackerView(ui.state) : ui.state;
    let text = cellTitle(i) + '.';
    const exits = [];
    if (RF.rowOf(i) === 0) exits.push('internet edge');
    if (RF.REGION[i] === 'H') exits.push('internet-facing');
    if (RF.isInfra(i) && !(s && s.hardened[i])) exits.push('unhardened infra (hub and exit)');
    if (exits.length) text += ' Exit: ' + exits.join(', ') + '.';
    const t = s && s.tokens[i];
    if (t) {
      text += ' Token: ' + (t.faceUp ? 'revealed ' : 'face-down ') + (t.type === 'unknown' ? 'token' : t.type) + '.';
      if (!t.faceUp) {
        const odds = Math.round(RF.attackerJewelOdds(s)[i] * 100);
        if (atk) text += t.recon ? ' You scouted it.' : ' Odds it is a jewel: ' + odds + '%. Recon it from a neighbouring stone to find out for sure.';
        else text += t.recon ? ' The Attacker has scouted it and knows what it is.' : ' The Attacker thinks it is a jewel with ' + odds + '% odds.';
      }
    }
    const other = (n) => RF.cellName(n.cell) + ' (' + (RF.APPS[RF.REGION[n.cell]] ? RF.APPS[RF.REGION[n.cell]].name : RF.REGION[n.cell]) + ')';
    const seen = RF.NEIGHBORS[i].filter((n) => s && s.discovered[n.key] && !s.allows[n.key]).map(other);
    const allowed = RF.NEIGHBORS[i].filter((n) => s && s.allows[n.key]).map(other);
    if (seen.length) text += ' Observed flow, not allowed yet, to ' + seen.join(', ') + '.';
    if (allowed.length) text += ' Exception open to ' + allowed.join(', ') + '.';
    return text;
  }

  function renderPanel() {
    const s = ui.state;
    const status = $('status');
    const pips = $('pips');
    status.className = 'status';
    pips.className = 'pips';
    $('setup-panel').hidden = ui.phase !== 'setup';
    $('action-panel').hidden = ui.phase === 'setup' || ui.phase === 'title';
    if (ui.phase === 'title') {
      status.textContent = 'Choose your side';
      pips.innerHTML = '';
      $('meters').innerHTML = '';
      $('threat').hidden = true;
      renderLog();
      return;
    }

    if (ui.phase === 'setup') {
      status.textContent = 'Setup: hide your Crown Jewels';
      pips.innerHTML = '';
      const err = RF.validateSetup(ui.setup);
      const msg = $('setup-msg');
      const exposed = err ? [] : RF.exposedJewels(ui.setup);
      msg.textContent = err || (exposed.length
        ? '⚠ The jewel on ' + exposed.map(RF.cellName).join(' and ') + ' is next to a breach point (row 1 or the storefront H). The Attacker can reach it on its first turn. You can still start.'
        : 'Ready. You go first.');
      msg.className = 'setup-msg ' + (err ? 'bad' : exposed.length ? 'warn' : 'ok');
      $('btn-start').disabled = !!err;
      $('meters').innerHTML = '';
      renderThreat();
      renderLog();
      return;
    }

    const atkRole = ui.role === 'attacker';
    $('actions').hidden = atkRole;
    $('actions-atk').hidden = !atkRole;
    $('btn-undo').hidden = atkRole;
    if (atkRole) return renderAttackerPanel();
    const myTurn = s.turn === 'defender' && !s.winner;
    if (s.winner) status.textContent = s.winner === 'defender' ? 'You win!' : 'The Attacker wins';
    else if (myTurn) status.textContent = 'Round ' + s.round + ' of ' + RF.CONFIG.roundLimit + ': your move';
    else {
      status.textContent = 'Round ' + s.round + ': the Attacker is moving…';
      status.classList.add('attacker');
      pips.classList.add('attacker');
    }
    pips.innerHTML = '';
    for (let n = 0; n < (s.turn === 'attacker' ? RF.CONFIG.attackerActions : RF.CONFIG.actionsPerTurn); n++) {
      const p = document.createElement('span');
      p.className = 'pip' + (n < s.actionsLeft && !s.winner ? ' on' : '');
      pips.appendChild(p);
    }

    const scorePct = Math.max(0, Math.min(100, (100 * s.score) / RF.CONFIG.scoreTarget));
    const secure = RF.secureApps(s).length;
    const hardenedN = RF.INFRA_CELLS.filter((c) => s.hardened[c]).length;
    const ztRate = secure * RF.CONFIG.ztPerSecureApp + hardenedN * RF.CONFIG.ztPerHardened;
    const income = RF.CONFIG.incomeBase + secure * RF.CONFIG.incomePerSecureApp;
    const blast = RF.ransomedApps(s).length;
    const blastPct = Math.min(100, (100 * blast) / RF.CONFIG.ransomwareApps);
    const hiddenJewels = Object.values(s.tokens).filter((t) => t.type === 'jewel').length;
    $('meters').innerHTML =
      meter('Zero Trust points', s.score + '<small> / ' + RF.CONFIG.scoreTarget + ' · +' + ztRate + '/round</small>', scorePct, '') +
      meter('Blast radius', blast + '<small> / ' + RF.CONFIG.ransomwareApps + ' apps</small>', blastPct, 'danger') +
      meter('Insight', s.insight + '<small> · +' + income + ' next turn</small>', null, '') +
      meter('Round', s.round + '<small> / ' + RF.CONFIG.roundLimit + '</small>', null, '') +
      '<div class="meter wide"><span>Secure apps <b>' + secure + '</b></span><span>Hardened <b>' + hardenedN + '/3</b></span><span>Outages <b' +
      (s.outages ? ' class="bad"' : '') + '>' + s.outages + '</b></span><span>Sensors <b>' + s.pool.sensor +
      '</b></span><span>Walls <b>' + s.wallsLeft + '</b></span><span>Jewels hidden <b>' + hiddenJewels + '</b></span></div>';

    // Action buttons.
    const can = {
      observe: Object.keys(RF.APPS).some((a) => s.observed[a] == null) && s.insight >= RF.CONFIG.observeCost,
      assess: true,
      harden: s.insight >= RF.CONFIG.hardenCost && RF.INFRA_CELLS.some((c) => !s.hardened[c]),
      segment: s.insight >= RF.CONFIG.segmentCost && s.wallsLeft > 0 && RF.wallableEdges(s).length > 0,
      allow: true,
      ringfence: Object.keys(RF.APPS).some((a) => !s.fenced[a] && s.insight >= RF.ringfenceCost(a)),
      deploy: s.insight >= RF.CONFIG.deployCost && s.pool.sensor > 0,
      swap: !s.swappedThisTurn && s.swapsUsed < RF.CONFIG.swapsPerGame && s.insight >= RF.CONFIG.swapCost,
      isolate: s.insight >= RF.CONFIG.isolateCost && s.wallsLeft > 0,
    };
    const active = myTurn && !ui.busy && ui.phase === 'play';
    document.querySelectorAll('#actions .act').forEach((b) => {
      const a = b.dataset.action;
      b.disabled = !active || s.actionsLeft <= 0 || !can[a];
      b.classList.toggle('active', ui.mode === a);
    });
    $('btn-undo').disabled = !active || ui.undo.length === 0;
    const end = $('btn-end');
    end.disabled = !active;
    end.classList.toggle('pulse', active && s.actionsLeft === 0);
    renderHint(active);
    renderThreat();
    renderLog();
  }

  // The panel when you play the Attacker.
  function renderAttackerPanel() {
    const s = ui.state;
    const status = $('status');
    const pips = $('pips');
    const myTurn = s.turn === 'attacker' && !s.winner;
    if (s.winner) status.textContent = s.winner === 'attacker' ? 'You win!' : 'The Defender wins';
    else if (myTurn) status.textContent = 'Round ' + s.round + ' of ' + RF.CONFIG.roundLimit + ': your move';
    else status.textContent = 'Round ' + s.round + ': the Defender is moving…';
    status.classList.toggle('attacker', myTurn);
    pips.classList.toggle('attacker', true);
    pips.innerHTML = '';
    for (let n = 0; n < (s.turn === 'attacker' ? RF.CONFIG.attackerActions : RF.CONFIG.actionsPerTurn); n++) {
      const p = document.createElement('span');
      p.className = 'pip' + (n < s.actionsLeft && !s.winner ? ' on' : '');
      pips.appendChild(p);
    }
    const secure = RF.secureApps(s).length;
    const hardenedN = RF.INFRA_CELLS.filter((c) => s.hardened[c]).length;
    const ztRate = secure * RF.CONFIG.ztPerSecureApp + hardenedN * RF.CONFIG.ztPerHardened;
    const blast = RF.ransomedApps(s).length;
    const found = Object.values(s.tokens).filter((t) => t.faceUp && t.type === 'jewel').length;
    const fencedN = Object.keys(s.fenced).filter((a) => s.fenced[a]).length;
    $('meters').innerHTML =
      meter('Your blast radius', blast + '<small> / ' + RF.CONFIG.ransomwareApps + ' apps</small>', Math.min(100, (100 * blast) / RF.CONFIG.ransomwareApps), 'danger') +
      meter('Defender Zero Trust', s.score + '<small> / ' + RF.CONFIG.scoreTarget + ' · +' + ztRate + '/round</small>', Math.max(0, Math.min(100, (100 * s.score) / RF.CONFIG.scoreTarget)), '') +
      meter('Stones', s.stonesLeft + '<small> in hand</small>', null, '') +
      meter('Round', s.round + '<small> / ' + RF.CONFIG.roundLimit + '</small>', null, '') +
      '<div class="meter wide"><span>Jewels found <b>' + found + '</b></span><span>Sensors hit <b' + (ui.stats.sensorHits ? ' class="bad"' : '') + '>' + ui.stats.sensorHits +
      '</b></span><span>Breach <b>' + (s.breachUsed || !myTurn ? 'used' : 'ready') + '</b></span><span>Def. Insight <b>' + s.insight + '</b></span><span>Fenced <b>' + fencedN +
      '</b></span><span>Hardened <b>' + hardenedN + '/3</b></span></div>';

    const active = myTurn && !ui.busy && ui.phase === 'play';
    const n = { move: legalFor('move').size, recon: legalFor('recon').size, exfil: legalFor('exfil').size };
    document.querySelectorAll('#actions-atk .act').forEach((b) => {
      const m = b.dataset.amode;
      b.disabled = !active || (m !== 'hint' && !n[m]);
      b.classList.toggle('active', ui.amode === m);
      b.classList.toggle('pulse', m === 'exfil' && active && n.exfil > 0);
    });
    const end = $('btn-end');
    end.disabled = !active;
    end.classList.toggle('pulse', active && !n.move && !n.recon && !n.exfil);
    const hint = $('hint');
    let html;
    if (ui.phase === 'over') html = ui.selected != null ? esc(cellInfo(ui.selected)) : 'Game over. Every token and flow is now revealed. Tap cells to review them.';
    else if (!active) html = ui.selected != null ? esc(cellInfo(ui.selected)) : 'The Defender bot is moving. Watch the board and the log.';
    else if (ui.hint) {
      html = '<b>Hint:</b> ' + esc(describeAttack(ui.hint)) + '.' +
        '<div class="row"><button class="btn primary" data-hint="do-hint" type="button">Do it</button><button class="btn" data-hint="cancel" type="button">Dismiss</button></div>';
    } else if (ui.amode === 'move') {
      html = '<b>🦠 Move.</b> Tap a highlighted cell. ' + (s.breachUsed ? '' : '<b>Breach</b> in from row 1 or the storefront H (once per turn), or ') +
        '<b>spread</b> from your stones. ×2 means crossing into another app, through an allowed flow or a service backdoor, costs extra actions. Face-down tokens might be Sensors!';
      if (n.exfil) html += ' <b class="bad">A jewel is ready: tap EXFIL to win.</b>';
      if (ui.selected != null) html += '<div class="small muted" style="margin-top:6px">' + esc(cellInfo(ui.selected)) + '</div>';
    } else if (ui.amode === 'recon') {
      html = '<b>🔍 Recon.</b> Tap a face-down token next to one of your stones to learn whether it is a Jewel or a Sensor (1 action).';
    } else if (ui.amode === 'exfil') {
      html = '<b>💾 Exfil.</b> Tap your stone on a revealed jewel. Its group needs a route to an exit: row 1, the storefront H, or an unhardened DNS.';
    }
    hint.innerHTML = html;
    renderAttackerIntel();
    renderLog();
  }

  // Attacker role: a short briefing instead of the Defender's threat box.
  function renderAttackerIntel() {
    const box = $('threat');
    const s = ui.state;
    if (!s || ui.phase !== 'play' || s.winner) { box.hidden = true; return; }
    box.hidden = false;
    const v = RF.attackerView(s);
    const odds = RF.attackerJewelOdds(v);
    const found = Object.keys(s.tokens).filter((c) => s.tokens[c].faceUp && s.tokens[c].type === 'jewel').map(Number);
    const bets = Object.keys(odds).map(Number).filter((c) => !v.tokens[c].faceUp && v.tokens[c].type !== 'sensor')
      .sort((a, b) => odds[b] - odds[a]).slice(0, 3);
    const lines = [];
    let lvl = 'calm';
    found.forEach((c) => {
      const t = s.tokens[c];
      const out = RF.groupHasExit(s, RF.groupOf(s, c));
      if (t.revealedRound === s.round && s.turn === 'attacker') lines.push('💎 Jewel on <b>' + RF.cellName(c) + '</b> found. Keep a route to an exit open: you can exfiltrate it next turn.');
      else if (out) { lines.push('💎 Jewel on <b>' + RF.cellName(c) + '</b> is ready to <b>exfiltrate</b>!'); lvl = 'danger'; }
      else lines.push('💎 Jewel on <b>' + RF.cellName(c) + '</b>: its group has no route to an exit. Connect it to row 1, H or an unhardened DNS.');
    });
    if (bets.length) lines.push('Best bets for a jewel: ' + bets.map((c) => '<b>' + RF.cellName(c) + '</b> ' + Math.round(odds[c] * 100) + '%').join(', ') + '.');
    const held = RF.ransomedApps(s).length;
    lines.push('Ransomware: footholds in <b>' + held + '</b> of ' + RF.CONFIG.ransomwareApps + ' apps' + (held >= RF.CONFIG.ransomwareApps - 2 ? ' (close!)' : '') + '.');
    const dns = RF.INFRA_CELL.DNS;
    if (!s.hardened[dns]) lines.push('<span class="muted">DNS is unhardened: it is a backdoor into ' + RF.INFRA_USERS.DNS.join(' ') + ' and an exit (DNS tunnelling).</span>');
    box.className = 'threat-box intel ' + lvl;
    box.innerHTML = '<b>Intel</b><div class="small" style="margin-top:4px">' + lines.join('<br>') + '</div>';
  }

  function meter(k, v, pct, cls) {
    return '<div class="meter ' + cls + '"><div class="k">' + k + '</div><div class="v">' + v + '</div>' +
      (pct == null ? '' : '<div class="bar"><span style="width:' + pct + '%"></span></div>') + '</div>';
  }

  function renderHint(active) {
    const hint = $('hint');
    const s = ui.state;
    let html = '';
    if (ui.phase === 'over') {
      html = ui.selected != null ? esc(cellInfo(ui.selected)) : 'Game over. Tap cells to review them.';
    } else if (!active) {
      html = ui.selected != null ? esc(cellInfo(ui.selected)) : 'Watch the Attacker’s moves appear on the board and in the log.';
    } else if (ui.mode === 'harden') {
      html = 'Tap <b>NTP</b>, <b>DNS</b> or <b>LDAP</b> to harden it.' + cancelBtn();
    } else if (ui.mode === 'segment') {
      const n = ui.pending.length;
      const cost = RF.segmentCost(n);
      html = 'Tap any number of highlighted edges, then place them all in one action (' + RF.CONFIG.segmentCost + ' Insight per ' + RF.CONFIG.wallsPerInsight +
        ' walls; ' + s.wallsLeft + ' left in your supply). Observed flows can’t be walled. Walling a flow you haven’t observed yet causes an outage.' +
        '<div class="row">' + (n ? '<button class="btn primary" data-hint="commit" type="button"' + (s.insight >= cost ? '' : ' disabled') + '>Place ' + n + ' wall' +
        (n > 1 ? 's' : '') + ' (' + cost + ' Insight)</button>' : '') +
        '<button class="btn" data-hint="cancel" type="button">Cancel</button></div>';
    } else if (ui.mode === 'allow' && !ui.draft) {
      html = '<b>Allow.</b> Ring-fencing already allows observed flows. Use this to add exceptions later: flows Security Intelligence found after you locked an app down, or manual guesses (+' +
        RF.CONFIG.manualExceptionCost + ' Insight each). Tap an app to open its recommendation.' + cancelBtn();
    } else if (ui.mode === 'allow') {
      const d = ui.draft;
      const edges = [...d.edges].filter((k) => !s.allows[k]);
      const rec = edges.filter((k) => s.discovered[k]).length;
      const manual = edges.length - rec;
      const cost = RF.allowCost(s, edges);
      const already = RF.appBorderEdges(d.app).filter((k) => s.allows[k]).length;
      html = '<b>Exceptions for app ' + d.app + ' (' + esc(RF.APPS[d.app].name) + ')</b><br>' +
        'Recommended: <b>' + rec + '</b> observed flow' + (rec === 1 ? '' : 's') + '. Manual: <b>' + manual + '</b>. Already open: ' + already + '.<br>' +
        '<span class="muted small">Tap border edges to add or remove exceptions. Every exception is a path the Attacker can use too. Month-end flows stay invisible until round ' + RF.CONFIG.rareSeenRound + '.</span>' +
        '<div class="row"><button class="btn primary" data-hint="publish" type="button"' + (edges.length && s.insight >= cost ? '' : ' disabled') + '>Publish ' + edges.length +
        ' (' + cost + ' Insight)</button><button class="btn" data-hint="cancel" type="button">Cancel</button></div>';
    } else if (ui.mode === 'ringfence' && ui.draft) {
      const app = ui.draft.app;
      const border = RF.appBorderEdges(app);
      const open = border.filter((k) => s.allows[k]).length;
      const blocked = border.filter((k) => !s.allows[k] && !s.walls[k] && RF.isOpen(s, k)).length;
      const rec = RF.recommendedExceptions(s, app).length;
      const cost = RF.ringfenceCost(app);
      const early = s.observed[app] !== -1;
      const noRare = false;
      html = '<b>Lock down app ' + app + ' (' + esc(RF.APPS[app].name) + ')</b><br>Security Intelligence will allow <b>' + rec + '</b> observed flow' + (rec === 1 ? '' : 's') +
        (open ? ' (' + open + ' exception' + (open === 1 ? '' : 's') + ' already open)' : '') + '. ' + (blocked - rec) + ' other edge' + (blocked - rec === 1 ? '' : 's') + ' will be blocked.' +
        (early ? '<br><span class="bad">⚠ You haven’t observed this app' + (s.observed[app] != null ? ' yet (its flows show next turn)' : '') +
          ': any business flow here will break (−' + RF.CONFIG.outagePenalty + ' points each).</span>'
          : noRare ? '<br><span class="muted small">Month-end flows aren’t visible until round ' + RF.CONFIG.rareSeenRound + '. If one crosses this border it will break when it first runs.</span>' : '') +
        '<div class="row"><button class="btn primary" data-hint="fence" type="button"' + (s.insight >= cost ? '' : ' disabled') + '>Lock down (' + cost +
        ' Insight)</button><button class="btn" data-hint="cancel" type="button">Cancel</button></div>';
    } else if (ui.mode === 'ringfence') {
      html = '<b>◎ Ring-fence.</b> Tap an app to preview the lockdown. Observed flows are allowed automatically, everything else is blocked. ' +
        'A secure (clean) fenced app earns +1 Zero Trust and +1 Insight every round. Remember its shared services: an unhardened one is still a backdoor in. Affordable now: ' +
        (Object.keys(RF.APPS).filter((a) => !s.fenced[a] && s.insight >= RF.ringfenceCost(a))
          .map((a) => a + ' (' + RF.ringfenceCost(a) + ')').join(', ') || 'none') + '.' + cancelBtn();
    } else if (ui.mode === 'deploy') {
      html = 'Tap an empty cell to place a face-down Sensor (' + s.pool.sensor + ' left). The Attacker sees you place it, so it knows it’s a Sensor, unless you later swap it.' + cancelBtn();
    } else if (ui.mode === 'observe') {
      html = '<b>👁 Observe.</b> Tap an app. Security Intelligence maps its business flows, and they show at the start of your next turn. ' +
        'Ring-fencing an observed app allows exactly those flows, with no outages.' + cancelBtn();
    } else if (ui.mode === 'isolate') {
      const k = ui.draft && ui.draft.edge;
      if (!k) {
        html = '<b>⛔ Isolate.</b> Emergency block on <b>any</b> edge, even a known business flow or an allowed exception, for ' + RF.CONFIG.isolateCost +
          ' Insight. If a business flow runs there, that’s an outage (−' + RF.CONFIG.outagePenalty + ' score) and it stays broken. Tap an edge.' + cancelBtn();
      } else {
        const e = RF.EDGES[k];
        const known = s.discovered[k];
        html = '<b>Isolate ' + RF.cellName(e.a) + '–' + RF.cellName(e.b) + '?</b><br>' +
          (known ? '<span class="bad">This is a known business flow: blocking it is an outage (−' + RF.CONFIG.outagePenalty + ' score).</span>'
            : 'Security Intelligence hasn’t seen a flow here. If one exists, it becomes an outage.') +
          '<div class="row"><button class="btn primary" data-hint="isolate" type="button">Isolate (' + RF.CONFIG.isolateCost + ' Insight)</button>' +
          '<button class="btn" data-hint="cancel" type="button">Cancel</button></div>';
      }
    } else if (ui.mode === 'swap') {
      const d = ui.draft || {};
      const cost = [RF.CONFIG.swapCost ? RF.CONFIG.swapCost + ' Insight' : null, RF.CONFIG.swapScorePenalty ? '−' + RF.CONFIG.swapScorePenalty + ' score' : null].filter(Boolean).join(', ') || 'free';
      if (d.b == null) {
        html = '<b>Swap.</b> Tap two face-down tokens (not next to an attacker stone). You’ll then choose whether they really swap or you only pretend. The Attacker can’t tell, so its odds for both become the average. Cost: ' + cost + '.' + cancelBtn();
      } else {
        const ta = s.tokens[d.a];
        const tb = s.tokens[d.b];
        html = '<b>' + RF.cellName(d.a) + ' (' + ta.type + ') ⇄ ' + RF.cellName(d.b) + ' (' + tb.type + ')</b><br>Cost: ' + cost + '. Either way, the Attacker loses what it scouted on these two.' +
          '<div class="row"><button class="btn primary" data-hint="swap-real" type="button">Really swap</button>' +
          '<button class="btn" data-hint="swap-bluff" type="button">Bluff (don’t move)</button></div>' + cancelBtn();
      }
    } else if (s.actionsLeft === 0) {
      html = 'No actions left. Tap <b>End turn</b>, or Undo to change your mind.';
    } else if (ui.selected != null) {
      html = esc(cellInfo(ui.selected));
    } else {
      html = 'Pick an action. Tap any cell to inspect it.';
    }
    hint.innerHTML = html;
  }

  const cancelBtn = () => '<div class="row"><button class="btn" data-hint="cancel" type="button">Cancel</button></div>';

  function renderLog() {
    const ol = $('log');
    ol.innerHTML = ui.log
      .slice()
      .reverse()
      .map((l) => '<li class="' + l.who + (l.big ? ' big' : '') + '">' + esc(l.text) + '</li>')
      .join('');
  }

  function addLog(who, text, big) {
    ui.log.push({ who, text, big: !!big });
  }

  // ---------------------------------------------------------------- misc

  function esc(t) {
    return String(t).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
  }

  let toastTimer = null;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 2600);
  }

  const show = (id) => ($(id).hidden = false);
  const hide = (id) => ($(id).hidden = true);

  // ---------------------------------------------------------------- wire

  function wire() {
    $('board').addEventListener('click', onBoardClick);
    $('actions').addEventListener('click', (e) => {
      const b = e.target.closest('[data-action]');
      if (b && !b.disabled) pickMode(b.dataset.action);
    });
    $('hint').addEventListener('click', (e) => {
      const b = e.target.closest('[data-hint]');
      if (!b) return;
      const h = b.dataset.hint;
      if (h === 'cancel') { ui.mode = null; ui.pending = []; ui.draft = null; }
      else if (h === 'publish') return publishAllow();
      else if (h === 'isolate' && ui.draft && ui.draft.edge) return defenderDo({ type: 'isolate', edge: ui.draft.edge });
      else if (h === 'fence') return confirmFence();
      else if (h === 'do-hint' && ui.hint) return ui.hint.type === 'endTurn' ? endAttackerTurn() : attackerDo(ui.hint);
      if (h === 'cancel') ui.hint = null;
      else if (h === 'commit' && ui.pending.length) return defenderDo({ type: 'segment', edges: ui.pending.slice() });
      else if (h === 'swap-real' || h === 'swap-bluff')
        return defenderDo({ type: 'swap', a: ui.draft.a, b: ui.draft.b, really: h === 'swap-real' });
      render();
    });
    $('threat').addEventListener('click', (e) => {
      const b = e.target.closest('[data-suggest]');
      const sg = b && ui.suggestions && ui.suggestions[+b.dataset.suggest];
      if (sg) defenderDo(sg.action);
    });
    $('actions-atk').addEventListener('click', (e) => {
      const b = e.target.closest('[data-amode]');
      if (b && !b.disabled) pickAttackerMode(b.dataset.amode);
    });
    $('btn-undo').addEventListener('click', undo);
    $('btn-end').addEventListener('click', () => (ui.role === 'attacker' ? endAttackerTurn() : endDefenderTurn()));
    $('btn-random').addEventListener('click', () => { ui.setup = RF.randomSetup(rng); render(); });
    $('btn-start').addEventListener('click', startGame);
    $('btn-new').addEventListener('click', () => {
      if (ui.phase === 'play' && !confirm('Abandon this game and start a new one?')) return;
      showTitle();
    });
    $('btn-again').addEventListener('click', newGame);
    $('btn-switch').addEventListener('click', showTitle);
    $('title-roles').addEventListener('click', (e) => {
      const b = e.target.closest('[data-role]');
      if (b) chooseRole(b.dataset.role);
    });
    $('title-level').addEventListener('click', (e) => {
      const b = e.target.closest('[data-level]');
      if (!b) return;
      settings.level = b.dataset.level;
      saveSettings();
      $('set-level').value = settings.level;
      SND.play('click');
      renderTitle();
    });
    $('title-rules').addEventListener('click', () => show('overlay-rules'));
    // Browsers only start audio after a user gesture.
    document.addEventListener('pointerdown', () => SND.unlock(), { once: true });
    document.addEventListener('keydown', () => SND.unlock(), { once: true });
    SND.setMuted(settings.muted);
    SND.setMusic(settings.music);
    document.querySelectorAll('[data-sound]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.sound === 'mute') {
        settings.muted = !settings.muted;
        SND.setMuted(settings.muted);
      } else {
        settings.music = !settings.music;
        SND.setMusic(settings.music);
      }
      saveSettings();
      renderSoundButtons();
      SND.play('click');
    }));
    $('btn-review').addEventListener('click', () => hide('overlay-end'));
    $('btn-rules').addEventListener('click', () => show('overlay-rules'));
    $('btn-rules-close').addEventListener('click', () => hide('overlay-rules'));
    ['overlay-rules', 'overlay-end'].forEach((id) =>
      $(id).addEventListener('click', (e) => { if (e.target.id === id) hide(id); })
    );

    const level = $('set-level');
    const speed = $('set-speed');
    const reasoning = $('set-reasoning');
    const threatBox = $('set-threat');
    threatBox.checked = !!settings.showThreat;
    threatBox.addEventListener('change', () => { settings.showThreat = threatBox.checked; saveSettings(); render(); });

    $('rate').addEventListener('click', (e) => {
      const b = e.target.closest('[data-rate]');
      if (!b || !ui.record) return;
      ui.record.rating = +b.dataset.rate;
      document.querySelectorAll('#rate [data-rate]').forEach((x) => x.classList.toggle('sel', x === b));
      saveRecord();
      toast('Thanks! Rating saved.');
    });
    $('fb-comment').addEventListener('change', () => {
      if (!ui.record) return;
      ui.record.comment = $('fb-comment').value.trim();
      saveRecord();
    });
    $('btn-dl-game').addEventListener('click', () => {
      if (!ui.record) return;
      ui.record.comment = $('fb-comment').value.trim();
      saveRecord();
      download('ringfence-game-' + stamp() + '.json', ui.record);
    });
    const dlAll = () => download('ringfence-playtests-' + stamp() + '.json', loadHistory());
    $('btn-dl-all').addEventListener('click', dlAll);
    $('btn-pt-dl').addEventListener('click', dlAll);
    $('btn-pt-clear').addEventListener('click', () => {
      if (!confirm('Delete all saved playtest records in this browser?')) return;
      try { localStorage.removeItem('ringfence.playtests'); } catch (e) { /* ignore */ }
      renderPlaytestCount();
    });
    renderPlaytestCount();


    level.value = settings.level;
    speed.value = settings.speed;
    reasoning.checked = !!settings.reasoning;
    level.addEventListener('change', () => { settings.level = level.value; saveSettings(); });
    speed.addEventListener('change', () => { settings.speed = speed.value; saveSettings(); });
    reasoning.addEventListener('change', () => { settings.reasoning = reasoning.checked; saveSettings(); });

    document.addEventListener('keydown', (e) => {
      if (e.target.closest('select, input')) return;
      if (e.key === 'Escape') {
        hide('overlay-rules');
        ui.hint = null;
        ui.mode = null;
        ui.pending = [];
        ui.draft = null;
        return render();
      }
      if (ui.phase !== 'play') return;
      if (ui.role === 'attacker') {
        const amap = { 1: 'move', 2: 'recon', 3: 'exfil', h: 'hint', H: 'hint' };
        if (amap[e.key]) {
          const b = document.querySelector('#actions-atk [data-amode="' + amap[e.key] + '"]');
          if (b && !b.disabled) pickAttackerMode(amap[e.key]);
        } else if (e.key === 'e' || e.key === 'E') endAttackerTurn();
        return;
      }
      const map = { 1: 'observe', 2: 'harden', 3: 'ringfence', 4: 'deploy', 5: 'isolate' };
      if (map[e.key]) {
        const b = document.querySelector('#actions [data-action="' + map[e.key] + '"]');
        if (b && !b.disabled) pickMode(map[e.key]);
      } else if (e.key === 'u' || e.key === 'U') undo();
      else if (e.key === 'e' || e.key === 'E') endDefenderTurn();
    });

  }

  // Pixel sprites in the HTML (title screen, legend).
  function paintSprites() {
    if (!PIX) return;
    document.querySelectorAll('[data-sprite]').forEach((e) => {
      if (!e.firstChild) e.innerHTML = PIX.img(e.dataset.sprite, 44);
    });
    const art = document.querySelector('.title-art');
    if (art && !art.querySelector('img')) art.innerHTML = PIX.img('shield', 40) + PIX.img('gem', 40) + PIX.img('virus', 40);
    const lg = document.querySelector('.lg-stone');
    const u = PIX.url('virus');
    if (lg && u) { lg.style.setProperty('--lg-virus', 'url("' + u + '")'); lg.classList.add('px-ok'); }
  }

  function renderSoundButtons() {
    document.querySelectorAll('[data-sound="mute"]').forEach((b) => {
      b.textContent = settings.muted ? '🔇' : '🔊';
      b.title = settings.muted ? 'Sound off' : 'Sound on';
      b.setAttribute('aria-pressed', String(!settings.muted));
    });
    document.querySelectorAll('[data-sound="music"]').forEach((b) => {
      b.classList.toggle('off', !settings.music);
      b.title = settings.music ? 'Music on' : 'Music off';
      b.setAttribute('aria-pressed', String(settings.music));
    });
  }

  wire();
  paintSprites();
  renderSoundButtons();
  // ?role=attacker or ?role=defender skips the title screen.
  if (params.get('role')) newGame();
  else showTitle();

  // Handy for debugging in the console.
  window.ringfence = { ui, render };
})();
