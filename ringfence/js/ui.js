/*
 * RINGFENCE browser UI: human Defender vs AI Attacker.
 * Renders the board as inline SVG and drives turns through RF.act().
 */
(function () {
  'use strict';
  const RF = window.RF;
  const AI = window.RFAI;
  const $ = (id) => document.getElementById(id);
  const SVGNS = 'http://www.w3.org/2000/svg';

  // Board geometry (SVG user units).
  const CS = 64;
  const ML = 28;
  const MT = 46;
  const W = ML + RF.SIZE * CS + 52;
  const H = MT + RF.SIZE * CS + 10;
  const cx = (i) => ML + RF.colOf(i) * CS;
  const cy = (i) => MT + RF.rowOf(i) * CS;

  // ------------------------------------------------------------ settings

  const params = new URLSearchParams(location.search);
  const settings = { level: 'normal', speed: '600', reasoning: false };
  try {
    Object.assign(settings, JSON.parse(localStorage.getItem('ringfence.settings') || '{}'));
  } catch (e) { /* storage unavailable: defaults are fine */ }
  if (AI.LEVELS[params.get('ai')]) settings.level = params.get('ai');
  const saveSettings = () => {
    try { localStorage.setItem('ringfence.settings', JSON.stringify(settings)); } catch (e) { /* ignore */ }
  };

  let rng = RF.makeRng(params.get('seed') || String(Date.now()));

  // --------------------------------------------------------------- state

  const ui = {
    phase: 'setup', // setup | play | over
    setup: null,
    state: null,
    mode: null, // harden | segment | ringfence | deploy
    pending: [],
    deployKind: 'sensor',
    undo: [],
    log: [],
    recent: new Set(),
    fresh: -1,
    busy: false,
    selected: null,
    stats: null,
  };

  function newStats() {
    return { assess: 0, harden: 0, segment: 0, walls: 0, ringfence: 0, deploy: 0, sensorHits: 0, quarantines: 0, leaks: 0, zone: false, recons: 0 };
  }

  function newGame() {
    ui.phase = 'setup';
    ui.setup = RF.randomSetup(rng);
    ui.state = null;
    ui.mode = null;
    ui.pending = [];
    ui.undo = [];
    ui.log = [];
    ui.recent = new Set();
    ui.selected = null;
    ui.busy = false;
    ui.stats = newStats();
    hide('overlay-end');
    render();
  }

  function startGame() {
    const err = RF.validateSetup(ui.setup);
    if (err) return toast(err);
    ui.state = RF.newGame(ui.setup);
    ui.phase = 'play';
    ui.selected = null;
    addLog('sys', 'Round 1');
    addLog('D', 'Your tokens are hidden. The Attacker can see where they are, but not what they are.');
    render();
  }

  // ------------------------------------------------------------- actions

  function apply(action, who) {
    const res = RF.act(ui.state, action);
    if (!res.ok) {
      toast(res.error);
      return null;
    }
    for (const ev of res.events) {
      let text = ev.text;
      const st = ui.stats;
      if (ev.kind === 'recon') {
        st.recons++;
        const t = ui.state.tokens[ev.cell];
        if (t) text = 'Attacker ran Recon on ' + RF.cellName(ev.cell) + '. They now know it is a ' + t.type.toUpperCase() + '.';
      }
      if (ev.kind === 'sensor') st.sensorHits++;
      if (ev.kind === 'quarantine') st.quarantines++;
      if (ev.kind === 'leak') st.leaks++;
      if (ev.kind === 'zone') st.zone = true;
      if (ev.kind === 'turn') {
        if (ui.state.turn === 'defender') addLog('sys', 'Round ' + ui.state.round);
        continue;
      }
      const big = ['exfil', 'sensor', 'jewel', 'quarantine', 'zone', 'end'].includes(ev.kind);
      addLog(who, (who === 'A' && ev.kind === 'stone' ? 'Attacker: ' : '') + text, big);
    }
    return res;
  }

  function defenderDo(action) {
    if (ui.busy || ui.phase !== 'play' || ui.state.turn !== 'defender') return;
    ui.undo.push({ state: RF.clone(ui.state), log: ui.log.length, stats: Object.assign({}, ui.stats) });
    const res = apply(action, 'D');
    if (!res) {
      ui.undo.pop();
      render();
      return;
    }
    const st = ui.stats;
    if (action.type in st) st[action.type]++;
    if (action.type === 'segment') st.walls += action.edges.length;
    ui.mode = null;
    ui.pending = [];
    render();
  }

  function undo() {
    const snap = ui.undo.pop();
    if (!snap) return;
    ui.state = snap.state;
    ui.log.length = snap.log;
    ui.stats = snap.stats;
    ui.mode = null;
    ui.pending = [];
    render();
  }

  function endDefenderTurn() {
    if (ui.busy || ui.phase !== 'play' || ui.state.turn !== 'defender') return;
    ui.mode = null;
    ui.pending = [];
    ui.undo = [];
    apply({ type: 'endTurn' }, 'D');
    if (ui.state.winner) return finish();
    runAttacker();
  }

  function runAttacker() {
    ui.busy = true;
    ui.recent = new Set();
    render();
    const delay = () => parseInt(settings.speed, 10) || 600;
    const step = () => {
      const s = ui.state;
      if (ui.phase !== 'play') return;
      if (s.winner) return finish();
      if (s.turn !== 'attacker') {
        ui.busy = false;
        ui.fresh = -1;
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

  function finish() {
    ui.phase = 'over';
    ui.busy = false;
    render();
    const s = ui.state;
    const won = s.winner === 'defender';
    $('end-title').textContent = won ? 'You defended the datacenter' : 'The Attacker got away with the data';
    $('end-reason').textContent = s.reason + ' Final score ' + s.score + '/' + RF.CONFIG.scoreTarget +
      ', jewels stolen ' + s.jewelsTaken + '/' + RF.CONFIG.jewelsToWin + ', round ' + Math.min(s.round, RF.CONFIG.roundLimit) + '.';
    const st = ui.stats;
    const hardened = RF.INFRA_CELLS.filter((c) => s.hardened[c]).length;
    const fenced = Object.keys(s.fenced).filter((a) => s.fenced[a]);
    const items = [
      ['Assessed ' + st.assess + '×', 'Stage 1: Security Segmentation Assessment & Report. You can’t segment what you can’t see.'],
      ['Hardened ' + hardened + ' of 3 infrastructure services', 'Stage 2: Infrastructure Services segmentation for DNS, NTP and LDAP. It closes common C2 and exfiltration paths.'],
      [(st.zone ? 'Sealed' : 'Did not seal') + ' the Dev/Prod boundary' + (st.leaks ? ', with ' + st.leaks + ' leakage alert' + (st.leaks > 1 ? 's' : '') : ''), 'Stage 3: Environment (zone) segmentation with leakage alerts.'],
      ['Ring-fenced ' + fenced.length + ' app' + (fenced.length === 1 ? '' : 's') + (fenced.length ? ' (' + fenced.join(', ') + ')' : ''), 'Stage 4: Application microsegmentation. Ring-fence apps, then fine-tune the tiers.'],
      ['Sensors caught the Attacker ' + st.sensorHits + '×', 'SSP threat prevention: distributed IDS/IPS inspects the traffic the firewall allows.'],
    ];
    $('end-debrief').innerHTML = '<h3>In this game you…</h3><ul class="debrief">' +
      items.map(([a, b]) => '<li><b>' + esc(a) + '</b><span>' + esc(b) + '</span></li>').join('') + '</ul>';
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
    if (ui.mode === 'segment' && edgeEl) return segmentClick(edgeEl.dataset.edge);
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
      case 'ringfence':
        if (RF.isInfra(c)) return toast('Infrastructure cells are hardened, not ring-fenced.');
        return defenderDo({ type: 'ringfence', app: RF.REGION[c] });
      case 'deploy':
        return defenderDo({ type: 'deploy', cell: c, kind: ui.deployKind });
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
    ui.pending.push(key);
    const max = Math.min(RF.CONFIG.wallsPerSegment, ui.state.wallsLeft);
    if (ui.pending.length >= max) return defenderDo({ type: 'segment', edges: ui.pending.slice() });
    render();
  }

  function setupClick(c) {
    if (RF.isInfra(c) || RF.APPS[RF.REGION[c]].zone !== 'prod') return toast('Tokens go in the Prod zone (apps F–L).');
    const app = RF.REGION[c];
    const existing = Object.keys(ui.setup).map(Number).find((k) => RF.REGION[k] === app);
    if (existing === c) {
      ui.setup[c] = ui.setup[c] === 'jewel' ? 'sensor' : 'jewel';
    } else {
      const type = existing != null ? ui.setup[existing] : 'sensor';
      if (existing != null) delete ui.setup[existing];
      ui.setup[c] = type;
    }
    render();
  }

  function pickMode(mode) {
    if (ui.busy || ui.phase !== 'play' || ui.state.turn !== 'defender') return;
    if (mode === 'assess') return defenderDo({ type: 'assess' });
    ui.mode = ui.mode === mode ? null : mode;
    ui.pending = [];
    ui.selected = null;
    render();
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
      for (let i = 0; i < RF.N; i++) if (!RF.isInfra(i) && RF.APPS[RF.REGION[i]].zone === 'prod') out.add(i);
      return out;
    }
    if (!s || ui.busy || s.turn !== 'defender') return out;
    for (let i = 0; i < RF.N; i++) {
      if (ui.mode === 'harden' && RF.isInfra(i) && !s.hardened[i]) out.add(i);
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
        el('text', { class: 't-infra', x: cx(i) + CS / 2, y: cy(i) + 15, 'text-anchor': 'middle' }, cells).textContent = reg;
        if (s && s.hardened[i]) {
          const x = cx(i) + CS / 2;
          const y = cy(i) + 22;
          el('path', { class: 'shield', d: `M${x} ${y} l14 5 v10 c0 9 -7 14 -14 17 c-7 -3 -14 -8 -14 -17 v-10 z` }, cells);
        }
      } else if (isFirstCellOfApp(i)) {
        el('text', { class: 't-app', x: cx(i) + 5, y: cy(i) + 13 }, cells).textContent = reg + (s && s.fenced[reg] ? ' ◎' : '');
      }
      if (reg === 'H') {
        const gx = cx(i) + CS - 11;
        const gy = cy(i) + 11;
        el('circle', { class: 'globe', cx: gx, cy: gy, r: 5.5 }, cells);
        el('ellipse', { class: 'globe', cx: gx, cy: gy, rx: 2.4, ry: 5.5 }, cells);
        el('line', { class: 'globe', x1: gx - 5.5, y1: gy, x2: gx + 5.5, y2: gy }, cells);
      }
    }

    // Region borders (thin) and the zone boundary.
    const borders = el('g', {}, svg);
    for (const key in RF.EDGES) {
      const e = RF.EDGES[key];
      if (!e.border || e.zone) continue;
      const [x1, y1, x2, y2] = edgeLine(e);
      el('line', { class: 'border', x1, y1, x2, y2 }, borders);
    }
    el('line', { class: 'zone-line', x1: ML, y1: MT + 3 * CS, x2: ML + RF.SIZE * CS + 40, y2: MT + 3 * CS }, borders);
    el('text', { class: 't-zone', x: ML + RF.SIZE * CS + 5, y: MT + 3 * CS - 5 }, borders).textContent = 'DEV ▲';
    el('text', { class: 't-zone', x: ML + RF.SIZE * CS + 5, y: MT + 3 * CS + 12 }, borders).textContent = 'PROD ▼';

    // Ring-fences and walls.
    const walls = el('g', {}, svg);
    if (s) {
      for (const key in RF.EDGES) {
        const e = RF.EDGES[key];
        if (e.flow || !e.border) continue;
        if (s.fenced[RF.REGION[e.a]] || s.fenced[RF.REGION[e.b]]) {
          const [x1, y1, x2, y2] = edgeLine(e, 5);
          el('line', { class: 'fence', x1, y1, x2, y2 }, walls);
        }
      }
      for (const key in s.walls) wallRect(RF.EDGES[key], 'wall', walls);
      ui.pending.forEach((key) => wallRect(RF.EDGES[key], 'wall pending', walls));
    }

    // Business flows.
    const flows = el('g', {}, svg);
    for (const key in RF.EDGES) {
      const e = RF.EDGES[key];
      if (!e.flow) continue;
      const mx = (cx(e.a) + cx(e.b)) / 2 + CS / 2;
      const my = (cy(e.a) + cy(e.b)) / 2 + CS / 2;
      const [dx, dy] = e.orient === 'v' ? [12, 0] : [0, 12];
      const g = el('g', {}, flows);
      el('title', {}, g).textContent = 'Business flow: ' + e.flow + ' (can never be walled)';
      el('line', { class: 'flow', x1: mx - dx, y1: my - dy, x2: mx + dx, y2: my + dy }, g);
      el('circle', { class: 'flow-end', cx: mx - dx, cy: my - dy, r: 3 }, g);
      el('circle', { class: 'flow-end', cx: mx + dx, cy: my + dy, r: 3 }, g);
    }

    // Tokens and stones.
    const pieces = el('g', {}, svg);
    const tokens = setupTokens
      ? Object.fromEntries(Object.entries(setupTokens).map(([c, type]) => [c, { type, faceUp: false, recon: false }]))
      : (s ? s.tokens : {});
    for (const c in tokens) drawToken(+c, tokens[c], pieces);
    if (s) {
      for (let i = 0; i < RF.N; i++) {
        if (!s.stones[i]) continue;
        const x = cx(i) + CS / 2;
        const y = cy(i) + CS / 2 + 2;
        el('circle', { class: 'stone' + (i === ui.fresh ? ' fresh' : ''), cx: x, cy: y, r: 15 }, pieces);
        el('circle', { class: 'stone-shine', cx: x - 5, cy: y - 5, r: 4 }, pieces);
      }
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

  function drawToken(c, t, parent) {
    const hasStone = ui.state && ui.state.stones[c];
    const x = hasStone ? cx(c) + CS - 14 : cx(c) + CS / 2;
    const y = hasStone ? cy(c) + CS - 14 : cy(c) + CS / 2 + 2;
    const r = hasStone ? 10 : 14;
    const g = el('g', {}, parent);
    el('rect', { class: 'tok-card' + (t.faceUp ? ' up' : ''), x: x - r, y: y - r, width: 2 * r, height: 2 * r, rx: 4 }, g);
    const k = r / 14;
    if (t.type === 'jewel') {
      el('polygon', { class: 'tok-jewel', points: [[0, -9], [8, -2], [0, 9], [-8, -2]].map(([a, b]) => (x + a * k) + ',' + (y + b * k)).join(' ') }, g);
    } else if (t.type === 'sensor') {
      el('circle', { class: 'tok-sensor', cx: x, cy: y, r: 7.5 * k }, g);
      el('circle', { class: 'tok-sensor', cx: x, cy: y, r: 4 * k }, g);
      el('circle', { class: 'tok-sensor-dot', cx: x, cy: y, r: 1.8 * k }, g);
    } else {
      el('circle', { class: 'tok-decoy', cx: x, cy: y, r: 7 * k }, g);
    }
    if (t.recon && !t.faceUp) el('circle', { class: 'tok-seen', cx: x + r - 1, cy: y - r + 1, r: 4 }, g);
  }

  function cellTitle(i) {
    const reg = RF.REGION[i];
    const s = ui.state;
    let t = RF.cellName(i) + ': ';
    if (RF.isInfra(i)) t += reg + ' (' + RF.INFRA[reg] + '), infrastructure service' + (s && s.hardened[i] ? ', HARDENED' : '');
    else t += 'app ' + reg + ', ' + RF.APPS[reg].name + ' (' + RF.APPS[reg].zone.toUpperCase() + ')' + (s && s.fenced[reg] ? ', ring-fenced' : '');
    return t;
  }

  function cellInfo(i) {
    const s = ui.state;
    let text = cellTitle(i) + '.';
    const exits = [];
    if (RF.rowOf(i) === 0) exits.push('internet edge');
    if (RF.REGION[i] === 'H') exits.push('internet-facing');
    if (RF.isInfra(i) && !(s && s.hardened[i])) exits.push('unhardened infra (hub and exit)');
    if (exits.length) text += ' Exit: ' + exits.join(', ') + '.';
    const t = s && s.tokens[i];
    if (t) {
      text += ' Token: ' + (t.faceUp ? 'revealed ' : 'face-down ') + t.type + '.';
      if (!t.faceUp) text += t.recon ? ' The Attacker has scouted it.' : ' The Attacker doesn’t know what it is.';
    }
    const flows = RF.NEIGHBORS[i].filter((n) => RF.EDGES[n.key].flow).map((n) => RF.EDGES[n.key].flow);
    if (flows.length) text += ' Flow: ' + flows.join(', ') + '.';
    return text;
  }

  function renderPanel() {
    const s = ui.state;
    const status = $('status');
    const pips = $('pips');
    status.className = 'status';
    pips.className = 'pips';
    $('setup-panel').hidden = ui.phase !== 'setup';
    $('action-panel').hidden = ui.phase === 'setup';

    if (ui.phase === 'setup') {
      status.textContent = 'Setup: hide your Crown Jewels';
      pips.innerHTML = '';
      const err = RF.validateSetup(ui.setup);
      const msg = $('setup-msg');
      msg.textContent = err || 'Ready. You go first.';
      msg.className = 'setup-msg ' + (err ? 'bad' : 'ok');
      $('btn-start').disabled = !!err;
      $('meters').innerHTML = '';
      renderLog();
      return;
    }

    const myTurn = s.turn === 'defender' && !s.winner;
    if (s.winner) status.textContent = s.winner === 'defender' ? 'You win!' : 'The Attacker wins';
    else if (myTurn) status.textContent = 'Round ' + s.round + ' of ' + RF.CONFIG.roundLimit + ': your move';
    else {
      status.textContent = 'Round ' + s.round + ': the Attacker is moving…';
      status.classList.add('attacker');
      pips.classList.add('attacker');
    }
    pips.innerHTML = '';
    for (let n = 0; n < RF.CONFIG.actionsPerTurn; n++) {
      const p = document.createElement('span');
      p.className = 'pip' + (n < s.actionsLeft && !s.winner ? ' on' : '');
      pips.appendChild(p);
    }

    const scorePct = Math.min(100, (100 * s.score) / RF.CONFIG.scoreTarget);
    const jewelPct = (100 * s.jewelsTaken) / RF.CONFIG.jewelsToWin;
    const hiddenJewels = Object.values(s.tokens).filter((t) => t.type === 'jewel').length;
    $('meters').innerHTML =
      meter('Segmentation Score', s.score + '<small> / ' + RF.CONFIG.scoreTarget + '</small>', scorePct, '') +
      meter('Jewels stolen', s.jewelsTaken + '<small> / ' + RF.CONFIG.jewelsToWin + '</small>', jewelPct, 'danger') +
      meter('Insight', String(s.insight), null, '') +
      meter('Round', s.round + '<small> / ' + RF.CONFIG.roundLimit + '</small>', null, '') +
      '<div class="meter wide"><span>Walls <b>' + s.wallsLeft + '</b></span><span>Sensors <b>' + s.pool.sensor +
      '</b></span><span>Decoys <b>' + s.pool.decoy + '</b></span><span>Jewels on board <b>' + hiddenJewels + '</b></span></div>';

    // Action buttons.
    const can = {
      assess: true,
      harden: s.insight >= RF.CONFIG.hardenCost && RF.INFRA_CELLS.some((c) => !s.hardened[c]),
      segment: s.insight >= RF.CONFIG.segmentCost && s.wallsLeft > 0 && RF.wallableEdges(s).length > 0,
      ringfence: Object.keys(RF.APPS).some((a) => !s.fenced[a] && s.insight >= RF.ringfenceCost(a)),
      deploy: s.insight >= RF.CONFIG.deployCost && s.pool.sensor + s.pool.decoy > 0,
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
    renderLog();
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
      html = 'Tap up to ' + Math.min(2, s.wallsLeft) + ' highlighted edges to wall them. Green flows can’t be walled.' +
        '<div class="row">' + (ui.pending.length ? '<button class="btn primary" data-hint="commit" type="button">Place 1 wall</button>' : '') +
        '<button class="btn" data-hint="cancel" type="button">Cancel</button></div>';
    } else if (ui.mode === 'ringfence') {
      html = 'Tap an app to ring-fence it. Cost = its size. Affordable now: ' +
        (Object.keys(RF.APPS).filter((a) => !s.fenced[a] && s.insight >= RF.ringfenceCost(a))
          .map((a) => a + ' (' + RF.ringfenceCost(a) + ')').join(', ') || 'none') + '.' + cancelBtn();
    } else if (ui.mode === 'deploy') {
      html = 'Pick a token, then tap an empty cell. Only you know which kind it is.' +
        '<div class="kind">' +
        '<button class="btn' + (ui.deployKind === 'sensor' ? ' sel' : '') + '" data-hint="sensor" type="button"' + (s.pool.sensor ? '' : ' disabled') + '>Sensor (' + s.pool.sensor + ')</button>' +
        '<button class="btn' + (ui.deployKind === 'decoy' ? ' sel' : '') + '" data-hint="decoy" type="button"' + (s.pool.decoy ? '' : ' disabled') + '>Decoy (' + s.pool.decoy + ')</button>' +
        '</div>' + cancelBtn();
    } else if (s.actionsLeft === 0) {
      html = 'No actions left. Tap <b>End turn</b>, or Undo to change your mind.';
    } else if (ui.selected != null) {
      html = esc(cellInfo(ui.selected));
    } else {
      html = 'Pick an action. Tap any cell to inspect it.';
    }
    hint.innerHTML = html;
    if (ui.mode === 'deploy' && !s.pool[ui.deployKind]) ui.deployKind = s.pool.sensor ? 'sensor' : 'decoy';
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
      if (h === 'cancel') { ui.mode = null; ui.pending = []; }
      else if (h === 'commit' && ui.pending.length) return defenderDo({ type: 'segment', edges: ui.pending.slice() });
      else if (h === 'sensor' || h === 'decoy') ui.deployKind = h;
      render();
    });
    $('btn-undo').addEventListener('click', undo);
    $('btn-end').addEventListener('click', endDefenderTurn);
    $('btn-random').addEventListener('click', () => { ui.setup = RF.randomSetup(rng); render(); });
    $('btn-start').addEventListener('click', startGame);
    $('btn-new').addEventListener('click', () => {
      if (ui.phase === 'play' && !confirm('Abandon this game and start a new one?')) return;
      newGame();
    });
    $('btn-again').addEventListener('click', newGame);
    $('btn-review').addEventListener('click', () => hide('overlay-end'));
    $('btn-rules').addEventListener('click', () => show('overlay-rules'));
    $('btn-rules-close').addEventListener('click', () => hide('overlay-rules'));
    ['overlay-rules', 'overlay-end'].forEach((id) =>
      $(id).addEventListener('click', (e) => { if (e.target.id === id) hide(id); })
    );

    const level = $('set-level');
    const speed = $('set-speed');
    const reasoning = $('set-reasoning');
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
        ui.mode = null;
        ui.pending = [];
        return render();
      }
      if (ui.phase !== 'play') return;
      const map = { 1: 'assess', 2: 'harden', 3: 'segment', 4: 'ringfence', 5: 'deploy' };
      if (map[e.key]) {
        const b = document.querySelector('#actions [data-action="' + map[e.key] + '"]');
        if (b && !b.disabled) pickMode(map[e.key]);
      } else if (e.key === 'u' || e.key === 'U') undo();
      else if (e.key === 'e' || e.key === 'E') endDefenderTurn();
    });

    let seenRules = false;
    try { seenRules = localStorage.getItem('ringfence.seenRules') === '1'; } catch (e) { /* ignore */ }
    if (!seenRules) {
      show('overlay-rules');
      try { localStorage.setItem('ringfence.seenRules', '1'); } catch (e) { /* ignore */ }
    }
  }

  wire();
  newGame();

  // Handy for debugging in the console.
  window.ringfence = { ui, render };
})();
