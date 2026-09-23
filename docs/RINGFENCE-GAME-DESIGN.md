# RINGFENCE — Game Design

*A two-player asymmetric strategy game about lateral movement and Zero Trust.
You can learn the rules in ten minutes. Mastering them takes much longer.*

Status: design draft v0.1. Rules are complete and playable on paper. Numbers
are starting values for playtesting (Section 11).

---

## 1. Pitch

One player is the **Attacker**. They break in from the internet, spread
sideways through the datacenter, find the crown jewels and get the data out.

The other player is the **Defender**. They build visibility and use it to
segment the network, following the four stages of **vDefend DFW 1-2-3-4**:
assess, lock down infrastructure services, separate zones, then ring-fence
applications. The Security Services Platform (SSP) supplies the sensors that
watch traffic the firewall has to allow.

The Attacker races to steal **2 Crown Jewels**. The Defender races to a
**Segmentation Score of 10**.

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
| "One Dev laptop shouldn't reach Prod." | Walls on the zone boundary are cheap. Sealing it scores +2 and raises leakage alerts. | **Stage 3: Environment (Zone) Segmentation.** Dev/Prod boundaries with continuous leakage alerting. |
| "Placing walls one at a time is whack-a-mole. Ring-fencing wins." | **Ring-fence** blocks an app's whole border in one action and scores +2. Single walls cost more for the same coverage. | **Stage 4: Application Microsegmentation.** Map apps, ring-fence them, then fine-tune tier-level controls. |
| "Allowed traffic is still an attack path." | Business-flow edges can **never** be walled. Only sensors stop an Attacker using them. | **SSP / vDefend Advanced Threat Prevention.** Distributed IDS/IPS, malware prevention and NDR inspect the traffic the firewall allows. |
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
  - 3 Decoy (Deploy pool only)
- **Insight** chips, about 20
- A **Segmentation Score** track from 0 to 10, and a round track from 1 to 12
- 2 player aids

---

## 4. The board

```
                 I N T E R N E T
        a     b     c     d     e     f     g
     ┌─────┬─────┬─────┬─────┬─────┬─────┬─────┐
  1  │  A  │  A  │  B  │  B  │  B  │  C  │  C  │   DEV ZONE
     ├─────┼─────┼─────┼─────┼─────┼─────┼─────┤
  2  │  A  │  A  │  B  │ NTP │  B  │  C  │  C  │
     ├─────┼─────┼─────┼─────┼─────┼─────┼─────┤
  3  │  D  │  D  │  D  │  D  │  E  │  E  │  E  │
     ╞═════╪═════╪═════╪══┊══╪═════╪═════╪═════╡   ← zone boundary
  4  │  F  │ DNS │  G  │  G  │  G  │LDAP │ H*  │   PROD ZONE
     ├─────┼─────┼─────┼─────┼─────┼─────┼─────┤
  5  │  F  │  F  │  F  │  G  │  J  ┊ H*  │ H*  │
     ├─────┼─────┼─────┼──┊──┼─────┼─────┼─────┤
  6  │  K  │  K  ┊  J  │  J  │  J  │  L  │ H*  │
     ├─────┼─────┼─────┼─────┼──┊──┼─────┼─────┤
  7  │  K  │  K  │  K  │  J  │  L  │  L  │  L  │
     └─────┴─────┴─────┴─────┴─────┴─────┴─────┘
      ┊ = business flow (can never be walled)     * = internet-facing
```

### Applications

The **Dev zone** covers rows 1–3:

| App | Cells | Flavor |
|---|---|---|
| A | a1 b1 a2 b2 | Developer desktops |
| B | c1 d1 e1 c2 e2 | Build agents |
| C | f1 g1 f2 g2 | Test harness |
| D | a3 b3 c3 d3 | CI/CD pipeline |
| E | e3 f3 g3 | Staging |

The **Prod zone** covers rows 4–7:

| App | Cells | Flavor |
|---|---|---|
| F | a4 a5 b5 c5 | HR system |
| G | c4 d4 e4 d5 | Inventory |
| H* | g4 f5 g5 g6 | Web storefront (internet-facing) |
| J | e5 c6 d6 e6 d7 | App / API tier: the hub |
| K | a6 b6 a7 b7 c7 | Customer database |
| L | f6 e7 f7 g7 | Payments |

### Infrastructure services

**NTP** (d2), **DNS** (b4) and **LDAP** (f4) don't belong to any
application.

### Business flows

These edges can **never** be walled. The business needs them to run.

1. **d3–d4**: CI/CD deploys to Inventory. This flow crosses the zone
   boundary.
2. **d5–d6**: Inventory ↔ API tier
3. **e5–f5**: API tier ↔ Web storefront
4. **b6–c6**: API tier ↔ Customer DB
5. **e6–e7**: API tier ↔ Payments

### Key terms

- **Edge**: the side shared by two orthogonally adjacent cells.
- **Border edge**: an edge between two different regions. Each app, each
  infrastructure cell and each zone counts as a region. Only border edges can
  take walls. Section 5.3 has one exception.
- **Open edge**: an edge with no wall on it and no ring-fence blocking it.
  Flows are always open.
- **Hub rule**: all *unhardened* infrastructure cells count as adjacent to
  one another, because shared services reach everything.
- **Group**: attacker stones connected through open edges, including through
  the hub rule.
- **Exit**: any row-1 cell, any internet-facing (H*) cell, or any unhardened
  infrastructure cell. Exits are where data can leave the network.

---

## 5. Rules

### 5.1 Setup

1. The Defender secretly puts **one face-down token on one cell of each Prod
   app**: 3 Crown Jewels and 3 Sensors, 6 tokens in all. Tokens can't go on
   infrastructure cells.
2. The Defender takes **3 Insight**. The Score track starts at 0 and the
   round track at 1.
3. The Deploy pool (3 Sensors, 3 Decoys) goes beside the Defender.

### 5.2 Turn structure

Each **round**, the Defender takes a turn and then the Attacker takes a turn.
On a turn you take **3 actions**, in any order. You can repeat an action.

### 5.3 Defender actions

| # | Action | Cost | Effect |
|---|---|---|---|
| **1** | **ASSESS** | 0 Insight | Gain **2 Insight**. |
| **2** | **HARDEN** | 1 Insight | Cap one infrastructure cell and remove any attacker stone on it. From then on, the Attacker can't enter that cell, it isn't an exit, and it's no longer part of the hub. **+1 Score.** |
| **3** | **SEGMENT** | 1 Insight | Place up to **2 walls** on border edges. Walls can split an attacker group. |
| **4** | **RING-FENCE** | Insight equal to the app's size (3–5) | Put a ring on the app. Every border edge of the app now counts as walled, **except business flows**. **+2 Score.** |
| ★ | **DEPLOY** | 1 Insight | Place a Sensor or Decoy from your pool face-down on any empty cell that has no token. This is the SSP / IDS/IPS action. |

Additional Defender rules:

- **Tier-level fine-tuning (Stage 4c).** Inside a ring-fenced app, SEGMENT
  can also put walls on edges *between cells of that app*.
- **Leakage alerts.** Once every non-flow edge on the zone boundary is
  walled, the Defender scores **+2** for a sealed zone. From then on, each
  time an attacker stone crosses the zone boundary, the Defender gains **+1
  Insight**.

### 5.4 Attacker actions

| Action | Effect |
|---|---|
| **BREACH** | *Once per turn.* Place a stone on any empty cell in row 1 or in H*. |
| **SPREAD** | Place a stone on an empty cell that is adjacent, through an open edge, to one of your stones. This includes flows, and moves between unhardened infrastructure cells under the hub rule. |
| **RECON** | Secretly look at one face-down token on a cell adjacent, through an open edge, to one of your stones. |
| **EXFIL** | If one of your stones sits on a revealed Crown Jewel **and** is in the same group as a stone on an exit, take the Jewel. |

