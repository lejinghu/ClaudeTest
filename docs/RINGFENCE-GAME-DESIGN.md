# RINGFENCE — Game Design

*A two-player asymmetric strategy game about lateral movement and Zero Trust.
You can learn the rules in ten minutes. Mastering them takes much longer.*

Status: design draft **v0.6 (territory)**. Numbers are starting values for
playtesting (Section 11). **Section 0 below is the current rule set.**
Sections 1–10 describe earlier versions and keep their history. The
v0.5 prototype is kept as `ringfence/v05.html` for comparison.

## 0. v0.6 at a glance: RINGFENCE as a territory game

**Why it changed.** Playtest feedback on v0.5: *"There is no grand strategy.
I just gain Insight and randomly block or allow,"* and *"infra feels
random, just some place to click first."* The v0.5 turns were one-offs:
Insight was a flat, wait-for-it economy; the facts that mattered (flows,
tokens) were hidden, so choices felt random; and the three services were
interchangeable. v0.6 makes positions pay off over time, and makes each
decision depend on the board.

**Goal**
- **Defender:** reach the Zero Trust target (18 on Normal), or survive to
  the end of round 8.
- **Attacker:** steal **one** jewel, or get footholds in **7 of the 11
  apps**: ransomware, meaning the blast radius was too big.

**Territory scoring.** At the start of each Defender turn from round 2:
- **+1 Zero Trust** per *secure app* (ring-fenced, no attacker inside) and
  per hardened service.
- **+3 Insight**, plus 1 per secure app.
- Securing early grows your economy: engine-building, as in Netrunner.

**Shared services with visible dependents.**
- Each app uses one or two of NTP (A B C D), DNS (D F G J K) and LDAP
  (C E H J L). Coloured dots on the board show which.
- An **unhardened service is a backdoor**: an Attacker stone can pass
  between the service and any app that uses it, even a ring-fenced one,
  because ring-fences allow infra traffic. Only Harden stops it.
- Only **DNS** is an exfiltration exit (tunnelling).
- Which service to harden first depends on where your jewels and territory
  are.

**Defender actions (3 per turn)**

| Action | Cost | Effect | Product stage |
|---|---|---|---|
| 👁 Observe | an action | Security Intelligence maps an app's flows; they show on your next turn | Stage 1: assess before you enforce |
| 🛡 Harden | 2 Insight | Close a service's backdoor (and DNS tunnelling); evict any stone on it | Stage 2: infrastructure services |
| ◎ Ring-fence | 3 Insight | Allow the app's observed flows, block the rest; unobserved flows break (outage −2) | Stage 4: microsegmentation |
| ★ Sensor | 1 Insight | Face-down IDS/IPS trap: removes the stone, ends the Attacker's turn | SSP threat prevention |
| ⛔ Isolate | 2 Insight | Emergency block on any edge, even a business flow (−2 if it breaks one) | Incident response |

**Attacker.** 3 actions per turn.
- Breach (once per turn) into row 1 or the storefront, then spread.
- Moving into a *different* app, through an allowed flow, or through a
  service backdoor costs **+1 action** each.
- Recon peeks at a token.
- Exfil works only from the turn after a jewel is found.

**Difficulty**

| Level | AI | Blast radius to win | Defender's starting Insight |
|---|---|---|---|
| Easy | random-ish | 8 apps | 6 |
| Normal | 1-step | 7 apps | 4 |
| Hard | 2-step look-ahead | 8 apps | 3 |

**The strategic tension.** Fortify the jewels against theft, or contain
the blast radius against ransomware. Harden the services your plan depends
on before you fence behind them. Observe before you fence, or pay for
outages. Spend on income now, or on Sensors and Isolate to answer threats.

**Balance (bot players, Attacker win rate, 200 games per cell)**

| Strategy | Easy | Normal | Hard |
|---|---|---|---|
| Fortress (jewel apps and their services) | 16% | 34% | 53% |
| Careful (fortress, then expand) | 13% | 37% | 52% |
| Infra-first | – | 30% | – |
| Territory (fence the most apps, fast) | 29% | 55% | 74% |
| Hasty (fences without observing) | – | 85% | 85% |
| Mindless (harden and fence everything, never observe) | 87% | 100% | 100% |

- Several plans are viable within a few points of each other; a smarter
  territory bot would probably close the gap for territory play.
- Skipping Observe is heavily punished.
- Median game length is 6 rounds.
- Wins come both ways: jewel theft and ransomware.

**Removed in v0.6:** Assess (income is automatic now), Segment (Isolate is
the manual wall), Allow (ring-fence publishes the recommendation), Swap,
global flow timeline and month-end surprises, and the any-service-to-
any-service hub. Stage 3 (environments) is still not modelled.

**What changed in v0.5 (always a way to respond).** In a playtest, the
player lost in a position where no legal move could stop the Attacker. The
jewel sat next to the internet-facing storefront, the Attacker was on both
sides of an observed business flow, and flows couldn't be walled. Fixes:
- **Safer setup.** The random setup never puts a jewel next to a breach
  point; before v0.5 that happened in 40% of setups. The setup screen warns
  when a player does it by hand.
- **ISOLATE (emergency quarantine).** For 2 Insight, block *any* edge, even
  a known business flow or an allowed exception. Breaking a running flow is
  an outage (−2 Score) that stays broken. You trade business impact for
  safety, as incident response does in practice.
