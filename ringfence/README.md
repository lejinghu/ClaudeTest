# RINGFENCE prototype

A playable browser prototype of the RINGFENCE design
([`docs/RINGFENCE-GAME-DESIGN.md`](../docs/RINGFENCE-GAME-DESIGN.md)). You
play the **Defender** and an AI plays the **Attacker**.

Business flows are hidden and drawn at random each game. Security
Intelligence reveals them over time. Locking down an app follows the real
workflow: observe traffic, then ring-fence, which publishes allow rules for
the observed flows and blocks the rest. Blocking a flow you haven't allowed
causes an outage.

v0.4 is tuned for a **~5-minute game**: one stolen jewel wins for the
Attacker, and the Defender needs Score 6 or survival to round 8. There are 15
hidden flows, so fencing a jewel's app doesn't seal it. Segment and Allow each
handle any number of walls or exceptions in one action. Ring-fence
now publishes the Security Intelligence recommendation (allow rules for
observed flows) automatically. Getting through a ring-fence over an allowed
flow costs the Attacker 2 actions, because it has to exploit the allowed
service.

v0.3 removed the Dev/Prod environments and the Decoys. It adds a secret
**⇄ Swap**: exchange two face-down tokens, or only pretend to. It costs
3 Insight and is limited to 2 per game. The red % under each token shows the
Attacker's current jewel odds for it.

It's plain HTML, CSS and JS with no dependencies. `index.html` is **one
self-contained file**, with the CSS and JS inlined, so it renders the same
wherever it's opened: GitHub Pages, straight from disk, a file preview, or
as a single downloaded or attached file.

## Play it

- **GitHub Pages:** the repo's Pages workflow publishes the whole repo when
  `main` changes. This page is then at `https://<user>.github.io/<repo>/ringfence/`.
- **Locally:** open `ringfence/index.html`, or run
  `python3 -m http.server` from the repo root and go to
  `http://localhost:8000/ringfence/`.

### Options

- `?swap=score` switches to the alternative swap rule (−1 score each, no
  limit) for playtesting. You can also change it in **Settings**.
- `?seed=abc` replays the same random token setup and AI dice rolls.
- `?ai=easy|normal|hard` sets the AI level. You can also change it in
  **Settings**.
- In **Settings**, turn on *Show the AI's reasoning* to see its target and
  distance estimate in the log.

### Keyboard shortcuts

`1`–`7` choose an action, `Esc` cancels, `U` undoes, `E` ends your turn.

## Playtesting

The page has two playtest features:

- **Threat highlight** (on by default; switch it off in **Settings**). On
  your turn, a dashed route shows the Attacker's quickest way to one of your
  real jewels. A panel says how many actions it needs, in red if it could
  happen on its next turn.
- **Feedback and game records.** After each game, players rate it from 1 to 5
  and can add a comment. Every finished game is saved in the browser with the
  settings, seed, each action, time per turn and the result. You can download
  one game or all of them as JSON, from the end screen or from **Settings**.
  Nothing leaves the browser unless you download it.

To run a session: have 5–10 people play two or three games each on one
device, then download all the playtests and run:

```
node ringfence/tools/playtest-report.js ringfence-playtests-*.json
```

The report shows win rate and average fun rating per AI level, game length
in minutes and rounds, time per turn, outages, the Defender's action mix, how
players lost, and all comments. The design doc (Section 11) lists the
targets to compare against.

## Files

| File | What it does |
|---|---|
| `index.html` | **Generated** by `tools/build.js`, so don't edit it. It's the playable page with everything inlined. |
| `src/index.html` | The page template. Open it directly while developing: it loads `../css` and `../js` live. |
| `css/style.css` | Styles. |
| `js/rules.js` | Rules engine: board data, legality, turn flow, scoring, quarantine, win checks. It has no DOM code and runs in both the browser and Node. |
| `js/ai.js` | Attacker AI (see below). |
| `js/ui.js` | SVG board, input handling, event log, undo, end-of-game debrief. |
| `tools/build.js` | Inlines `css/` and `js/` into `index.html`. Run it after any change; `--check` reports whether `index.html` is stale. The Pages workflow also runs it before deploying. |
| `tools/sim.js` | Headless simulator for balance numbers, plus an invariant fuzzer. |
| `tools/playtest-report.js` | Summarises downloaded human playtest records. |
| `tools/defender-bot.js` | A simple scripted Defender, used only by the simulator. |

## The Attacker AI

- **No cheating.** The AI plays from `RF.attackerView(state)`, which hides
  every face-down token it hasn't revealed or scouted with Recon. It knows
  where tokens are, as a real player would, but not what they are.
- **Beliefs.** It estimates the chance that each token is a Jewel. For
  setup tokens this is the jewels not yet accounted for divided by the setup
  tokens still unknown. Tokens deployed mid-game are never Jewels, and the
  AI assumes 60% of them are Sensors.
- **Evaluation.** For each possible jewel, the AI finds the cheapest set of
  cells to occupy so that a stone sits on the jewel with a connected route to
  an exit. It uses a shortest-path search where its own stones cost nothing
  and unknown tokens cost extra because they might be Sensors. It then asks
  how much longer that route becomes if the Defender cuts its weakest link
  with a wall or a Harden.
- **Levels.**
  - *Easy* picks one action at a time with a lot of randomness.
  - *Normal* picks one action at a time by expected value, and scouts a
    likely Sensor with Recon before stepping onto it.
  - *Hard* runs an expectimax search two actions ahead within its turn, so
    it values Recon for what it reveals and finds combinations such as
    "reveal a jewel, then exfiltrate".

## Balance snapshot

The current (v0.4) balance, the swap cost comparison, and the crossing-rule
comparison are in the design doc (Section 11). In v0.4, a careful Defender
loses 42–50% of games and mindless lockdown loses 84–85%, in about 4–5 rounds.
The v0.2 numbers below are kept for history.

### v0.2

```
node ringfence/tools/sim.js 200 hard              # careful Defender bot
node ringfence/tools/sim.js 200 hard --mindless   # ring-fence everything ASAP
node ringfence/tools/sim.js 200 hard scoreTarget=9 allowCost=1   # try CONFIG changes
node ringfence/tools/sim.js 20 --fuzz             # random games + invariant checks
node ringfence/tools/sim.js 300 hard --eager-swap swapCost=0 swapScorePenalty=1 swapsPerGame=99
```

Each row is 200 games. The number shown is the Attacker's win rate.

| Defender bot | vs Easy AI | vs Normal AI | vs Hard AI | Outages per game |
|---|---|---|---|---|
| Mindless: ring-fence as soon as affordable, no exceptions | 97% | 98% | 98% | about 4.4 |
| Careful: observe → allow → ring-fence, respond to threats | 45% | 54% | 57% | about 0.1 |

The Defender bot only knows the flows Security Intelligence has shown it, as
a human would. It's simple, so a thoughtful human should do better. Treat
these numbers as evidence of the intended trade-off, not a verdict on
balance. All the tunable numbers are in `CONFIG` at the top of
`js/rules.js`. The AI's weights are in `W` in `js/ai.js`.