Stones never move. You may place a stone next to your group even when a wall
separates them. They just won't be connected.

### 5.5 Face-down tokens

When an attacker stone enters a cell that has a face-down token, flip the
token over:

- **Crown Jewel**: the stone stays. The Jewel can now be exfiltrated.
- **Sensor** (IDS/IPS): remove the stone and discard the Sensor. **The
  Attacker's turn ends immediately.**
- **Decoy**: discard the Decoy. The stone stays.

### 5.6 Quarantine (capture)

After every Defender action, check each attacker group. A group with **no
open edge to an empty cell** is quarantined: remove all its stones.
**+1 Score** for each group removed. The Internet doesn't count as an empty
cell. Cells that have tokens do count as empty.

### 5.7 Winning

- The **Attacker** wins as soon as they have exfiltrated **2 Crown Jewels**.
- The **Defender** wins at the end of any Defender turn with **Score ≥ 10**.
- If round 12 ends with no winner, the **Defender** wins: the attacker's
  campaign has been detected and evicted.

---

## 6. Worked example: the first five rounds

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
  (Harden, Ring-fence, sealing the zone) also blocks the Attacker. So
  "defend or score" is seldom a clean choice. The good question is which
  scoring move also defends against the current threat.
- **Go-style connectivity.** A stolen jewel has to be *connected* to an exit.
  Cutting points, alternative routes and paths the Defender can't cover in a
  single SEGMENT are the Attacker's main tools. In go, a group with two eyes
  lives. Here, each extra independent route to an exit costs the Defender
  another wall to cut.
- **Asymmetric information.** The Defender knows where the jewels are, and
  the Attacker has to guess. RECON costs an action, and a Sensor ends the
  whole turn, so every step into an unscouted token cell is a bet. DEPLOY
  lets the Defender mix Sensors with Decoys, which makes bluffing a real
  skill.
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
4. Put sensors where flows land. Flows are the paths you can never wall, and
   the J tier is where most of them meet.
5. Jewel placement is a bluff. Putting all three deep in K and L is
   predictable. A jewel in G, near the zone boundary, is riskier and harder
   to read.

**Attacker**

1. Go wide early, before the zone is sealed. Every foothold you establish
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
> - **Sealed the zone** → Stage 3: Environment segmentation with leakage alerts
> - **Ring-fenced apps** → Stage 4: Application microsegmentation
> - **Deployed sensors on allowed flows** → Distributed IDS/IPS, Malware Prevention, NDR on SSP
>
> *Now do it on your real network* → [CTA / QR code]

---

## 11. Balance and playtest plan

### Starting values and the levers to adjust

| Lever | v0.1 value | If the Attacker wins too often | If the Defender wins too often |
|---|---|---|---|
| Defender starting Insight | 3 | 4 | 2 |
| ASSESS yield | 2 | 3 on the first ASSESS each turn | 2, unchanged |
| Ring-fence cost | app size | size − 1 | size + 1 |
| Score target | 10 | 9 | 11–12 |
| BREACH per turn | 1 | 1, but not into H* after H is ring-fenced | 2 |
| Sensor on trigger | ends turn | also removes the adjacent stone | stone removed, turn continues |
| Round limit | 12 | 10 | 14 |
| Number of flows | 5 | 4, drop e6–e7 | 6 |

### Known risks to check first

1. **H-rush.** The storefront is internet-facing and touches L, J and LDAP.
   Check that an Attacker who opens by breaching H and heading for Payments
   can't win by force. If they can, move L so it no longer touches H.
2. **Defender turtling.** Check that a Defender who only runs Harden → seal
   zone → ring-fence K and L doesn't win automatically. The flows into J
   exist to prevent this.
3. **Slow turns.** Three actions with lookahead can make players think for a
   long time. If turns run over about 90 seconds, consider 2 actions per
   turn for the Attacker and for the Quick Match format.

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