- **Exfiltration takes a turn.** A jewel revealed this turn can only be
  stolen on the Attacker's next turn, because staging the data takes time.
  The Defender always gets one turn to respond.
- **Threat panel with suggested responses.** It says whether the Attacker
  can steal a jewel next turn, and offers the best responses with their
  cost (for example "Segment: wall g6–g7" or "Isolate g6–g7, −2 score").
  Tap one to do it.
- **Difficulty levels change the Attacker's actions per turn.** Easy: 3
  actions, with a random-ish AI. Normal: 4 actions. Hard: 4 actions, with
  two-step look-ahead.

**What changed in v0.4 (5-minute game).**
- **Shorter game.** One stolen Crown Jewel wins for the Attacker. The
  Defender wins at Segmentation Score **6** or when round **8** ends. The
  flow timeline is compressed: everyday flows are visible from round 2,
  month-end flows from round 3, and month-end flows first run in round 4.
  A game lasts about 4–5 rounds, roughly 5 minutes.
- **Busier network.** 15 hidden flows instead of 11, so a jewel's app has
  about 3 flows instead of 2.2. Ring-fencing the jewel's app is no longer
  airtight: in about a third of the Attacker's wins, the stolen jewel's app
  was already ring-fenced, and the Attacker got in through an allowed flow.
- **Bulk rule changes.** SEGMENT places any number of walls in one action
  (1 Insight per 2 walls), and ALLOW publishes any number of exceptions in
  one action.
- **Ring-fence publishes the recommendation.** Locking down an app now
  automatically allows every flow Security Intelligence has observed on its
  border, then blocks the rest. It's one action again and scores +1. **Allow**
  remains for adding exceptions later: flows found after the lockdown, or
  manual guesses.
- **Allowed flows aren't free paths.** Getting through a ring-fence over an
  allowed flow means exploiting that service, so that Spread costs the
  Attacker **2 actions**. The allowed service narrows the attack but doesn't
  close it, which is why IDS/IPS inspects allowed traffic.

**What changed in v0.3 (simpler board, secret swaps).**
- **No environments.** Simulation showed the Dev/Prod split hardly
  mattered: 263 of 280 stolen jewels went out through the internet-facing
  storefront, and the Attacker crossed the zone boundary about once every
  three games. The zone line, zone sealing and leakage alerts are gone, and
  tokens can go in any app. DFW Stage 3 (environments) is no longer modelled
  in play.
- **No Decoys.** At the same cost as a Sensor they were never the better
  choice. And a cheaper Decoy would give the bluff away, because Insight is
  public.
- **Secret swap.** The Defender can swap two face-down tokens, or only
  pretend to. The Attacker can't tell which, so its jewel odds for both
  tokens average out and any Recon on them goes stale. It's deliberately
  costly (Section 5.3).

**What changed in v0.2 (hidden flows).** In v0.1, business flows were printed
on the board and a ring-fence let them through automatically. Locking down
was always safe and always scored, so the best play was to ring-fence
everything without thinking. v0.2 follows the real Security Intelligence
workflow instead: *observe traffic → publish exceptions for valid flows →
lock down everything else.* Flows are hidden and drawn at random each game
(Section 5.7). Security Intelligence reveals them over time, and blocking a
real flow causes an outage. (v0.2 split ring-fencing into two actions,
Allow then Ring-fence; v0.4 merged them again, see above.) A playable browser
prototype (you as the Defender against an AI Attacker) is in
[`ringfence/`](../ringfence/).

---

## 1. Pitch

One player is the **Attacker**. They break in from the internet, spread
sideways through the datacenter, find the crown jewels and get the data out.

The other player is the **Defender**. They build visibility and use it to
segment the network, following **vDefend DFW 1-2-3-4**: assess, lock down
infrastructure services, then ring-fence
applications. The Security Services Platform (SSP) supplies the sensors that
watch traffic the firewall has to allow.

The Attacker races to steal **one Crown Jewel**. The Defender races to a
**Segmentation Score of 6** before round 8 ends.

| Borrowed from | What RINGFENCE takes |
|---|---|
| **Netrunner** | Asymmetric sides, 3 actions per turn, an economy of "take an action or gain a resource", face-down cards the other side has to guess at, and a two-sided race. |
| **Go** | Pieces that are placed and never move, connected groups, cutting points, capture by surrounding, and a fixed board that rewards knowing it well. |
| **Chess** | Perfect information about the board apart from the face-down tokens, forks, tempo, and openings you can study. |

### Design pillars

1. **The winning strategy is the product's method.** Players shouldn't need
   the marketing message read to them. It should be the strategy they work
   out for themselves (Section 2).
2. **Rules fit on one page.** The Attacker has 4 actions and the Defender has
   5. There are two piece types, and one tile type.
3. **Every action is a trade-off.** Any Defender action spent on visibility
   is an action not spent on enforcement. Any Attacker action spent on
   scouting is an action not spent spreading.
4. **No dominant line.** Doing 1-2-3-4 in textbook order is strong, but a
   good Attacker punishes a Defender who follows it without watching the
   board.

---

## 2. How the game promotes vDefend and SSP

The idea here is *procedural rhetoric*: the rules make the product's
approach the winning approach. After a few games, a player has learned the
following lessons through play:

