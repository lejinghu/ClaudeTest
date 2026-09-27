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
  const VERSION = 'v0.8';
  const settings = { role: 'defender', level: 'normal', speed: '600', reasoning: false, swapRule: 'insight', showThreat: true, muted: false, music: true, suggest: true };
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
    isoCell: null, // Isolate: the cell whose edges you can block
    suggest: null, // the suggested next action, cached by suggestKey
    suggestKey: null,
    oppFrom: 0, // log index where the opponent's last turn started
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
    ui.suggestKey = null;
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
    ui.isoCell = null;
    ui.selected = null;
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
    ui.oppFrom = ui.log.length;
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
    render();
  }

  function endAttackerTurn() {
    const s = ui.state;
    if (ui.busy || ui.phase !== 'play' || s.turn !== 'attacker') return;
    if (ui.record) ui.record.turnMs.push(Date.now() - ui.turnStart);
    apply({ type: 'endTurn' }, 'A');
    if (s.winner) return finish();
    runDefenderBot();
  }

  function runDefenderBot() {
    ui.oppFrom = ui.log.length;
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

  // One tap does the only thing you can do there; otherwise show the options.
  function attackerClick(c) {
    const s = ui.state;
    if (ui.busy || s.turn !== 'attacker') {
      ui.selected = ui.selected === c ? null : c;
      return render();
    }
    const items = cellMenu(c);
    if (items.length === 1) return attackerDo(items[0].a);
    ui.selected = ui.selected === c ? null : c;
    render();
  }

  function doSuggestion() {
    const a = suggestion();
    if (!a) return;
    if (ui.role === 'attacker') return a.type === 'endTurn' ? endAttackerTurn() : attackerDo(a);
    return a.type === 'endTurn' ? endDefenderTurn() : defenderDo(a);
  }

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
    if (ui.mode === 'isolate' && edgeEl) return defenderDo({ type: 'isolate', edge: edgeEl.dataset.edge });
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
        return defenderDo({ type: 'ringfence', app: RF.REGION[c] });
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
    ui.isoCell = null;
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
      ['move', 'exfil', 'recon'].forEach((m) => legalFor(m).forEach((a, c) => out.add(c)));
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
        if (s && s.hardened[i]) sprite('shield', cx(i) + CS / 2, cy(i) + 50, 17, cells, 'hard-shield');
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
    // The suggested action, outlined on the board.
    const sug = !ui.mode && ui.selected == null ? suggestion() : null;
    if (sug) {
      const cells = sug.cell != null ? [sug.cell] : sug.app ? RF.APP_CELLS[sug.app] : [];
      cells.forEach((c) => el('rect', { class: 'hint-cell', x: cx(c) + 3, y: cy(c) + 3, width: CS - 6, height: CS - 6, rx: 6, 'pointer-events': 'none' }, pieces));
      if (sug.edge) wallRect(RF.EDGES[sug.edge], 'hint-edge', pieces, 5);
    }
    // Attacker role: moves that cost extra actions, and jewels ready to steal.
    if (s && ui.role === 'attacker' && ui.phase === 'play' && !ui.busy && s.turn === 'attacker') {
      {
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
    let threat = settings.showThreat && s && ui.role === 'defender' && ui.phase === 'play' && s.turn === 'defender' ? AI.defenderThreat(s) : null;
    if (threat && threatLevel(threat) === 'calm') threat = null;
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
      const near = ui.isoCell != null ? new Set(RF.NEIGHBORS[ui.isoCell].map((n) => n.key)) : null;
      for (const key in RF.EDGES) {
        if (s.walls[key] || (near && !near.has(key))) continue;
        wallRect(RF.EDGES[key], 'edge-hint iso', hits, 3);
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
    if (ui.state && ui.role === 'attacker' && t.type === 'unknown' && !hasStone) {
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

  // ------------------------------------------------------------- the dock
  // The panel is one compact "dock": status, four numbers, a coach line
  // (what to do next, or the menu for the cell you tapped), and End turn.
  // Everything else lives in collapsed sections below it.

  function renderPanel() {
    const s = ui.state;
    const status = $('status');
    const pips = $('pips');
    status.className = 'status';
    pips.className = 'pips';
    $('setup-panel').hidden = ui.phase !== 'setup';
    $('dock-buttons').hidden = ui.phase !== 'play' && ui.phase !== 'over';
    $('btn-undo').hidden = ui.role === 'attacker';
    renderLog();
    if (ui.phase === 'title' || ui.phase === 'setup') {
      status.textContent = ui.phase === 'title' ? 'Choose your side' : 'Hide your Crown Jewels';
      pips.innerHTML = '';
      $('chips').innerHTML = '';
      $('coach').innerHTML = '';
      $('meters').innerHTML = '';
      $('threat').hidden = true;
      if (ui.phase === 'setup') renderSetup();
      return;
    }

    const atk = ui.role === 'attacker';
    const mine = atk ? 'attacker' : 'defender';
    const myTurn = s.turn === mine && !s.winner;
    if (s.winner) status.textContent = s.winner === mine ? 'You win!' : (atk ? 'The Defender wins' : 'The Attacker wins');
    else if (myTurn) status.textContent = 'Round ' + s.round + '/' + RF.CONFIG.roundLimit + ' · your move';
    else status.textContent = 'Round ' + s.round + ' · ' + (atk ? 'Defender' : 'Attacker') + ' moving…';
    status.classList.toggle('attacker', atk ? myTurn : !myTurn && !s.winner);
    pips.classList.toggle('attacker', s.turn === 'attacker');
    pips.innerHTML = '';
    for (let n = 0; n < (s.turn === 'attacker' ? RF.CONFIG.attackerActions : RF.CONFIG.actionsPerTurn); n++) {
      const p = document.createElement('span');
      p.className = 'pip' + (n < s.actionsLeft && !s.winner ? ' on' : '');
      pips.appendChild(p);
    }

    const secure = RF.secureApps(s).length;
    const hardenedN = RF.INFRA_CELLS.filter((c) => s.hardened[c]).length;
    const ztRate = secure * RF.CONFIG.ztPerSecureApp + hardenedN * RF.CONFIG.ztPerHardened;
    const income = RF.CONFIG.incomeBase + secure * RF.CONFIG.incomePerSecureApp;
    const blast = RF.ransomedApps(s).length;
    const chip = (k, v, sub, cls) => '<div class="chip ' + (cls || '') + '"><span class="k">' + k + '</span><span class="v">' + v + '</span><span class="sub">' + sub + '</span></div>';
    const zt = chip(atk ? 'Their Zero Trust' : 'Zero Trust', s.score + '<small>/' + RF.CONFIG.scoreTarget + '</small>', '+' + ztRate + ' a round', atk ? 'foe' : 'good');
    const br = chip(atk ? 'Your blast radius' : 'Blast radius', blast + '<small>/' + RF.CONFIG.ransomwareApps + '</small>', 'apps hit', atk ? 'good' : 'foe');
    $('chips').innerHTML = atk
      ? br + zt + chip('Stones', s.stonesLeft, s.breachUsed || !myTurn ? 'breach used' : 'breach ready')
      : zt + br + chip('Insight', s.insight, '+' + income + ' next turn');

    const active = myTurn && !ui.busy && ui.phase === 'play';
    $('btn-undo').disabled = !active || ui.undo.length === 0;
    const end = $('btn-end');
    end.disabled = !active;
    end.classList.toggle('pulse', active && (s.actionsLeft === 0 || (atk && !canAttackAnywhere())));
    renderCoach(active);
    renderDetails();
  }

  function renderSetup() {
    const err = RF.validateSetup(ui.setup);
    const msg = $('setup-msg');
    const exposed = err ? [] : RF.exposedJewels(ui.setup);
    msg.textContent = err || (exposed.length ? '⚠ A jewel on ' + exposed.map(RF.cellName).join(' and ') + ' sits next to a way in. You can still start.' : '');
    msg.className = 'setup-msg ' + (err ? 'bad' : exposed.length ? 'warn' : 'ok');
    $('btn-start').disabled = !!err;
  }

  const canAttackAnywhere = () => ['move', 'recon', 'exfil'].some((m) => legalFor(m).size > 0);

  // The suggested next action, cached per position.
  function suggestion() {
    const s = ui.state;
    if (!s || !settings.suggest || ui.busy || s.winner || ui.phase !== 'play') return null;
    const key = s.round + '|' + s.turn + '|' + s.actionsLeft + '|' + ui.log.length;
    if (ui.suggestKey === key) return ui.suggest;
    ui.suggestKey = key;
    ui.suggest = null;
    if (ui.role === 'attacker' && s.turn === 'attacker') {
      ui.suggest = AI.chooseAction(s, { level: 'normal', rng: RF.makeRng('hint' + key) }).action;
    } else if (ui.role === 'defender' && s.turn === 'defender' && s.actionsLeft > 0) {
      ui.suggest = BOT.chooseAction(s, { strategy: 'careful' });
    }
    return ui.suggest;
  }

  // One line on why an action is worth it, in the player's terms.
  function why(a) {
    const s = ui.state;
    switch (a.type) {
      case 'observe': return 'Security Intelligence maps its business flows by your next turn, so you can fence it without breaking anything.';
      case 'harden': return 'Closes the backdoor into apps ' + RF.INFRA_USERS[RF.REGION[a.cell]].join(' ') + (RF.REGION[a.cell] === 'DNS' ? ', and the DNS exit' : '') + '. +1 Zero Trust every round.';
      case 'ringfence': return s.observed[a.app] === -1
        ? 'Allows its mapped flows and blocks everything else. A clean fenced app earns +1 Zero Trust and +1 Insight every round.'
        : '⚠ Not mapped yet: its business flows will break (−' + RF.CONFIG.outagePenalty + ' each). Observe it first.';
      case 'deploy': return 'A hidden trap. An attacker stepping on it is removed and loses the rest of its turn.';
      case 'isolate': return 'Emergency block on the Attacker’s route. If a business flow runs there, it’s an outage (−' + RF.CONFIG.outagePenalty + ').';
      case 'breach': return 'Get a foothold from the internet (once per turn).';
      case 'spread': { const n = RF.spreadCost(s, a.cell); return 'Spread toward the jewels and more apps' + (n > 1 ? ', ' + n + ' actions to get across.' : '.'); }
      case 'recon': return 'Find out whether that token is a Crown Jewel or a Sensor trap.';
      case 'exfil': return 'Steal the jewel and win!';
      default: return ui.role === 'attacker' ? 'Nothing useful left to do this turn.' : 'Save your Insight for next turn.';
    }
  }

  function label(a) {
    const c = a.cell != null ? RF.cellName(a.cell) : '';
    switch (a.type) {
      case 'observe': return '👁 Observe app ' + a.app;
      case 'harden': return '🛡 Harden ' + RF.REGION[a.cell];
      case 'ringfence': return '◎ Ring-fence app ' + a.app;
      case 'deploy': return '★ Sensor on ' + c;
      case 'isolate': { const e = RF.EDGES[a.edge]; return '⛔ Isolate ' + RF.cellName(e.a) + '–' + RF.cellName(e.b); }
      case 'breach': return '🦠 Breach ' + c;
      case 'spread': return '🦠 Spread to ' + c;
      case 'recon': return '🔍 Recon ' + c;
      case 'exfil': return '💾 Exfiltrate ' + c;
      default: return 'End turn';
    }
  }

  function cost(a) {
    const C = RF.CONFIG;
    switch (a.type) {
      case 'observe': return C.observeCost ? C.observeCost + ' Insight' : 'free';
      case 'harden': return C.hardenCost + ' Insight';
      case 'ringfence': return RF.ringfenceCost(a.app) + ' Insight';
      case 'deploy': return C.deployCost + ' Insight';
      case 'isolate': return C.isolateCost + ' Insight';
      case 'spread': { const n = RF.spreadCost(ui.state, a.cell); return n + ' action' + (n > 1 ? 's' : ''); }
      case 'breach': case 'recon': return '1 action';
      case 'exfil': return 'wins';
      default: return '';
    }
  }

  // What you can do on a cell you tapped.
  function cellMenu(c) {
    const s = ui.state;
    const out = [];
    if (ui.role === 'attacker') {
      ['exfil', 'move', 'recon'].forEach((m) => { const a = legalFor(m).get(c); if (a) out.push({ a }); });
      return out;
    }
    const legal = (a) => RF.act(RF.clone(s), a);
    const push = (a) => {
      if (!RF.CONFIG.enabledActions.includes(a.type)) return;
      const r = legal(a);
      out.push({ a, off: r.ok ? null : r.error });
    };
    if (RF.isInfra(c)) {
      if (!s.hardened[c]) push({ type: 'harden', cell: c });
    } else {
      const app = RF.REGION[c];
      if (s.observed[app] == null) push({ type: 'observe', app });
      if (!s.fenced[app]) push({ type: 'ringfence', app });
      if (!s.stones[c] && !s.tokens[c]) push({ type: 'deploy', cell: c });
    }
    if (RF.CONFIG.enabledActions.includes('isolate') && RF.NEIGHBORS[c].some((n) => !s.walls[n.key])) {
      out.push({ isolate: c, off: s.insight < RF.CONFIG.isolateCost ? 'Isolate costs ' + RF.CONFIG.isolateCost + ' Insight.' : null });
    }
    return out;
  }

  // Short facts about a cell, for the menu header.
  function cellFacts(c) {
    const atk = ui.role === 'attacker' && ui.phase !== 'over';
    const s = atk ? RF.attackerView(ui.state) : ui.state;
    const reg = RF.REGION[c];
    const facts = [];
    let title;
    if (RF.isInfra(c)) {
      title = RF.cellName(c) + ' · ' + reg + ' service';
      facts.push(s.hardened[c] ? '🛡 hardened' : 'backdoor into ' + RF.INFRA_USERS[reg].join(' ') + (reg === 'DNS' ? ' · an exit' : ''));
    } else {
      title = RF.cellName(c) + ' · app ' + reg + ' (' + RF.APPS[reg].name + ')';
      if (s.fenced[reg]) facts.push('◎ fenced');
      if (s.observed[reg] === -1) facts.push('👁 mapped');
      else if (s.observed[reg] != null) facts.push('👁 mapping…');
      else if (!atk) facts.push('not mapped');
      facts.push('uses ' + RF.APPS[reg].uses.join(' '));
      if (RF.APP_CELLS[reg].some((x) => s.stones[x])) facts.push('☣ attacker inside');
    }
    if (RF.isExit(s, c)) facts.push('exit');
    const t = s.tokens[c];
    if (t) {
      if (t.type === 'unknown') facts.push('? token, ' + Math.round(RF.attackerJewelOdds(s)[c] * 100) + '% jewel');
      else facts.push((t.type === 'jewel' ? '💎 ' : '★ ') + (atk ? '' : 'your ') + t.type + (t.faceUp ? ', found' : t.recon ? ', scouted' : ''));
    }
    return { title, facts };
  }

  function renderCoach(active) {
    const s = ui.state;
    const coach = $('coach');
    const atk = ui.role === 'attacker';
    let html = '';
    const sel = ui.selected;
    if (ui.phase === 'over') {
      html = sel != null ? factsHtml(sel) : '<p class="muted">Game over. Every token and flow is revealed. Tap cells to review them.</p>';
    } else if (!active) {
      html = s.turn === (atk ? 'attacker' : 'defender') ? '<p class="muted">Ending your turn…</p>'
        : '<p class="muted">' + (atk ? 'The Defender bot is moving…' : 'The Attacker is moving…') + '</p>' + recentHtml();
    } else if (ui.mode === 'isolate') {
      html = '<p><b>⛔ Isolate.</b> Tap a red edge' + (ui.isoCell != null ? ' next to ' + RF.cellName(ui.isoCell) : '') + ' to block it (' + RF.CONFIG.isolateCost + ' Insight).</p>' +
        '<div class="row"><button class="btn" data-coach="cancel" type="button">Cancel</button></div>';
    } else if (ui.mode) {
      html = '<p>Tap a highlighted cell to ' + ui.mode + '.</p><div class="row"><button class="btn" data-coach="cancel" type="button">Cancel</button></div>';
    } else if (sel != null) {
      const items = cellMenu(sel);
      ui.menuItems = items;
      html = factsHtml(sel);
      if (s.actionsLeft <= 0) html += '<p class="muted">No actions left this turn.</p>';
      else if (!items.length) html += '<p class="muted">' + (atk ? 'You can’t act here right now.' : 'Nothing to do here.') + '</p>';
      else html += '<div class="menu">' + items.map((it, n) => {
        const a = it.a;
        const lbl = a ? label(a) : '⛔ Isolate an edge';
        const c = a ? cost(a) : RF.CONFIG.isolateCost + ' Insight';
        const w = it.off || (a ? why(a) : 'Emergency block on an edge next to this cell. Breaking a business flow costs −' + RF.CONFIG.outagePenalty + '.');
        const warn = a && a.type === 'ringfence' && s.observed[a.app] !== -1;
        return '<button class="menu-item' + (warn ? ' warn' : '') + '" data-menu="' + n + '" type="button"' + (it.off ? ' disabled' : '') + '>' +
          '<span class="mi-top"><b>' + esc(lbl) + '</b><span class="mi-cost">' + esc(c) + '</span></span><span class="mi-why">' + esc(w) + '</span></button>';
      }).join('') + '</div>';
      html += '<button class="linkish" data-coach="close" type="button">Close</button>';
    } else {
      const sug = suggestion();
      if (s.actionsLeft <= 0) html = '<p>No actions left. Tap <b>End turn</b>' + (atk ? '' : ' (or Undo)') + '.</p>';
      else if (sug) {
        html = '<div class="suggest-box"><div><span class="eyebrow">Suggested · or tap the board</span><b>' + esc(label(sug)) + '</b>' +
          (sug.type !== 'endTurn' ? ' <span class="mi-cost">' + esc(cost(sug)) + '</span>' : '') + '<p>' + esc(why(sug)) + '</p></div>' +
          '<button class="btn primary" data-coach="do" type="button">Do it</button></div>';
      } else {
        html = '<p class="tap-tip">' + (atk ? 'Tap a red cell to move there.' : 'Tap an app or a service to act on it.') + '</p>';
      }
      html += recentHtml();
    }
    coach.innerHTML = html;
  }

  function factsHtml(c) {
    const f = cellFacts(c);
    return '<div class="facts"><b>' + esc(f.title) + '</b><span>' + f.facts.map(esc).join(' · ') + '</span></div>';
  }

  // The opponent's last moves, so you can see what just happened.
  function recentHtml() {
    const opp = ui.role === 'attacker' ? 'D' : 'A';
    const since = ui.oppFrom || 0;
    const lines = ui.log.slice(since).filter((l) => l.who === opp);
    if (!lines.length) return '';
    const pick = lines.filter((l) => l.big).concat(lines.filter((l) => !l.big)).slice(0, 2);
    return '<div class="recent"><span class="eyebrow">' + (opp === 'A' ? 'Attacker' : 'Defender') + '’s last turn</span>' +
      pick.map((l) => '<div class="' + (l.big ? 'big' : '') + '">' + esc(l.text.replace(/^(Attacker|Defender): /, '')) + '</div>').join('') + '</div>';
  }

  // The collapsed "Details" section: full numbers and the threat analysis.
  function renderDetails() {
    const s = ui.state;
    const secure = RF.secureApps(s).length;
    const hardenedN = RF.INFRA_CELLS.filter((c) => s.hardened[c]).length;
    const fencedN = Object.keys(s.fenced).filter((a) => s.fenced[a]).length;
    const hidden = Object.values(s.tokens).filter((t) => t.type === 'jewel').length;
    $('meters').innerHTML = '<div class="meter wide"><span>Secure apps <b>' + secure + '</b></span><span>Fenced <b>' + fencedN + '</b></span><span>Hardened <b>' + hardenedN + '/3</b></span>' +
      '<span>Outages <b' + (s.outages ? ' class="bad"' : '') + '>' + s.outages + '</b></span><span>' + (ui.role === 'attacker' ? 'Their Insight' : 'Sensors left') + ' <b>' +
      (ui.role === 'attacker' ? s.insight : s.pool.sensor) + '</b></span><span>Jewels ' + (ui.role === 'attacker' ? 'found' : 'hidden') + ' <b>' +
      (ui.role === 'attacker' ? Object.values(s.tokens).filter((t) => t.faceUp && t.type === 'jewel').length : hidden) + '</b></span></div>';
    if (ui.role === 'attacker') renderAttackerIntel();
    else renderThreat();
  }

  // Attacker role: a short briefing.
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
    found.forEach((c) => {
      const t = s.tokens[c];
      const out = RF.groupHasExit(s, RF.groupOf(s, c));
      if (t.revealedRound === s.round && s.turn === 'attacker') lines.push('💎 Jewel on <b>' + RF.cellName(c) + '</b> found. Keep a route to an exit open: you can steal it next turn.');
      else if (out) lines.push('💎 Jewel on <b>' + RF.cellName(c) + '</b> is ready to <b>exfiltrate</b>!');
      else lines.push('💎 Jewel on <b>' + RF.cellName(c) + '</b> has no route to an exit. Connect it to row 1, H or an unhardened DNS.');
    });
    if (bets.length) lines.push('Best bets for a jewel: ' + bets.map((c) => '<b>' + RF.cellName(c) + '</b> ' + Math.round(odds[c] * 100) + '%').join(', ') + '.');
    lines.push('Ransomware: footholds in <b>' + RF.ransomedApps(s).length + '</b> of ' + RF.CONFIG.ransomwareApps + ' apps.');
    box.className = 'threat-box intel';
    box.innerHTML = '<b>Intel</b><div class="small">' + lines.join('<br>') + '</div>';
  }

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
    $('coach').addEventListener('click', (e) => {
      const m = e.target.closest('[data-menu]');
      if (m && !m.disabled) {
        const it = ui.menuItems && ui.menuItems[+m.dataset.menu];
        if (!it) return;
        if (it.isolate != null) {
          ui.mode = 'isolate';
          ui.isoCell = it.isolate;
          ui.selected = null;
          SND.play('select');
          return render();
        }
        ui.selected = null;
        return ui.role === 'attacker' ? attackerDo(it.a) : defenderDo(it.a);
      }
      const b = e.target.closest('[data-coach]');
      if (!b) return;
      const h = b.dataset.coach;
      if (h === 'do') return doSuggestion();
      if (h === 'cancel') { ui.mode = null; ui.isoCell = null; ui.pending = []; ui.draft = null; }
      if (h === 'close') ui.selected = null;
      SND.play('click');
      render();
    });
    $('threat').addEventListener('click', (e) => {
      const b = e.target.closest('[data-suggest]');
      const sg = b && ui.suggestions && ui.suggestions[+b.dataset.suggest];
      if (sg) defenderDo(sg.action);
    });
    $('btn-undo').addEventListener('click', undo);
    $('btn-end').addEventListener('click', () => (ui.role === 'attacker' ? endAttackerTurn() : endDefenderTurn()));
    $('btn-random').addEventListener('click', () => { ui.setup = RF.randomSetup(rng); render(); });
    $('btn-start').addEventListener('click', startGame);
    $('btn-new').addEventListener('click', () => {
      if (ui.phase === 'play' && !armed($('btn-new'), 'Sure?')) return;
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
    const suggestBox = $('set-suggest');
    suggestBox.checked = settings.suggest !== false;
    suggestBox.addEventListener('change', () => { settings.suggest = suggestBox.checked; ui.suggestKey = null; saveSettings(); render(); });

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
      if (!armed($('btn-pt-clear'), 'Tap again to delete')) return;
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
        ui.selected = null;
        ui.isoCell = null;
        ui.mode = null;
        ui.pending = [];
        ui.draft = null;
        return render();
      }
      if (ui.phase !== 'play') return;
      if (e.key === 'h' || e.key === 'H') return doSuggestion();
      if (ui.role === 'attacker') {
        if (e.key === 'e' || e.key === 'E') endAttackerTurn();
        return;
      }
      const map = { 1: 'observe', 2: 'harden', 3: 'ringfence', 4: 'deploy', 5: 'isolate' };
      if (map[e.key]) pickMode(map[e.key]);
      else if (e.key === 'u' || e.key === 'U') undo();
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

  // Two-tap confirmation, built into the button (some hosts block confirm()).
  function armed(btn, prompt) {
    if (btn.dataset.armed) {
      clearTimeout(+btn.dataset.armed);
      delete btn.dataset.armed;
      btn.textContent = btn.dataset.label;
      return true;
    }
    btn.dataset.label = btn.textContent;
    btn.textContent = prompt;
    btn.dataset.armed = String(setTimeout(() => {
      delete btn.dataset.armed;
      btn.textContent = btn.dataset.label;
    }, 3000));
    return false;
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
  // Keep the page scrollable past the fixed dock on phones.
  if (window.ResizeObserver) {
    new ResizeObserver(() => document.body.style.setProperty('--dock-h', ($('dock').offsetHeight + 12) + 'px')).observe($('dock'));
  }
  paintSprites();
  renderSoundButtons();
  // ?role=attacker or ?role=defender skips the title screen.
  if (params.get('role')) newGame();
  else showTitle();

  // Handy for debugging in the console.
  window.ringfence = { ui, render };
})();
