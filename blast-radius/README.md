# Blast Radius

A five-minute, turn-based micro-segmentation game. Open `index.html` and
defend a 24-workload datacenter against a lateral-moving attacker over 15
turns.

> This game is plain ES modules (`<script type="module">`), so it works
> when double-clicked in Firefox, but Chrome blocks module scripts loaded
> from a bare `file://` URL (a Chrome-specific CORS rule, unrelated to this
> game). In Chrome, serve the folder instead: `python3 -m http.server` from
> the repo root, then open `http://localhost:8000/blast-radius/`.

## How to play

Each turn gives you 3 action points:

- **Probe** (1 AP) a workload to reveal its active traffic — max 4 on the
  board.
- **Move** a probe (1 AP) to another workload.
- **Ring-fence** a group (2 AP, permanent): every flow touching it that
  you've *observed* is allowed; everything else is blocked — blocking a
  real dependency causes an outage.
- **Repair** an outage (1 AP).

Tap a workload for its actions; tap a fence button for a confirm screen
showing how many flows will be allowed vs. blocked before you commit. Click
**End Turn** to resolve the turn — traffic runs, an attacker (from turn 3)
spreads one hop toward well-connected workloads, and your score updates.
After turn 15, see the score breakdown.

Add `?seed=xyz` to the URL for a reproducible run. Press **D**, or
long-press the turn counter on touch, for a debug overlay.

## Mechanics, in plain terms

- Probes → traffic telemetry / visibility
- Unobserved flows are invisible → can't segment what you haven't seen
- Ring-fencing → micro-segmentation / distributed-firewall enforcement
- A blocked-but-real flow → the cost of enforcing before you understand
- Attacker spread → east-west lateral movement between workloads
- Detection only via a probe → visibility and enforcement share one budget
- The score → a segmentation-maturity score (containment, hardening, uptime)

## Phase 6 tuning notes

Played via `state.js` directly (no browser) across several strategies,
40 seeds each:

| Strategy | Score (mean) | Compromised (mean) |
|---|---|---|
| Do nothing all game | 48 | 13 / 24 |
| Fence every group blind on turn 1, no probes | ~77 | ~1 / 24 |
| Probe hubs, fence patiently after turn 12 | 38 | 13 / 24 |
| Probe hubs, contain dev/mgmt early (turn 4-5) | 30-59 (seed-dependent) | 1-13 / 24 |

The one finding worth a human's attention before tuning further: **blind,
uninformed fencing currently outscores every patient/observant strategy I
tried.** Containment (60 of 100 points) rewards blocking everything so
strongly, and the uptime penalty is capped at only 20 points regardless of
how many essential flows you break, that fencing every group on turn 1 with
zero observation beats waiting for good data. This is the opposite of the
design thesis. I did not change any constants (per instructions to leave
deeper tuning to a human on a real device), but flagging it here since it's
a direct contradiction of Section 10's own rule ("if a mechanic makes the
game easier to win by ignoring flow data, it is wrong").

Separately, and this one looks intentional rather than a bug: probing a hub
(`mon-01`, `jenkins-01`, `dns-01`, ...) permanently observes *all* of its
constant/periodic flows, not just the one you were watching for. If that
hub or a neighbor is later compromised, those now-permanently-observed
flows get allow-listed the moment you fence a zone touching them — turning
your own intel-gathering into the attacker's escape route. It's a sharp,
consistent lesson (real monitoring/DNS agents are classic lateral-movement
vectors), but it makes genuinely optimal play harder to find than my
heuristic strategies managed, which likely explains why my "careful"
strategies scored lower than intended.