| What the player learns | Rule that teaches it | vDefend / SSP message |
|---|---|---|
| "I can't do anything without Insight." | Every enforcement action costs Insight, and only **Assess** produces it. | **Stage 1: Security Segmentation Assessment & Report.** You can't segment what you can't see. Security Intelligence comes first. |
| "Harden the shared services on turn 1 or the Attacker hops straight into Prod." | Unhardened DNS/NTP/LDAP connect to one another and count as exfil exits. Hardening is cheap. | **Stage 2: Infrastructure Services Segmentation.** DNS, NTP and LDAP are auto-discovered and protected, which closes common C2 and exfiltration paths. A quick win with little disruption. |
| "If I lock down before I've seen the traffic, I break production." | Business flows are hidden. Security Intelligence reveals everyday flows from round 2 and month-end flows in round 4. Blocking a real flow is an **outage**: −2 Score, plus an emergency allow rule the Attacker can use. | **Security Intelligence** observes flows over a monitoring window before recommending policy. Enforcing without that history breaks applications. |
| "Exceptions first, then lock down." | **Ring-fence** publishes the recommendation (allow rules for every *observed* flow) and blocks everything else. Lock down before the flows are observed and you break production; **Allow** adds exceptions found later. | **Stage 4: Application Microsegmentation.** Security Intelligence recommends groups, services and allow rules. You review, publish, and ring-fence the app with a default drop. |
| "Placing walls one at a time is whack-a-mole. Ring-fencing wins." | **Ring-fence** blocks an app's whole border in one action and scores +3. Single walls cost more for the same coverage. | Application ring-fencing: allow required inter-app traffic, deny the rest. |
| "Every exception is an attack path." | Exceptions and emergency allows stay open to the Attacker. Unnecessary manual exceptions show up in the end-game debrief. Only sensors stop an Attacker who uses an allowed flow. | **SSP / vDefend Advanced Threat Prevention.** Distributed IDS/IPS, malware prevention and NDR inspect the traffic the firewall allows. **Firewall Rule Analysis** flags overly permissive rules. |
| "My score is my progress toward Zero Trust." | The Defender wins by reaching **Segmentation Score 10**. | The segmentation score in the DFW 1-2-3-4 report, which shows measurable progress toward Zero Trust. |
| *(advanced)* "Leftover rules waste my budget." | Wall supply is limited. **Rule Analysis** recovers redundant walls. | **Firewall Rule Analysis**: finds duplicate, redundant, shadowed, contradictory, overly permissive and ineffective rules. |

The Defender's first four actions are numbered **1-2-3-4** on the board and
the player aid, so every game repeats the product's structure.

---

## 3. Components

- 1 board: a 7×7 datacenter (Section 4)
- 20 red **Attacker stones**
- 12 blue **walls**: bars that sit on the edge between two cells
- 3 **Hardened** caps, one for each infrastructure cell
- 11 **Ring-fence** rings, one for each application
- **Defender tokens**, all with the same back:
  - 3 Crown Jewel
  - 6 Sensor (3 used at setup, 3 left in the Deploy pool)
- A **swap screen**, so the Defender can swap two tokens, or pretend to, without being seen
- **Insight** chips, about 20
- 19 **Flow cards**, one for each pair of neighbouring apps, each naming one
  shared edge and marked *everyday* or *month-end*. 15 are dealt face-down
  each game (Section 5.7).
- Green **allow-rule** clips, plus orange **emergency allow** clips
- A **Segmentation Score** track from 0 to 10, and a round track from 1 to 12
- 2 player aids

---

## 4. The board

```
                 I N T E R N E T
        a     b     c     d     e     f     g
     ┌─────┬─────┬─────┬─────┬─────┬─────┬─────┐
  1  │  A  │  A  │  B  │  B  │  B  │  C  │  C  │
     ├─────┼─────┼─────┼─────┼─────┼─────┼─────┤
  2  │  A  │  A  │  B  │ NTP │  B  │  C  │  C  │
     ├─────┼─────┼─────┼─────┼─────┼─────┼─────┤
  3  │  D  │  D  │  D  │  D  │  E  │  E  │  E  │
     ├─────┼─────┼─────┼─────┼─────┼─────┼─────┤
  4  │  F  │ DNS │  G  │  G  │  G  │LDAP │ H*  │
     ├─────┼─────┼─────┼─────┼─────┼─────┼─────┤
  5  │  F  │  F  │  F  │  G  │  J  │ H*  │ H*  │
     ├─────┼─────┼─────┼─────┼─────┼─────┼─────┤
  6  │  K  │  K  │  J  │  J  │  J  │  L  │ H*  │
     ├─────┼─────┼─────┼─────┼─────┼─────┼─────┤
  7  │  K  │  K  │  K  │  J  │  L  │  L  │  L  │
     └─────┴─────┴─────┴─────┴─────┴─────┴─────┘
                                          * = internet-facing
```

### Applications

| App | Cells | Flavor |
|---|---|---|
| A | a1 b1 a2 b2 | Developer desktops |
| B | c1 d1 e1 c2 e2 | Build agents |
| C | f1 g1 f2 g2 | Test harness |
| D | a3 b3 c3 d3 | CI/CD pipeline |
| E | e3 f3 g3 | Staging |
| F | a4 a5 b5 c5 | HR system |
| G | c4 d4 e4 d5 | Inventory |
| H* | g4 f5 g5 g6 | Web storefront (internet-facing) |
| J | e5 c6 d6 e6 d7 | App / API tier: the hub |
| K | a6 b6 a7 b7 c7 | Customer database |
| L | f6 e7 f7 g7 | Payments |

### Infrastructure services

**NTP** (d2), **DNS** (b4) and **LDAP** (f4) don't belong to any
application.

