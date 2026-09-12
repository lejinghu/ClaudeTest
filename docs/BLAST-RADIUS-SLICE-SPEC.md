# Blast Radius — Vertical Slice Implementation Spec

Status: ready to implement. Target implementer: a coding agent or developer
with no prior game-development experience required.

This document is a **complete specification**, not a sketch. Every constant,
formula, and data record needed to build the slice is given here. Where this
document states a number, use that number — balance was reasoned about
deliberately and changing values will break the intended difficulty curve.
Tuning happens in Phase 6, after the game runs.

---

## 1. What this is

`Blast Radius` is a turn-based strategy game about micro-segmentation. The
player defends a virtual datacenter against an attacker spreading laterally
between workloads, using the loop that lateral-security tooling exists to
support: **observe traffic → understand the estate → enforce segmentation →
live with the consequences.**

**Naming constraint — applies to all code, comments, UI strings, the event
log, the README and commit messages.** Do not use trademarked or product-brand
terms anywhere: no VMware, Broadcom, vDefend, NSX, SSP, or "Security Services
Platform". Generic industry vocabulary is correct and expected —
micro-segmentation, distributed firewall, east-west traffic, lateral movement,
zero trust, ring-fencing, segmentation score, telemetry, workload, flow,
blast radius, allow-list.

The vertical slice is **Act I–II only**: one estate, 15 turns, one attacker,
one score. Roughly five minutes of play.

### Design thesis (do not lose this)

The game must teach one thing: *enforcing segmentation before you have
enough flow data breaks production; waiting too long lets the attacker
spread.* Every mechanic exists to create that tension. If a change makes
that trade-off less sharp, it is the wrong change.

### Explicit non-goals for the slice

- No procedural topology generation. The estate is hand-authored (Section 4).
- No Acts III/IV, no zones-beyond-fencing, no rule analysis, no MITRE board.
- No sound, no animation, no sprites, no artwork.
- No multiplayer, no persistence, no backend.

---

## 2. Technical constraints

**Hard requirements:**

- Plain static HTML/CSS/JS. **No build step, no npm, no bundler, no TypeScript.**
- **No game engine.** Do not use Phaser, PixiJS, or Three.js. This game is
  turn-based; there is no game loop, no physics, and no frame timing.
- Rendering is **inline SVG manipulated via the DOM**. Not `<canvas>`.
  SVG elements are individually clickable and styleable with CSS, which is
  exactly what a turn-based board needs.
- ES modules (`<script type="module">`). Modern browsers only.
- Must run by opening `index.html` from disk *and* when served over HTTP.
- **Must be fully playable on a phone.** Touch is a first-class input, not a
  desktop layout that happens to survive a small screen. The target device is
  a 390×844 phone in portrait. Landscape phone, tablet, and 1280×800 desktop
  must all work. See Section 6.
- No hover-only interactions anywhere. Touch devices have no hover state, so
  any information reachable by hover must also be reachable by tap.

**Location:** everything goes in a new `blast-radius/` directory at the repo
root. Do **not** modify, move, or delete the existing Firewall Defender game
at the repo root — the two coexist and both are served by GitHub Pages.

**File structure:**

```
blast-radius/
  index.html
  css/style.css
  data/estate.js      Topology data — the game design lives here
  js/rng.js           Seeded random number generator
  js/layout.js        Node positions per layout mode (wide/tall). Pure.
  js/state.js         Pure game logic. NO DOM access whatsoever.
  js/render.js        Draws state to SVG. Read-only w.r.t. state.
  js/input.js         Click/key handling. Translates events to state actions.
  js/main.js          Wires the above together.
```

**The one structural rule:** `state.js` must contain zero DOM references and
zero rendering concerns. It exports pure functions that take state and return
new state. This makes the rules testable and tunable without touching
visuals, and it is the difference between a game that can be balanced and one
that cannot.

---

## 3. Core mechanics

### 3.1 Turn structure

The game runs **15 turns**. Each turn:

1. Player spends up to **3 action points (AP)**. Unspent AP does not carry over.
2. Player clicks **End Turn**.
3. Resolution happens in this exact order:
   a. Flow activity is computed for this turn (Section 3.2).
   b. Observation: probed workloads reveal active flows.
   c. Attacker spreads (Section 3.4), starting turn 3.
   d. Detection: alerts fire on probed compromised workloads.
   e. Outage damage is applied (Section 3.5).
   f. Score is recalculated.

