class GameScene extends Phaser.Scene {
  constructor() {
    super("GameScene");
  }

  init() {
    this.score = 0;
    this.integrity = 100;
    this.wave = 1;
    this.waveTimeMs = 18000;
    this.spawnDelay = 900;
    this.fireDelay = 260;
    this.baseFireDelay = 260;
    this.dfw1234Triggered = false;
    this.invulnerableUntil = 0;
    this.shieldActive = false;
    this.gameOver = false;
    this.bossActive = false;
  }

  create() {
    const { width, height } = this.scale;

    this.bg = this.add.tileSprite(0, 0, width, height, "grid-tile").setOrigin(0, 0).setAlpha(0.45);

    // Data-center line the player defends
    this.add.line(0, 0, 0, height - 30, width, height - 30, 0x1c2733, 1).setOrigin(0, 0).setLineWidth(2);
    this.add.text(width / 2, height - 20, "PROTECTED VM CLUSTER", {
      fontFamily: "Segoe UI, Arial",
      fontSize: "11px",
      color: "#4a5761",
    }).setOrigin(0.5);

    this.player = this.physics.add.sprite(width / 2, height - 70, "player-ship");
    this.player.setCollideWorldBounds(true);
    this.player.body.setSize(40, 40);

    this.shieldRing = this.add.circle(this.player.x, this.player.y, 34, 0x2ecc71, 0).setStrokeStyle(3, 0x2ecc71, 0.9);
    this.shieldRing.setVisible(false);

    this.bullets = this.physics.add.group();
    this.enemyBullets = this.physics.add.group();
    this.threats = this.physics.add.group();
    this.powerups = this.physics.add.group();
    this.boss = null;

    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = this.input.keyboard.addKeys("A,D,SPACE");

    this.pointerDown = false;
    this.pointerTargetX = this.player.x;
    this.input.on("pointerdown", (p) => {
      this.pointerDown = true;
      this.pointerTargetX = p.x;
    });
    this.input.on("pointermove", (p) => {
      if (this.pointerDown) this.pointerTargetX = p.x;
    });
    this.input.on("pointerup", () => (this.pointerDown = false));

    this.buildHud();

    this.fireEvent = this.time.addEvent({
      delay: this.fireDelay,
      loop: true,
      callback: () => this.fireBullet(),
    });

    this.spawnEvent = this.time.addEvent({
      delay: this.spawnDelay,
      loop: true,
      callback: () => this.spawnWave(),
    });

    this.waveEvent = this.time.addEvent({
      delay: this.waveTimeMs,
      loop: true,
      callback: () => this.advanceWave(),
    });

    this.physics.add.overlap(this.bullets, this.threats, this.onBulletHitThreat, null, this);
    this.physics.add.overlap(this.player, this.threats, this.onPlayerHitThreat, null, this);
    this.physics.add.overlap(this.player, this.enemyBullets, this.onPlayerHitBullet, null, this);
    this.physics.add.overlap(this.player, this.powerups, this.onCollectPowerup, null, this);

    this.bannerText = this.add.text(width / 2, height / 2 - 60, "", {
      fontFamily: "Segoe UI, Arial",
      fontSize: "22px",
      color: "#ffffff",
      fontStyle: "bold",
      align: "center",
      backgroundColor: "#000000aa",
      padding: { x: 12, y: 8 },
    }).setOrigin(0.5).setDepth(50).setAlpha(0);

    this.showBanner(`WAVE ${this.wave}`, 0xffffff, 1400);
  }