### Business flows (hidden)

Applications talk to their neighbours over **business flows**. Each flow
runs over one specific edge between two different apps. The flows are
different every game, and nobody sees them at the start. See Section 5.7.

### Key terms

- **Edge**: the side shared by two orthogonally adjacent cells.
- **Border edge**: an edge between two different regions. Each app, each
  infrastructure cell counts as a region. Only border edges can
  take walls. Section 5.3 has one exception.
- **Open edge**: an edge the Attacker can cross. Rules apply in this order,
  as in a real firewall policy: a **wall** blocks the edge; otherwise an
  **allow rule** (exception) opens it; otherwise a **ring-fence** on either
  side blocks it; otherwise it's open.
- **Hub rule**: all *unhardened* infrastructure cells count as adjacent to
  one another, because shared services reach everything.
- **Group**: attacker stones connected through open edges, including through
  the hub rule.
- **Exit**: any row-1 cell, any internet-facing (H*) cell, or any unhardened
  infrastructure cell. Exits are where data can leave the network.

---

## 5. Rules

### 5.1 Setup

1. The Defender secretly places **3 Crown Jewels and 3 Sensors** face-down,
   **each in a different app**. Tokens can't go on infrastructure cells. A
   jewel on an exit (row 1 or H*) can be stolen in two actions, so most
   players keep jewels deeper.
2. The Defender takes **3 Insight**. The Score track starts at 0 and the
   round track at 1.
3. The Deploy pool (3 Sensors) goes beside the Defender.

### 5.2 Turn structure

Each **round**, the Defender takes a turn and then the Attacker takes a turn.
The Defender takes **3 actions** per turn. The Attacker takes 3 at Easy
difficulty and 4 at Normal and Hard. Actions can be taken in any order and
repeated.

### 5.3 Defender actions

| # | Action | Cost | Effect |
|---|---|---|---|
| **1** | **ASSESS** | 0 Insight | Gain **2 Insight**. |
| **2** | **HARDEN** | 1 Insight | Cap one infrastructure cell and remove any attacker stone on it. From then on, the Attacker can't enter that cell, it isn't an exit, and it's no longer part of the hub. **+1 Score.** |
| **3** | **SEGMENT** | 1 Insight per 2 walls (rounded up) | Place **any number of walls** on border edges in one action, from a supply of 12. Walls can split an attacker group. Observed flows can't be walled. Walling a flow you haven't observed yet causes an outage. |
| **4** | **RING-FENCE** | Insight equal to the app's size (3–5) | Put a ring on the app. The Security Intelligence recommendation is published with it: every *observed* flow on the border gets an allow rule. Every other border edge is blocked. **+1 Score.** |
| ⛔ | **ISOLATE** | 2 Insight | Emergency block on **any** edge, including known business flows and allowed exceptions (uses a wall from supply). If a business flow runs there, it's an outage (−2 Score) that stays broken, charged once. |
| **+** | **ALLOW** | Free, +1 Insight per manual exception | Add exceptions later: allow rules for flows observed after the lockdown, plus **manual exceptions** on other border edges for 1 Insight each. |
| ★ | **DEPLOY** | 1 Insight | Place a Sensor from your pool face-down on any empty cell that has no token. This is the SSP / IDS/IPS action. The Attacker sees it placed, so it knows it's a Sensor until a swap blurs it. |
| ⇄ | **SWAP** | 3 Insight, max 2 per game *(playtest alternative: −1 Score each)* | Behind the screen, pick up two face-down tokens and put them back either swapped or not. Only you know which. Neither token may be next to an attacker stone. Once per turn. The Attacker's knowledge of both tokens resets: its jewel odds for each become the average of the two. |

Additional Defender rules:

- **Tier-level fine-tuning (Stage 4c).** Inside a ring-fenced app, SEGMENT
  can also put walls on edges *between cells of that app*.

### 5.4 Attacker actions

| Action | Effect |
|---|---|
| **BREACH** | *Once per turn.* Place a stone on any empty cell in row 1 or in H*. |
| **SPREAD** | Place a stone on an empty cell that is adjacent, through an open edge, to one of your stones. This includes moves between unhardened infrastructure cells under the hub rule. If the only way in is across a ring-fence over an **allowed flow**, the Attacker is exploiting that service, and the Spread costs **2 actions**. |
| **RECON** | Secretly look at one face-down token on a cell adjacent, through an open edge, to one of your stones. |
| **EXFIL** | If one of your stones sits on a revealed Crown Jewel **and** is in the same group as a stone on an exit, take the Jewel. **Not on the turn the jewel was revealed:** staging the data takes a turn. |

Stones never move. You may place a stone next to your group even when a wall
separates them. They just won't be connected.

### 5.5 Face-down tokens

When an attacker stone enters a cell that has a face-down token, flip the
token over:

- **Crown Jewel**: the stone stays. The Jewel can now be exfiltrated.
- **Sensor** (IDS/IPS): remove the stone and discard the Sensor. **The
  Attacker's turn ends immediately.**

### 5.6 Quarantine (capture)

After every Defender action, check each attacker group. A group with **no
open edge to an empty cell** is quarantined: remove all its stones.
**+1 Score** for each group removed. The Internet doesn't count as an empty
cell. Cells that have tokens do count as empty.

### 5.7 Hidden business flows and outages

- **Setup.** Shuffle the 19 Flow cards and deal 15 face-down. Every app must
  have at least one flow; in the digital version the deal guarantees it.
  Roughly 30% of flows are *month-end* flows.