After turn 15 resolves, the game ends and shows the score screen.

### 3.2 Flow frequency and the fog of war

Every flow has a `frequency` that determines which turns it is active on:

| frequency | Active on turns | Purpose |
|---|---|---|
| `constant` | every turn | Baseline noise; easy to observe |
| `periodic` | 3, 6, 9, 12, 15 | Mild patience test |
| `nightly` | 7, 14 | **The trap.** Backup jobs. |
| `weekly` | 12 | **The big trap.** Jump-host and deploy paths. |

A flow becomes **observed** (permanently) at end of turn T if it is active on
turn T *and* at least one of its two endpoints has a probe on it.

At game start, **zero flows are observed.** All 24 workloads are visible from
turn 1; the edges between them are not.

### 3.3 Player actions

| Action | Cost | Effect |
|---|---|---|
| **Place probe** | 1 AP | Put a telemetry probe on a workload. Max 4 probes on the board at once. |
| **Move probe** | 1 AP | Relocate an existing probe to another workload. |
| **Ring-fence group** | 2 AP | Permanently fence a group (Section 3.5). Cannot be undone. |
| **Repair outage** | 1 AP | Restore one broken dependency; stops its ongoing damage. |

Probes are the scarce resource and do double duty: they map the estate *and*
they are the only way to detect the attacker. That competition is the central
decision of the slice — do not add a separate detection mechanic.

### 3.4 The attacker

- **Patient zero** is placed at the **end of turn 3**, on a workload chosen by
  seeded random from the `dev` zone or `jump-01`. Its location is hidden.
- From **turn 4 onward**, at end of turn, the attacker compromises exactly
  **one** new workload.
- Spread rule: build the set of all uncompromised workloads reachable from any
  compromised workload via a flow that is **not blocked**. Flow direction is
  ignored — lateral movement traverses an edge either way. If the set is
  empty, the attacker does nothing this turn (it is contained).
- Target selection: weighted seeded random, where a candidate's weight equals
  its total number of flows (degree). High-connectivity workloads are more
  attractive footholds. This makes fencing hub services genuinely valuable.
- **Detection:** at end of turn, any compromised workload that has a probe on
  it is revealed to the player, permanently, with a red alert. Compromised
  workloads without probes stay hidden.
- The player is told "an intrusion is underway" at end of turn 3 — but not
  where. This is important: it creates urgency without giving away the answer.

### 3.5 Ring-fencing and outages

Groups available to fence in the slice (each fenced independently):

| Group | Members |
|---|---|
| `infra-dns` | dns-01, dns-02 |
| `infra-core` | ntp-01, ldap-01, log-01 |
| `zone-prod` | all 10 workloads with `zone: "prod"` |
| `zone-dev` | all 5 workloads with `zone: "dev"` |
| `zone-mgmt` | all 4 workloads with `zone: "mgmt"` |

**Fencing resolution — this is the heart of the game:**

When a group is fenced, every flow with at least one endpoint inside that
group is evaluated:

- If the flow is **observed** → it is **allowed** (added to the allow-list).
- If the flow is **not observed** → it is **blocked**.

Blocked flows do two things:
1. They stop the attacker traversing that edge. This is the win condition.
2. If the blocked flow was a **real dependency**, it causes an **outage**.

Every flow in the data has an `essential` boolean. Blocking an `essential`
flow creates an outage on the destination workload. Outages cost **4 score
points per turn** until repaired (1 AP) and are displayed prominently.

This is the entire lesson: **you allow what you have seen, and you break what
you have not.** A player who fences `zone-prod` on turn 5 has not yet seen the
nightly backup (turn 7) or the weekly deploy (turn 12), and will pay for it.

---

## 4. The estate data

This is the game design. Implement it exactly.

### 4.1 Workloads (24)

