# RINGFENCE prototype

A playable browser prototype of the RINGFENCE design
([`docs/RINGFENCE-GAME-DESIGN.md`](../docs/RINGFENCE-GAME-DESIGN.md)). You
play the **Defender** and an AI plays the **Attacker**.

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

- `?seed=abc` replays the same random token setup and AI dice rolls.
- `?ai=easy|normal|hard` sets the AI level. You can also change it in
  **Settings**.
- In **Settings**, turn on *Show the AI's reasoning* to see its target and
  distance estimate in the log.

### Keyboard shortcuts

`1`–`5` choose an action, `Esc` cancels, `U` undoes, `E` ends your turn.

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

```
node ringfence/tools/sim.js 200 hard     # or: normal, easy; add --fuzz
```

These are 200 games against the scripted Defender bot, using the v0.1
numbers:

| Attacker AI | Attacker win rate | Median game length |
|---|---|---|
| Easy | 24% | 6 rounds |
| Normal | 30% | 6 rounds |
| Hard | 38% | 6 rounds |
| Random moves (baseline) | 0.5% | — |

The bot Defender is simple, so a thoughtful human will probably do better.
The numbers show the AI is making sensible decisions, but they aren't a
verdict on balance. All the tunable numbers are in `CONFIG` at the top of
`js/rules.js`. The AI's weights are in `W` in `js/ai.js`.