  buildHud() {
    const { width } = this.scale;
    this.hudPanel = this.add.rectangle(width / 2, 20, width, 40, 0x0a0b0d, 0.6).setDepth(20);

    this.scoreText = this.add.text(12, 10, "SCORE 0", {
      fontFamily: "Segoe UI, Arial",
      fontSize: "16px",
      color: "#ffffff",
      fontStyle: "bold",
    }).setDepth(21);

    this.waveText = this.add.text(width - 12, 10, "WAVE 1", {
      fontFamily: "Segoe UI, Arial",
      fontSize: "16px",
      color: "#0091da",
      fontStyle: "bold",
    }).setOrigin(1, 0).setDepth(21);

    this.integrityLabel = this.add.text(width / 2, 4, "DATA CENTER INTEGRITY", {
      fontFamily: "Segoe UI, Arial",
      fontSize: "9px",
      color: "#8fb6c9",
    }).setOrigin(0.5, 0).setDepth(21);

    this.barBg = this.add.rectangle(width / 2, 24, 180, 8, 0x2a2f38).setDepth(21);
    this.barFg = this.add.rectangle(width / 2 - 90, 24, 180, 8, 0x2ecc71).setOrigin(0, 0.5).setDepth(22);
  }

  updateHud() {
    this.scoreText.setText(`SCORE ${this.score}`);
    this.waveText.setText(`WAVE ${this.wave}`);
    const pct = Phaser.Math.Clamp(this.integrity, 0, 100) / 100;
    this.barFg.width = 180 * pct;
    this.barFg.setFillStyle(pct > 0.5 ? 0x2ecc71 : pct > 0.25 ? 0xff8a00 : 0xcc092f);
  }

  showBanner(msg, color, duration) {
    this.bannerText.setText(msg);
    this.bannerText.setColor(Phaser.Display.Color.RGBToString(
      (color >> 16) & 255, (color >> 8) & 255, color & 255
    ));
    this.tweens.add({
      targets: this.bannerText,
      alpha: { from: 0, to: 1 },
      duration: 200,
      yoyo: true,
      hold: duration,
    });
  }

  fireBullet() {
    if (this.gameOver) return;
    const b = this.bullets.create(this.player.x, this.player.y - 30, "dfw-bullet");
    b.setVelocityY(-420);
  }

  spawnWave() {
    if (this.gameOver) return;
    const { width } = this.scale;
    const x = Phaser.Math.Between(30, width - 30);

    const roll = Math.random();
    let key = "threat-malware";
    let hp = 1;
    if (roll > 0.85) key = "threat-exfil";
    else if (roll > 0.6) key = "threat-ransomware";

    const t = this.threats.create(x, -30, key);
    t.threatType = key;
    t.hp = hp;
    const speed = 60 + this.wave * 8 + Math.random() * 40;
    t.setVelocityY(speed);
    t.driftPhase = Math.random() * Math.PI * 2;
    t.setData("baseX", x);

    if (Math.random() < 0.14) this.spawnPowerup();
  }

  spawnPowerup() {
    const { width } = this.scale;
    const x = Phaser.Math.Between(30, width - 30);
    const roll = Math.random();
    let key = "powerup-ssp";
    if (roll > 0.8) key = "powerup-zerotrust";
    else if (roll > 0.5) key = "powerup-shield";

    const p = this.powerups.create(x, -20, key);
    p.powerupType = key;
    p.setVelocityY(90);
  }

  spawnBoss() {
    if (this.bossActive) return;
    this.bossActive = true;
    const { width } = this.scale;
    const boss = this.physics.add.sprite(width / 2, 90, "threat-boss");
    boss.hp = 5 + Math.floor(this.wave / 3);
    boss.body.setSize(90, 70);
    boss.dir = 1;
    this.boss = boss;

    this.physics.add.overlap(this.bullets, boss, (bullet, bossSprite) => this.onBulletHitBoss(bullet, bossSprite));

    this.bossFireEvent = this.time.addEvent({
      delay: 900,
      loop: true,
      callback: () => {
        if (!this.boss || this.gameOver) return;
        const eb = this.enemyBullets.create(this.boss.x, this.boss.y + 40, "enemy-bullet");
        eb.setVelocityY(220);
      },
    });

    this.showBanner("APT ACTOR DETECTED", 0xff3b3b, 1600);
  }