```js
// kind: "infra" | "app" | "mgmt"
{ id: "dns-01",     name: "DNS Primary",        kind: "infra", zone: "shared" }
{ id: "dns-02",     name: "DNS Secondary",      kind: "infra", zone: "shared" }
{ id: "ntp-01",     name: "NTP Server",         kind: "infra", zone: "shared" }
{ id: "ldap-01",    name: "LDAP Directory",     kind: "infra", zone: "shared" }
{ id: "log-01",     name: "Syslog Collector",   kind: "infra", zone: "shared" }

{ id: "web-01",     name: "Storefront Web 1",   kind: "app", zone: "prod", app: "storefront", tier: "web" }
{ id: "web-02",     name: "Storefront Web 2",   kind: "app", zone: "prod", app: "storefront", tier: "web" }
{ id: "app-01",     name: "Storefront App 1",   kind: "app", zone: "prod", app: "storefront", tier: "app" }
{ id: "app-02",     name: "Storefront App 2",   kind: "app", zone: "prod", app: "storefront", tier: "app" }
{ id: "cache-01",   name: "Session Cache",      kind: "app", zone: "prod", app: "storefront", tier: "app" }
{ id: "db-01",      name: "Orders DB",          kind: "app", zone: "prod", app: "storefront", tier: "db"  }
{ id: "bill-web-01",name: "Billing Portal",     kind: "app", zone: "prod", app: "billing",    tier: "web" }
{ id: "bill-app-01",name: "Billing Engine",     kind: "app", zone: "prod", app: "billing",    tier: "app" }
{ id: "pay-gw-01",  name: "Payment Gateway",    kind: "app", zone: "prod", app: "billing",    tier: "app" }
{ id: "bill-db-01", name: "Billing DB",         kind: "app", zone: "prod", app: "billing",    tier: "db"  }

{ id: "dev-web-01", name: "Dev Web",            kind: "app", zone: "dev", app: "storefront-dev", tier: "web" }
{ id: "dev-app-01", name: "Dev App",            kind: "app", zone: "dev", app: "storefront-dev", tier: "app" }
{ id: "dev-db-01",  name: "Dev DB",             kind: "app", zone: "dev", app: "storefront-dev", tier: "db"  }
{ id: "jenkins-01", name: "Build Server",       kind: "app", zone: "dev" }
{ id: "dev-vm-04",  name: "Developer Sandbox",  kind: "app", zone: "dev" }

{ id: "bkp-01",     name: "Backup Server",      kind: "mgmt", zone: "mgmt" }
{ id: "mon-01",     name: "Monitoring",         kind: "mgmt", zone: "mgmt" }
{ id: "jump-01",    name: "Jump Host",          kind: "mgmt", zone: "mgmt" }
{ id: "vc-01",      name: "vCenter",            kind: "mgmt", zone: "mgmt" }
```

### 4.2 Flows (92)

Generate these from the rules below in `estate.js`. Write them as explicit
array entries (a small loop building the array at module load is fine, but the
result must be inspectable).

**Infrastructure flows — the noise floor (45 flows):**

Note that probing a hub such as `dns-01` reveals all ten of its flows in a
single turn. Rewarding hub-first probing is intended.

| Rule | Port | frequency | essential |
|---|---|---|---|
| First 10 non-infra workloads → `dns-01` | 53 | constant | true |
| Remaining 9 non-infra workloads → `dns-02` | 53 | constant | true |
| `web-01, app-01, db-01, bill-app-01, bill-db-01, vc-01` → `ntp-01` | 123 | periodic | true |
| `web-01, web-02, app-01, app-02, bill-web-01, bill-app-01, jump-01, vc-01` → `ldap-01` | 389 | constant | true |
| All 10 `prod` + `jenkins-01` + `vc-01` → `log-01` | 514 | constant | false |

**Application flows — the structure to be discovered (14 flows):**

| From | To | Port | frequency | essential |
|---|---|---|---|---|
| web-01 | app-01 | 8080 | constant | true |
| web-02 | app-02 | 8080 | constant | true |
| app-01 | db-01 | 3306 | constant | true |
| app-02 | db-01 | 3306 | constant | true |
| app-01 | cache-01 | 6379 | constant | true |
| app-02 | cache-01 | 6379 | constant | true |
| bill-web-01 | bill-app-01 | 8443 | constant | true |
| bill-app-01 | bill-db-01 | 5432 | constant | true |
| bill-app-01 | pay-gw-01 | 443 | periodic | true |
| app-01 | bill-app-01 | 8443 | periodic | true |
| dev-web-01 | dev-app-01 | 8080 | constant | true |
| dev-app-01 | dev-db-01 | 3306 | constant | true |
| dev-vm-04 | dev-db-01 | 3306 | constant | false |
| dev-vm-04 | jenkins-01 | 22 | constant | false |

**Monitoring — heavy noise from one hub (23 flows):**

`mon-01` → all 23 other workloads, port 161, `constant`, `essential: false`.

This single rule is what makes the map look like a hairball once observed,
and it makes `mon-01` a very attractive attacker foothold (degree 23). Fencing
`zone-mgmt` early is powerful — and, per the traps below, expensive.