- **Security Intelligence.** At the start of **round 2**, reveal every
  *everyday* flow. At the start of **round 3**, reveal the *month-end* flows:
  the look-back now reaches last month's run.
- **Outages.** Everyday flows run from round 1; month-end flows first run in
  **round 4**. Whenever a running flow's edge is blocked by a wall or a
  ring-fence without an allow rule, there's an outage. Check after each
  Defender action and at the start of each Defender turn. An outage costs
  **−2 Score**. Any wall on the edge is removed, and an orange **emergency
  allow** rule is placed there. It stays open to the Attacker for the rest of
  the game.
- **Tabletop referee.** The Attacker (or an app) checks the face-down cards
  when the Defender blocks an edge, and announces any outage.

### 5.8 Winning

- The **Attacker** wins as soon as they have exfiltrated **one Crown Jewel**.
- The **Defender** wins at the end of any Defender turn with **Score ≥ 6**.
  Score can go below zero after outages.
- If round 8 ends with no winner, the **Defender** wins: the attacker's
  campaign has been detected and evicted.

---

## 6. Worked example: the first five rounds

*This example was written for v0.1, where the five flows below were printed
on the board and could never be walled, and a Dev/Prod zone line ran between
rows 3 and 4. It still shows the spatial ideas:
hub hops, cutting groups, and forks. Read "business flow" as "a flow the
Defender has allowed".*

Setup, known only to the Defender:

| App | Token cell | Token |
|---|---|---|
| F | a5 | Sensor |
| G | e4 | **Jewel** |
| H | g5 | Sensor |
| J | d6 | Sensor |
| K | a7 | **Jewel** |
| L | g7 | **Jewel** |

**R1 Defender** (3 Insight)
- HARDEN NTP, then HARDEN LDAP. The NTP → DNS hub hop is now shut.
- SEGMENT: walls on **e3–e4** (to protect the G jewel) and **f5–f6** (to
  keep the storefront out of Payments).
- *Insight 0 · Score 2*

**R1 Attacker**
- BREACH **c1**, then SPREAD **c2** and **c3**.
- c3 now touches the zone boundary, and D also leads into the CI/CD flow.

**R2 Defender**
- ASSESS (+2).
- SEGMENT: walls on **c3–c4** and **b3–b4**.
- HARDEN DNS.
- *Insight 0 · Score 3*. The Dev side can now reach Prod only through a3–a4
  and g3–g4, plus the CI/CD flow d3–d4, which can't be walled. (f3–f4 is
  still open, but it leads into hardened LDAP.)

**R2 Attacker**
- SPREAD **d3**, then SPREAD **d4** *through the CI/CD flow*.
- RECON **e4**: it's a Jewel. The group c1-c2-c3-d3-d4 already reaches an
  exit (c1). Next turn the Attacker can SPREAD e4 and EXFIL: a threat that
  lands in two actions.

**R3 Defender**
- ASSESS, ASSESS (Insight 4).
- RING-FENCE **D** (cost 4). This walls c2–c3 and every other D border
  except the flow, so the Prod-side group c3-d3-d4 is cut off from every
  exit. A single wall on c2–c3 would also have cut it, but the Attacker
  could reconnect next turn through b3–b2, a3–a2 or d3–e3. The ring-fence
  closes all of those routes for good, and it scores.
- *Insight 0 · Score 5*

**R3 Attacker** finds another way in:
- SPREAD **e4**, revealing the Jewel.
- BREACH **f5**. The storefront is internet-facing, and H's token is on g5.
- SPREAD **e5** across the storefront ↔ API flow.
- e5 touches e4 across an open G–J border, so jewel and exit are in one
  group again. EXFIL is one action away.

**R4 Defender**
- ASSESS (Insight 2).
- SEGMENT: walls on **e4–e5** and **d5–e5**. The jewel group is cut off
  again.
- DEPLOY a face-down Sensor on **d5**. This covers the other way round:
  d4 → d5 → through the flow into J.
- *Insight 0*

**R4 Attacker** opens a second front:
- BREACH **g6**.
- SPREAD **f6** (the H–L border here is still open), then SPREAD **f7**.
- The Payments jewel at g7 is now one SPREAD plus one EXFIL away. The G
  jewel is still revealed and waiting. This is a **fork**.

**R5 Defender** can hold both fronts, but it costs the whole turn:
- ASSESS (Insight 2).
- SEGMENT: walls on **g6–f6** and **g6–g7**. Without the g6–g7 wall, a
  stone on g7 would sit next to the exit on g6.
- That still isn't enough. L also connects to J through the Payments flow
  e6–e7, and from J the flow e5–f5 leads back to an exit. A flow can't be
  walled, so the Defender spends the last action on DEPLOY at **e6**.
- *Insight 0 · Score 5.* Every jewel is covered for now, but the Defender
  made no progress on Score this turn. The Attacker has taken the tempo.

The game's main lesson shows up at the table here: **zones and ring-fences
shrink the attack surface, but allowed flows still need inspection.**

---

## 7. Where the depth comes from

- **A two-sided race with interaction.** Nearly every Defender scoring action
  (Harden, Ring-fence) also blocks the Attacker. So
  "defend or score" is seldom a clean choice. The good question is which
  scoring move also defends against the current threat.