  advanceWave() {
    if (this.gameOver) return;
    this.wave += 1;
    this.spawnDelay = Math.max(260, 900 - this.wave * 55);
    this.spawnEvent.delay = this.spawnDelay;
    this.spawnEvent.reset({ delay: this.spawnDelay, loop: true, callback: () => this.spawnWave() });

    this.showBanner(`WAVE ${this.wave}`, 0xffffff, 1400);

    if (this.wave % 3 === 0 && !this.bossActive) {
      this.spawnBoss();
    }

    if (this.wave >= 10) {
      this.winGame();
    }
  }

  onBulletHitThreat(bullet, threat) {
    bullet.destroy();
    this.spawnSparks(threat.x, threat.y);
    threat.destroy();
    const rewards = { "threat-malware": 15, "threat-ransomware": 20, "threat-exfil": 25 };
    this.score += rewards[threat.threatType] || 10;
    this.checkDfw1234();
    this.updateHud();
  }

  onBulletHitBoss(bullet, boss) {
    if (!boss.active) return;
    bullet.destroy();
    boss.hp -= 1;
    boss.setTintFill(0xffffff);
    this.time.delayedCall(80, () => boss.active && boss.clearTint());
    this.score += 50;
    this.updateHud();
    this.checkDfw1234();

    if (boss.hp <= 0) {
      this.spawnSparks(boss.x, boss.y, 24);
      this.score += 300;
      this.updateHud();
      this.showBanner("APT ACTOR NEUTRALIZED", 0x2ecc71, 1400);
      if (this.bossFireEvent) this.bossFireEvent.remove();
      boss.destroy();
      this.boss = null;
      this.bossActive = false;
      for (let i = 0; i < 3; i++) this.spawnPowerup();
    }
  }

  onPlayerHitThreat(player, threat) {
    threat.destroy();
    this.damagePlayer(this.shieldActive ? 0 : 15);
  }

  onPlayerHitBullet(player, bullet) {
    bullet.destroy();
    this.damagePlayer(this.shieldActive ? 0 : 10);
  }

  onCollectPowerup(player, powerup) {
    const type = powerup.powerupType;
    powerup.destroy();

    if (type === "powerup-ssp") {
      this.applyRapidFire();
      this.showBanner("SSP 5.2 BOOST ONLINE", 0x0091da, 1000);
    } else if (type === "powerup-shield") {
      this.activateShield();
      this.showBanner("MICRO-SEGMENTATION SHIELD", 0x2ecc71, 1000);
    } else if (type === "powerup-zerotrust") {
      this.zeroTrustPulse();
      this.showBanner("ZERO TRUST PULSE", 0xffd700, 1200);
    }
    this.score += 5;
    this.updateHud();
  }

  applyRapidFire() {
    this.fireEvent.delay = this.baseFireDelay * 0.45;
    this.fireEvent.reset({ delay: this.baseFireDelay * 0.45, loop: true, callback: () => this.fireBullet() });
    if (this.rapidFireTimer) this.rapidFireTimer.remove();
    this.rapidFireTimer = this.time.delayedCall(6000, () => {
      this.fireEvent.reset({ delay: this.baseFireDelay, loop: true, callback: () => this.fireBullet() });
    });
  }

  activateShield() {
    this.shieldActive = true;
    this.shieldRing.setVisible(true);
  }

  consumeShield() {
    this.shieldActive = false;
    this.shieldRing.setVisible(false);
  }

  zeroTrustPulse() {
    this.threats.getChildren().slice().forEach((t) => {
      this.spawnSparks(t.x, t.y);
      t.destroy();
      this.score += 10;
    });
    if (this.boss) this.onBulletHitBoss({ destroy: () => {} }, this.boss);
    this.cameras.main.flash(300, 255, 215, 0);
  }

  damagePlayer(amount) {
    if (amount === 0) {
      this.consumeShield();
      this.spawnSparks(this.player.x, this.player.y, 10);
      return;
    }
    if (this.time.now < this.invulnerableUntil) return;
    this.integrity -= amount;
    this.cameras.main.shake(150, 0.006);
    this.spawnSparks(this.player.x, this.player.y, 10);
    this.updateHud();
    if (this.integrity <= 0) this.loseGame();
  }