**The traps — these are the game (10 flows):**

| From | To | Port | frequency | essential | Note |
|---|---|---|---|---|---|
| bkp-01 | db-01 | 2049 | nightly | **true** | Turn 7/14 only |
| bkp-01 | bill-db-01 | 2049 | nightly | **true** | Turn 7/14 only |
| bkp-01 | dev-db-01 | 2049 | nightly | false | Turn 7/14 only |
| bkp-01 | vc-01 | 2049 | nightly | **true** | Turn 7/14 only |
| jump-01 | web-01 | 22 | weekly | **true** | Turn 12 only |
| jump-01 | app-01 | 22 | weekly | **true** | Turn 12 only |
| jump-01 | db-01 | 22 | weekly | **true** | Turn 12 only |
| jump-01 | bill-app-01 | 22 | weekly | **true** | Turn 12 only |
| jenkins-01 | app-01 | 8080 | weekly | **true** | **The dev→prod bridge** |
| jenkins-01 | bill-app-01 | 8080 | weekly | **true** | **The dev→prod bridge** |

The two `jenkins-01 → prod` flows are the most important records in the file.
They are simultaneously the attacker's route out of `dev` and a production
dependency the player cannot see until turn 12. Fencing `zone-dev` early
contains the attack *and* breaks deploys. That dilemma is the product pitch.

---

## 5. Scoring

Recalculate after every turn; display live.

```
containment    = 60 * (uncompromised_workloads / 24)
infrastructure = 20 * (fenced_infra_groups / 2)        // infra-dns, infra-core
uptime         = 20 - (4 * cumulative_outage_turns)    // floor at 0

total          = round(containment + infrastructure + uptime)   // 0..100
```

`cumulative_outage_turns` increments by the number of *currently unrepaired*
outages at each turn resolution.

End screen bands:

| Score | Label |
|---|---|
| 90–100 | Zero Trust Achieved |
| 75–89 | Strong Posture |
| 55–74 | Partially Segmented |
| 30–54 | Flat Network |
| 0–29 | Total Compromise |

Below the band, always show the three components separately, plus two facts:
turn the attacker was first detected, and count of workloads compromised. The
score breakdown is the teaching moment — do not collapse it to one number.

---

## 6. Rendering and input

### 6.1 Two layout modes

The map is inline SVG driven by a `viewBox`, so one coordinate space scales to
any screen. Node positions come from `layout.js`, which exports a pure function
`positions(mode)` returning `{id: {x, y}}` plus zone band rectangles.

Mode is chosen by aspect ratio, not by user agent — never sniff the user agent:

| Condition | Mode | viewBox |
|---|---|---|
| viewport width ≥ 900px | `wide` | `0 0 960 800` |
| viewport width < 900px | `tall` | `0 0 420 1348` |

Re-evaluate on `resize` and `orientationchange`. Switching modes must preserve
game state — only positions change.

**`wide` mode — four vertical zone columns:**

| Column | x centre | Zone |
|---|---|---|
| 1 | 140 | `shared` (5 nodes) |
| 2 | 400 | `prod` (10 nodes, two sub-columns of 5 at x=340 and x=460) |
| 3 | 660 | `dev` (5 nodes) |
| 4 | 860 | `mgmt` (4 nodes) |

**`tall` mode — four stacked zone bands, nodes in a grid of up to 3 per row:**

| Band | Rows | y range |
|---|---|---|
| `shared` (5) | 3 + 2 | 20–280 |
| `prod` (10) | 3 + 3 + 3 + 1 | 296–776 |
| `dev` (5) | 3 + 2 | 792–1052 |
| `mgmt` (4) | 2 + 2 | 1068–1328 |

Band height is `24px label + (rows × 110) + 16px padding`, with a 16px gap
between bands; the four bands plus margins total the 1348 viewBox height.
Derive the values in code from that formula rather than hard-coding the table,
so changing a band's contents cannot silently break the layout.

Within a row, x centres are 90 / 210 / 330 for three nodes, 150 / 270 for two,
210 for one. Row pitch is 110px; the first row's centre sits 55px below the
band's label baseline.

Fixed layout in both modes is deliberate: it is simpler than force-directed,
stable across turns so the player builds spatial memory, and zone grouping
makes segmentation legible at a glance.

### 6.2 Pan and zoom