- **Go-style connectivity.** A stolen jewel has to be *connected* to an exit.
  Cutting points, alternative routes and paths the Defender can't cover in a
  single SEGMENT are the Attacker's main tools. In go, a group with two eyes
  lives. Here, each extra independent route to an exit costs the Defender
  another wall to cut.
- **Asymmetric information.** The Defender knows where the jewels are, and
  the Attacker has to guess. RECON costs an action, and a Sensor ends the
  whole turn, so every step into an unscouted token cell is a bet. A secret
  SWAP (real or bluffed) turns the Attacker's hard-won Recon back into a
  coin flip, but at a real cost.
- **Economy and tempo.** ASSESS feeds every other Defender action, like
  Netrunner's "click for a credit". Ring-fencing when you have exactly
  enough Insight, or holding Insight for a response, is the central
  Defender skill.
- **Forks.** The Attacker usually wins by creating two threats that each
  need a separate answer: two jewels, or one jewel with two routes to an
  exit.
- **Fixed, learnable board.** The map is always the same, as in chess and
  go, so openings, jewel placements and standard counters can be studied.
  Examples: "Harden NTP first", "the H-rush", "the CI/CD sneak".

---

## 8. Strategy primer (also the booth talk track)

**Defender**

1. Harden the infrastructure early. It's the cheapest point on the board and
   it shuts down hub hopping and DNS exfiltration. *(Stage 2 quick win.)*
2. Don't let Insight sit idle, and don't run out of it either. Try to end
   each turn able to answer the most dangerous threat.
3. A ring-fence is worth more than walls. It shuts a whole border in one
   action, scores, and leaves more walls in your supply.
4. Observe, allow, then lock down. Don't ring-fence an app before round 2,
   when you can't see any of its flows yet. Publish its recommendation
   and ring-fence after round 2, when the recommendation covers the everyday
   flows. Check the round-3 month-end flows
   against apps you've already locked down.
5. Put sensors where your exceptions land. Allowed flows are paths you
   can't wall. Emergency allows from outages are paths you never chose.
6. Jewel placement is a bluff. Putting all three deep in K and L is
   predictable. Save swaps for when the Attacker has scouted a jewel or is
   about to reach one. At 3 Insight, swapping casually loses games.

**Attacker**

1. Go wide early, before the ring-fences go up. Every foothold you establish
   before the walls go up costs the Defender time.
2. Use flows. They can't be walled, so the Defender has to spend Insight on
   sensors to cover them.
3. Keep several routes to an exit. A SEGMENT action places only 2 walls and
   costs Insight, so each extra route makes you more expensive to cut.
4. RECON before any step you can't afford to lose. A Sensor costs you the
   rest of your turn.
5. Fork: threaten two jewels at once, or threaten one jewel through two
   routes.

---

## 9. Advanced modules

These are optional. Add them one at a time once the core game is familiar.

### 9.1 Threat Actor identities

The Attacker picks one identity. This works like Netrunner IDs.

| Identity | Ability |
|---|---|
| **Ransomware crew** | 4 actions per turn. Each stone you place in Prod gives the Defender +1 Insight, because you're noisy. |
| **APT** | Your first RECON each turn is free. A Sensor removes your stone but doesn't end your turn. |
| **Insider** | You can BREACH onto any Dev cell, not just row 1. You get only 2 actions in round 1. |
| **Supply-chain** | Once per game, BREACH into any cell of app D, even from inside Prod. |

### 9.2 SSP capability loadout

The Defender picks **2 of 5** at setup. Each can be used **once per game**
as a free action.

| Capability | Effect |
|---|---|
| **Distributed IDS/IPS** | When a Sensor triggers, it stays on the board face-up. It isn't discarded. |
| **Malware Prevention** | When a Sensor triggers, also remove one attacker stone adjacent to it. |
| **NDR** (campaign correlation) | Remove up to 3 connected attacker stones. None of them can be on a Jewel. |
| **Rule Recommendations** | Your next RING-FENCE costs 2 less. |
| **Firewall Rule Analysis** | Return every wall made redundant by a ring-fence to your supply, and gain +1 Insight for each wall returned. A wall is redundant when it sits on an edge the ring-fence now covers. |

### 9.3 Rule budget

Reduce the wall supply to **8**. Firewall Rule Analysis becomes an everyday
action instead of a one-off: 1 action, 0 Insight. This teaches rule
hygiene, and it fits the "overly permissive / shadowed rules" part of the
product story.

### 9.4 Alternate datacenters

Additional fixed maps with different layouts. For example: a
two-internet-edge "hybrid cloud" map, or a map where J is split into two
tiers. The standard map stays as the tournament board.

### 9.5 Quick Match (booth format)

Use the same board. The Attacker needs **1 Jewel** and the Defender needs
**Score 7**, with a 6-round limit. A match takes about 10 minutes.

---

## 10. Formats and how to use them for promotion

| Format | Use | Notes |
|---|---|---|
| **Web game** (1 player vs AI, or hot-seat) | Landing pages, email campaigns, social | Plain static HTML/JS, the same stack as the rest of this repo. The AI is scripted heuristics or MCTS. Show the Segmentation Score on the end screen: "You reached Zero Trust in 7 rounds". |
| **Booth tabletop** | Trade shows and user groups | Big mat, wooden pieces, Quick Match rules. A staff member plays the Attacker and the visitor defends. Afterward, hand over the **debrief card**. |
| **Print & Play PDF** | Partners, SE enablement, workshops | Board, tokens and player aids on 4 pages. |
| **Tournament / leaderboard** | Community events, internal SE training | Standard board. Each pairing plays both sides. Rank by wins, then by fewest rounds taken to win. |

