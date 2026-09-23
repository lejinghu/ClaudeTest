# ClaudeTest
Testing claude code

## Firewall Defender

A browser arcade game built with [Phaser 3](https://phaser.io/) about
network security. You pilot a distributed-firewall ship, shooting down
inbound threats (malware, ransomware, data-exfiltration) before they reach
the protected VM cluster at the bottom of the screen. Collect firewall
boosts, micro-segmentation shields, and Zero Trust pulses along the way.
Every third wave spawns an "APT actor" boss, and reaching a score of
**1234** unlocks a screen-clearing, temporary-invulnerability
**Security Rule #1234** overdrive.

This is a fan-made educational arcade game.

### Play it on GitHub Pages

This repo is set up to auto-deploy to GitHub Pages on every push via
`.github/workflows/deploy-pages.yml`. One-time setup (only needs doing
once per repo):

1. Go to the repo's **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Push to this branch (or merge it to the default branch) — the workflow
   builds and deploys automatically.
4. The **Actions** tab shows the run; once it finishes, the **Settings →
   Pages** page shows the live URL (looks like
   `https://<user>.github.io/<repo>/`). Open it in a browser to play.

Every subsequent push redeploys automatically — no build step, since the
game is plain static files.

### Play it locally

No build step or install required — it's plain HTML/CSS/JS with a vendored
copy of Phaser (arcade-physics build) in `js/vendor/`, so it runs fully
offline.

```bash
# from the repo root
python3 -m http.server 8080
# then open http://localhost:8080 in a browser
```

Or just open `index.html` directly in a browser.

**Controls:** Arrow keys / A-D to move, or click-and-drag / touch. Firing is
automatic. Space also starts/restarts the game.

### Structure

```
index.html                          Entry point
css/style.css                       Page chrome
js/main.js                          Phaser game config
js/vendor/                          Vendored Phaser build (arcade-physics)
js/scenes/BootScene.js              Generates all sprite textures at runtime (no image assets)
js/scenes/MenuScene.js              Title / instructions screen
js/scenes/GameScene.js              Core gameplay, waves, scoring, Security Rule #1234 event
js/scenes/GameOverScene.js          Win/lose screen
.github/workflows/deploy-pages.yml  Auto-deploy to GitHub Pages on push
```

## RINGFENCE (design)

A two-player asymmetric strategy game in the spirit of Netrunner, chess and
go. It promotes vDefend DFW 1-2-3-4 and SSP. The full rules, board, worked
example, promotional mapping and playtest plan are in
[`docs/RINGFENCE-GAME-DESIGN.md`](docs/RINGFENCE-GAME-DESIGN.md).
