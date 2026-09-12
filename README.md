# ClaudeTest
Testing claude code

## DFW Defender

A browser arcade game built with [Phaser 3](https://phaser.io/) that promotes
Broadcom VMware vDefend — the Distributed Firewall (DFW) and Service-defined
Security Platform (SSP) 5.2.

You pilot a DFW micro-segmentation ship, shooting down inbound threats
(malware, ransomware, data-exfiltration) before they reach the protected VM
cluster at the bottom of the screen. Collect SSP 5.2 boosts, micro-segmentation
shields, and Zero Trust pulses along the way. Every third wave spawns an
"APT actor" boss, and reaching a score of **1234** unlocks the legendary
**DFW Rule #1234** overdrive — a screen-clearing, temporary-invulnerability
event that is the whole point of the game's name.

This is a fan-made promotional game, not an official Broadcom or VMware
product.

### Play it

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
index.html              Entry point
css/style.css           Page chrome
js/main.js              Phaser game config
js/vendor/               Vendored Phaser build (arcade-physics)
js/scenes/BootScene.js   Generates all sprite textures at runtime (no image assets)
js/scenes/MenuScene.js   Title / instructions screen
js/scenes/GameScene.js   Core gameplay, waves, scoring, DFW Rule #1234 event
js/scenes/GameOverScene.js  Win/lose screen with promo copy
```