Both modes support pan and zoom by manipulating the `viewBox`. Required
because at `tall` scale a 24-node map is legible but tight, and players will
want to inspect a cluster.

- Touch: one-finger drag pans, two-finger pinch zooms.
- Mouse: drag pans, wheel zooms.
- Clamp zoom to 0.8×–3×; clamp pan so the map cannot leave the viewport.
- A **Reset view** button returns to the fit-to-screen `viewBox`.
- Set `touch-action: none` on the SVG so the browser does not steal the
  gestures, and `overscroll-behavior: none` on `body` to kill pull-to-refresh.

### 6.3 Node and edge rendering

Nodes are a circle plus a label below. Radius and label size are per mode:

| Mode | Node radius | Label | Hit target |
|---|---|---|---|
| `wide` | 18 | 11px | r=24 transparent circle |
| `tall` | 22 | 13px | r=30 transparent circle |

The transparent hit circle is required, not optional. A visible r=22 node on a
phone is about a 41px touch target; the r=30 hit circle brings it to ~56px,
comfortably above the 44px minimum. Draw hit circles in a layer above the
visible nodes with `fill: transparent` and `pointer-events: all`.

| Node state | Fill | Stroke |
|---|---|---|
| Normal | `#2a3342` | `#4a5568` |
| Probed | `#2a3342` | `#38bdf8` 3px + small blue dot badge |
| Compromised (detected) | `#7f1d1d` | `#ef4444` 3px, pulsing via CSS |
| Outage | `#78350f` | `#f59e0b` 3px |
| Selected | current fill | `#e2e8f0` 3px halo |
| Inside fenced group | normal fill, plus group band gets a dashed border |

| Edge state | Stroke |
|---|---|
| Unobserved | not drawn at all |
| Observed, allowed | `#475569` 1px (`wide`) / 1.5px (`tall`) |
| Observed, blocked | `#ef4444` 1.5px (`wide`) / 2px (`tall`), `stroke-dasharray: 4 3` |

**Colour palette (dark theme):** background `#0f172a`, panels `#1e293b`,
text `#e2e8f0`, muted text `#94a3b8`, accent `#38bdf8`, danger `#ef4444`,
warning `#f59e0b`, success `#22c55e`.

### 6.4 Tap-to-select, then act

Actions are **two-step on every device**, not just touch. Tapping a node
selects it and opens an action bar naming the workload and its available
actions with AP costs. Nothing is committed by the tap itself.

This is not only a fat-finger guard. Ring-fencing is irreversible by design
(Section 3.3), so a single stray tap must never be able to commit it. Fence
actions additionally require a confirm step that states the consequence:

> Ring-fence `zone-prod`? 31 observed flows will be allowed, 9 unobserved
> flows will be blocked. This cannot be undone.

Showing the allowed/blocked counts at the moment of decision is a teaching
moment — it is the player's last chance to notice they have not observed
enough. Do not omit it.

Tap on empty space clears the selection.

**Distinguishing tap from pan:** a pointer interaction counts as a tap only if
it moves less than 10px and lasts under 500ms. Otherwise it is a pan. Use
Pointer Events (`pointerdown`/`pointermove`/`pointerup`), which cover mouse,
touch, and stylus with one code path — do not write separate mouse and touch
handlers.

### 6.5 Chrome layout

The same information appears in both modes; only its arrangement changes.

**`wide`:** map on the left, a 320px sidebar on the right containing, top to
bottom: turn counter (`Turn 7 / 15`), AP remaining as 3 pips, live score with
its three components, probe count (`3 / 4 placed`), active outage list with
Repair buttons, the five fence buttons with AP costs, an event log (last 8
events, newest first), and the End Turn button.

**`tall`:** three fixed regions.

1. **Status bar, pinned top, ~56px.** Turn, AP pips, score. Always visible —
   these are what the player checks constantly.
2. **Map, filling the space between.**
3. **Bottom sheet, pinned bottom.** Collapsed it shows the End Turn button
   plus an outage count badge if any are active. Dragging it up or tapping the
   handle expands it to a tabbed panel: **Fences** / **Outages** / **Log**.

End Turn must be reachable with a thumb without expanding the sheet — it is
pressed 15 times per game and is the most-used control.

**Safe areas:** use `<meta name="viewport" content="width=device-width,
initial-scale=1, viewport-fit=cover">` and pad the status bar and bottom sheet
with `env(safe-area-inset-top)` / `env(safe-area-inset-bottom)` so controls
clear the notch and home indicator.