**Debrief card** (given out after every demo game):

> *In the game you…*
>
> - **Assessed** → vDefend Security Intelligence: Segmentation Assessment & Report
> - **Hardened DNS/NTP/LDAP** → DFW 1-2-3-4 Stage 2: Infrastructure Services
> - **Ring-fenced apps** → Stage 4: Application microsegmentation
> - **Deployed sensors on allowed flows** → Distributed IDS/IPS, Malware Prevention, NDR on SSP
>
> *Now do it on your real network* → [CTA / QR code]

---

## 11. Balance and playtest plan

### Starting values and the levers to adjust

| Lever | v0.3 value | If the Attacker wins too often | If the Defender wins too often |
|---|---|---|---|
| Swap cost | 3 Insight, max 2 per game | 2 Insight | 4 Insight or 1 per game |
| Ring-fence score | +3 | +4 | +2 |
| ALLOW cost (recommendation) | 0 Insight | 0 | 1 |
| Outage penalty | −2 Score | −1 | −3 |
| Hidden flows per game | 15, ~30% month-end | 13 | 17 |
| Everyday / month-end flows visible from | round 2 / round 4 | round 1 / round 3 | round 3 / round 5 |
| Defender starting Insight | 3 | 4 | 2 |
| ASSESS yield | 2 | 3 on the first ASSESS each turn | 2, unchanged |
| Ring-fence cost | app size | size − 1 | size + 1 |
| Score target | 10 | 9 | 11–12 |
| BREACH per turn | 1 | 1, but not into H* after H is ring-fenced | 2 |
| Sensor on trigger | ends turn | also removes the adjacent stone | stone removed, turn continues |
| Round limit | 12 | 10 | 14 |

### Known risks to check first

1. **H-rush.** The storefront is internet-facing and touches L, J and LDAP.
   Check that an Attacker who opens by breaching H and heading for Payments
   can't win by force. If they can, move L so it no longer touches H.
2. **Defender-favoured after v0.3.** Removing environments helped the
   Defender. With no swaps, a careful bot now loses 44% of games against
   Hard (down from 57% in v0.2) and 29% against Normal. Candidate fixes:
   score target 11, or ring-fence +2.
3. **Mindless lockdown (found in v0.1 playtesting).** Ring-fencing every app
   as fast as possible was the dominant strategy. v0.2 fixes this with
   hidden flows and outages. Simulated evidence is below.
4. **Slow turns.** Three actions with lookahead can make players think for a
   long time. If turns run over about 90 seconds, consider 2 actions per
   turn for the Attacker and for the Quick Match format.

### Simulation results for v0.2

These are 200 games per row against the AI Attacker
(`node ringfence/tools/sim.js 200 hard [--mindless|--hasty]`). The
*mindless* Defender hardens infrastructure, then ring-fences apps as soon as
it can afford them, with no exceptions. The *careful* Defender waits for flow
data, publishes exceptions, then ring-fences, and responds to threats.

| Defender | vs Easy | vs Normal | vs Hard | Outages per game |
|---|---|---|---|---|
| Mindless lockdown | 97% attacker wins | 98% | 98% | about 4.4 |
| Careful: observe → allow → ring-fence | 45% | 54% | 57% | about 0.1 |

Under v0.1 rules the same careful bot faced a 30–38% attacker win rate. The
v0.2 values in the table above were tuned (ALLOW free, ring-fence +3) to put
a careful Defender near 50%.

### v0.5 balance (current)