  checkDfw1234() {
    if (!this.dfw1234Triggered && this.score >= 1234) {
      this.dfw1234Triggered = true;
      this.triggerDfwRule1234();
    }
  }

  triggerDfwRule1234() {
    this.cameras.main.flash(500, 0, 145, 218);
    this.showBanner("DFW RULE #1234 ACTIVATED\nALL THREATS BLOCKED", 0x0091da, 2200);

    this.threats.getChildren().slice().forEach((t) => {
      this.spawnSparks(t.x, t.y);
      t.destroy();
    });
    this.enemyBullets.clear(true, true);

    this.invulnerableUntil = this.time.now + 4000;
    this.shieldRing.setVisible(true);
    this.shieldRing.setStrokeStyle(3, 0x0091da, 1);
    this.time.delayedCall(4000, () => {
      if (!this.shieldActive) this.shieldRing.setVisible(false);
      this.shieldRing.setStrokeStyle(3, 0x2ecc71, 0.9);
    });
  }

  spawnSparks(x, y, count = 10) {
    for (let i = 0; i < count; i++) {
      const s = this.add.image(x, y, "spark");
      const angle = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * 120;
      this.tweens.add({
        targets: s,
        x: x + Math.cos(angle) * speed,
        y: y + Math.sin(angle) * speed,
        alpha: 0,
        duration: 350 + Math.random() * 200,
        onComplete: () => s.destroy(),
      });
    }
  }

  winGame() {
    this.gameOver = true;
    this.finishUp();
    this.scene.start("GameOverScene", { score: this.score, wave: this.wave, victory: true });
  }

  loseGame() {
    this.gameOver = true;
    this.finishUp();
    this.scene.start("GameOverScene", { score: this.score, wave: this.wave, victory: false });
  }

  finishUp() {
    [this.fireEvent, this.spawnEvent, this.waveEvent, this.bossFireEvent, this.rapidFireTimer].forEach((e) => {
      if (e) e.remove();
    });
  }

  update(time, delta) {
    if (this.gameOver) return;

    this.bg.tilePositionY -= 0.5;

    const speed = 320;
    if (this.pointerDown) {
      const dx = this.pointerTargetX - this.player.x;
      this.player.setVelocityX(Phaser.Math.Clamp(dx * 8, -speed, speed));
    } else if (this.cursors.left.isDown || this.keys.A.isDown) {
      this.player.setVelocityX(-speed);
    } else if (this.cursors.right.isDown || this.keys.D.isDown) {
      this.player.setVelocityX(speed);
    } else {
      this.player.setVelocityX(0);
    }

    this.shieldRing.setPosition(this.player.x, this.player.y);

    this.threats.getChildren().forEach((t) => {
      if (t.threatType === "threat-ransomware") {
        t.driftPhase += delta * 0.004;
        t.x = Phaser.Math.Clamp(t.getData("baseX") + Math.sin(t.driftPhase) * 60, 20, this.scale.width - 20);
      } else if (t.threatType === "threat-exfil") {
        const dx = this.player.x - t.x;
        t.setVelocityX(Phaser.Math.Clamp(dx * 0.6, -80, 80));
      }
      if (t.y > this.scale.height - 20) {
        const dmg = { "threat-malware": 8, "threat-ransomware": 12, "threat-exfil": 15 }[t.threatType] || 8;
        t.destroy();
        this.damagePlayer(this.shieldActive ? 0 : dmg);
      }
    });

    this.bullets.getChildren().forEach((b) => {
      if (b.y < -20) b.destroy();
    });
    this.enemyBullets.getChildren().forEach((b) => {
      if (b.y > this.scale.height + 20) b.destroy();
    });
    this.powerups.getChildren().forEach((p) => {
      if (p.y > this.scale.height + 20) p.destroy();
    });

    if (this.boss) {
      this.boss.x += this.boss.dir * 1.6;
      if (this.boss.x < 70 || this.boss.x > this.scale.width - 70) this.boss.dir *= -1;
    }
  }
}