**Minimum touch target for every button is 44×44px**, including the bottom
sheet tabs and the Repair buttons.

### 6.6 Event log wording

**Event log messages must name the product concept.** Not "flow found" but
`Flow discovered: app-01 → db-01 (3306)`. Not "blocked" but
`zone-prod ring-fenced: 31 flows allowed, 9 blocked`. The log is where the
vocabulary lands.

---

## 7. Build phases

Each phase must end in a state that can be opened in a browser and looked at.
Commit after each phase.

**Phase 0 — Data.** Write `data/estate.js` exporting `WORKLOADS` and `FLOWS`.
No other code. *Acceptance:* open a console, import it, confirm 24 workloads
and exactly 92 flows, and that every flow's endpoints resolve to real workload ids.

**Phase 1 — Static map, both modes.** `index.html`, `css/style.css`,
`layout.js`, `render.js` drawing all workloads with zone bands, and *all*
flows visible (temporarily, to verify the topology). Both layout modes and the
mode switch on resize. *Acceptance:* the estate renders as a readable
datacenter diagram at 1280×800 **and** at 390×844; rotating the device
reflows without losing state; no console errors.

Build both modes here, at the start. Retrofitting a second layout after the
interaction code exists is materially harder than writing it now.

**Phase 2 — Fog, probes, turns, touch input.** `rng.js`, `state.js` with turn
advance and observation. Pointer Events with tap/pan discrimination, pan and
zoom, tap-to-select and the action bar. Edges hidden until observed. End Turn
works. *Acceptance:* on a real phone (or a browser device-emulation mode),
probes can be placed and turns ended using only touch; pinch-zoom works;
panning never accidentally places a probe; the nightly flows only appear on
turns 7 and 14.

**Phase 3 — The attacker.** Spread logic, detection via probes, the turn-3
intrusion warning, event log entries. *Acceptance:* the attacker spreads one
node per turn, is invisible until probed, and stops when contained.

**Phase 4 — Fencing and outages.** Fence buttons, allow-list resolution,
blocked edges, outage generation and repair. *Acceptance:* fencing `zone-prod`
on turn 5 causes outages on turn 7; fencing it on turn 8 does not.

**Phase 5 — Scoring and end screen.** Live score panel, end-of-game screen
with band and breakdown, restart button. *Acceptance:* a complete playthrough
produces a plausible score; the game is finishable.

**Phase 6 — Tuning.** Play ten seeds. Adjust *only* values in `estate.js` and
the constants in Section 3 until: a careless player scores 40–60, a careful
player scores 75–85, and 90+ requires genuinely good play. Report what was
changed and why.

---

## 8. Required from the start

**Seeded RNG (`rng.js`).** Implement mulberry32 or equivalent. The seed comes
from `?seed=` in the URL, defaulting to a random one shown on screen. Same
seed must produce an identical run every time. Without this, Phase 6 is
guesswork and bugs are unreproducible. It is also what makes a future
leaderboard mode possible for free.

**Debug toggle.** Pressing `D` reveals every flow and the attacker's true
position, with a `DEBUG` badge on screen. Ten minutes of work; indispensable
for verifying Phases 3 and 4. Provide a touch equivalent — a long-press
(800ms) on the turn counter — or Phases 3 and 4 cannot be verified on the
device they most need verifying on.

---

## 9. Definition of done

- All six phases complete, each committed separately.
- Game is playable start to finish by opening `blast-radius/index.html`.
- **A full 15-turn game is completable on a 390×844 phone using only touch**,
  with no control unreachable, no text below 12px, and no touch target under
  44px. Verify in portrait and landscape.
- No console errors or warnings during a full playthrough.
- No build step, no dependencies, no network requests at runtime.
- The existing Firewall Defender game at the repo root still works, untouched.
- `blast-radius/README.md` explains how to play in under 200 words, and
  describes each mechanic in generic micro-segmentation terms.
- No trademarked or brand terms anywhere in the repo (see Section 1):
  `grep -riE "vmware|broadcom|vdefend|nsx|security services platform" blast-radius/`
  returns nothing.
- A short tuning report from Phase 6 in the final commit message or the README.

## 10. If something is ambiguous

Prefer the reading that sharpens the observe-vs-enforce trade-off. If a
mechanic would make the game easier to win by ignoring flow data, it is wrong.
Do not add mechanics that are not in this document; note the idea and raise it
instead.