These are 300 games per row, with score target 6, one jewel to win, the
exfiltration delay, and ISOLATE available. The numbers are the bot player's
(Defender's) win rate.

| Level | Careful | Hasty (locks down early) | Mindless | Median round |
|---|---|---|---|---|
| Easy: random-ish AI, 3 actions | 85% | – | 32% | 6 |
| Normal: AI, 4 actions | 67% | 67% | 20% | 5 |
| Hard: look-ahead AI, 4 actions | 37% | 37% | 10% | 5 |

- The careful bot finds the best response every time, so real players should
  land lower, near the targets of 70% / 55–60% / 40–45%.
- A scripted player that simply follows the threat panel's suggestions won 2
  of 4 browser games on Normal.
- The skill gap between careful and mindless play is 47–53 points.
- Open issue: hasty and careful now score the same, so "observe before you
  lock down" has weakened. The exfiltration delay and ISOLATE let a hasty
  Defender recover. A candidate fix is making outages more expensive (−3).

### v0.4 balance (5-minute settings)

These are 300 games per row, with one jewel to win, score target 6,
ring-fence +1, round limit 8, 15 flows, exploiting an allowed flow costing 2
actions, and unlimited walls per SEGMENT.

| Defender bot | vs Normal | vs Hard | Median round | Outages per game |
|---|---|---|---|---|
| Careful: waits for flow data, responds to threats | 42% | 50% | 4–5 | 0.11 |
| Hasty: locks down before flow data | – | 57% | 4 | 0.48 |
| Mindless: harden, then ring-fence everything ASAP | 85% | 84% | 4 | 0.5 |

Flow count (score target 7, before the final tuning): with 11 flows the
careful Defender faced 54% Attacker wins vs Hard, with 15 flows 66%, and
with 19 flows 79%. The score target was lowered to 6 to rebalance 15 flows.

The numbers are the Attacker's win rate.

How the v0.4 values were chosen:
- With auto-allow and the old values (target 10, ring-fence +3, 2 jewels),
  the Attacker won only 2–8% of games, and mindless lockdown was as good as
  careful play.
- Ring-fence +1 restores the gap between careful and mindless play.
- One jewel to win and a shorter clock keep the game at about 5 rounds.
- On the crossing rule (with the old values): allowed flows as free paths
  gave 8% Attacker wins vs Hard, the 2-action exploit 6%, and fully blocked
  flows 0.7%. Blocking them entirely would also make exceptions harmless,
  so the exploit rule was kept.

### Swap cost test (v0.3)

These are 300 games per row against the AI Attacker, using the same seeds
across rows. The careful bot swaps a real jewel with a Sensor. Two policies
were tested: *selective* swaps only for a gain of 2 or more actions of
distance, while the jewel is scouted or the Attacker is within 5. *Eager*
swaps for any gain while the Attacker is within 6.

| Swap rule | Policy | Swaps per game | Attacker wins vs Hard | vs Normal |
|---|---|---|---|---|
| No swapping | – | 0 | 43.7% | 28.7% |
| 3 Insight, max 2 | selective | 0.30 | 40.3% | 25.3% |
| 3 Insight, max 2 | eager | 0.76 | **47.0%** (worse than no swaps) | 31.0% |
| −1 Score, no limit | selective | 0.35 | 38.7% | 23.7% |
| −1 Score, no limit | eager | 0.87 | **34.7%** (best) | 21.3% |
| −1 Score, max 2 | eager | 0.85 | 34.3% | 21.7% |

At −1 Score, swapping whenever it helps is the best policy, so it becomes a
routine move. At 3 Insight, careless swapping loses while selective
swapping wins, so it stays a deliberate, costly decision. **3 Insight, max 2
per game is the default.** The −1 Score rule can be chosen in the
prototype's Settings (or with `?swap=score`) for side-by-side playtesting.
The cap of 2 never came into play in these runs.

With ±2.8 percentage points of noise at 300 games, only the eager rows
differ clearly between the two rules.

### Balanced and fun: targets and process

The simulator can show whether the game is balanced. Only people can show
whether it's fun. We track both against these targets.

| Target | Goal | Where it's measured | Now (bots, v0.4) |
|---|---|---|---|
| Skill matters | A careful player beats a mindless one by 30+ points | `sim.js` vs `--mindless` | 50% vs 84% Attacker wins (34 points) ✓ |
| No dominant strategy | No single plan wins more than 60% | new bot strategies in `sim.js` | ✓ for the strategies tried |
| Easy | Player wins about 70% | playtest report | bot wins 52%: probably too hard |
| Normal | Player wins 55–60% | playtest report | bot wins 58% ✓ |
| Hard | Player wins 40–45% | playtest report | bot wins 50%: slightly soft |
| Length | About 5 minutes, 4–6 rounds | playtest report | 4–5 rounds ✓; minutes still to measure |
| Fun | Average rating ≥ 4/5, no action under 5% or over 40% of plays | playtest report | to measure |

Fun comes from a real dilemma every turn, from tension (games decided late,
with the threat visible), from losses the player understands, and from
surprises the player could have seen coming. The **threat highlight** and the
Security Intelligence warnings serve the last three.

Process: change one thing at a time. Rerun the bot suite after every rules
change. Then run human playtests with the in-game feedback and
`playtest-report.js`, and record the before and after numbers here.

Known "no-brainer" moves to fix next:
- Hardening all three services on turn 1.
- Assess as a plain "+2 Insight".
- In 5-minute mode, there may be more actions than a booth visitor needs.

### Plan

1. **Paper, internal, about 20 games.** Record the winner, the round, the
   Defender's action counts, and the jewel placements.
2. **Rules engine with bot self-play.** Build a headless rules module that
   runs thousands of games between scripted and MCTS bots. Targets:
   - Attacker win rate between 45% and 55%
   - median game length of 7 to 10 rounds
   - no action used in fewer than 5% or more than 40% of turns
   - no single opening winning more than 60% of games
3. **External playtest** at a user group, with the Quick Match format and a
   survey. The key question: *"Which DFW 1-2-3-4 stage can you name without
   looking?"* This measures whether the promotion worked.

---

## 12. Brand and legal note

RINGFENCE names Broadcom products (vDefend, SSP, DFW 1-2-3-4) on purpose,
because promoting them is the point. Before the game is shown in public,
Broadcom brand and legal teams should review it. Terms like "Distributed
IDS/IPS", "Malware Prevention" and "NDR" should also be checked against the
current product names.

The core rules (Section 5) use only generic terms: Assess, Harden, Segment,
Ring-fence, Deploy. All the product references sit in a separate layer: the
Section 2 mapping, the debrief card, and the capability names in 9.2. That
layer can be reworded or removed without changing any rule.

Source for the product mapping: [vDefend DFW 1-2-3-4 for VCF (VMware
Security blog, Nov 2025)](https://blogs.vmware.com/security/2025/11/vdefend-dfw-1-2-3-4-vcf.html).

---

## 13. Next steps

1. Print the board from Section 4 and play the worked example (Section 6)
   through to the end. This checks the rules for gaps.
2. Build the headless rules engine, and use bot self-play to test the three
   known risks (Section 11).
3. Build a web version: a single-player Defender against an AI Attacker. It
   can sit alongside `blast-radius/` and `index.html` in this repo.
4. Design the art and debrief card together with the brand review.
