class BootScene extends Phaser.Scene {
  constructor() {
    super("BootScene");
  }

  preload() {
    // No external art assets are loaded — everything is generated at
    // runtime with Phaser.Graphics so the game has zero binary dependencies.
  }

  create() {
    this.buildPlayerTexture();
    this.buildBulletTexture();
    this.buildThreatTexture("threat-malware", 0xcc092f, "diamond");
    this.buildThreatTexture("threat-ransomware", 0xff3b3b, "spike");
    this.buildThreatTexture("threat-exfil", 0xff8a00, "triangle");
    this.buildBossTexture();
    this.buildPowerupTexture("powerup-boost", 0x0091da, "bolt");
    this.buildPowerupTexture("powerup-shield", 0x2ecc71, "hex");
    this.buildPowerupTexture("powerup-zerotrust", 0xffd700, "star");
    this.buildSparkTexture();
    this.buildEnemyBulletTexture();
    this.buildGridTexture();

    this.scene.start("MenuScene");
  }

  buildPlayerTexture() {
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    const w = 56;
    const h = 48;
    g.fillStyle(0x0091da, 1);
    g.fillTriangle(w / 2, 0, 0, h, w, h);
    g.fillStyle(0x0a0b0d, 1);
    g.fillTriangle(w / 2, 14, 14, h - 4, w - 14, h - 4);
    g.fillStyle(0x7fe3ff, 1);
    g.fillTriangle(w / 2, 20, w / 2 - 8, h - 10, w / 2 + 8, h - 10);
    g.lineStyle(2, 0xffffff, 0.6);
    g.strokeTriangle(w / 2, 0, 0, h, w, h);
    g.generateTexture("player-ship", w, h);
    g.destroy();
  }

  buildBulletTexture() {
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(0x7fffb0, 1);
    g.fillRoundedRect(0, 0, 8, 20, 3);
    g.fillStyle(0xffffff, 1);
    g.fillRoundedRect(2, 2, 4, 6, 2);
    g.generateTexture("player-bullet", 8, 20);
    g.destroy();
  }

  buildEnemyBulletTexture() {
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(0xff3b3b, 1);
    g.fillCircle(6, 6, 6);
    g.fillStyle(0xffffff, 0.7);
    g.fillCircle(6, 6, 2);
    g.generateTexture("enemy-bullet", 12, 12);
    g.destroy();
  }

  buildThreatTexture(key, color, shape) {
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    const size = 40;
    g.fillStyle(color, 1);
    g.lineStyle(2, 0xffffff, 0.5);

    if (shape === "diamond") {
      g.beginPath();
      g.moveTo(size / 2, 0);
      g.lineTo(size, size / 2);
      g.lineTo(size / 2, size);
      g.lineTo(0, size / 2);
      g.closePath();
      g.fillPath();
      g.strokePath();
    } else if (shape === "spike") {
      const points = [];
      const spikes = 8;
      for (let i = 0; i < spikes * 2; i++) {
        const r = i % 2 === 0 ? size / 2 : size / 4;
        const angle = (Math.PI / spikes) * i;
        points.push(new Phaser.Math.Vector2(
          size / 2 + r * Math.cos(angle),
          size / 2 + r * Math.sin(angle)
        ));
      }
      g.beginPath();
      g.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) g.lineTo(points[i].x, points[i].y);
      g.closePath();
      g.fillPath();
      g.strokePath();
    } else if (shape === "triangle") {
      g.fillTriangle(size / 2, 0, 0, size, size, size);
      g.strokeTriangle(size / 2, 0, 0, size, size, size);
    }

    g.fillStyle(0x000000, 0.55);
    g.fillCircle(size / 2, size / 2, size / 6);
    g.generateTexture(key, size, size);
    g.destroy();
  }

  buildBossTexture() {
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    const w = 120;
    const h = 90;
    g.fillStyle(0x4a0014, 1);
    g.fillRoundedRect(0, 0, w, h, 14);
    g.lineStyle(3, 0xff3b3b, 1);
    g.strokeRoundedRect(0, 0, w, h, 14);
    g.fillStyle(0xcc092f, 1);
    g.fillCircle(w / 2, h / 2, 26);
    g.fillStyle(0x000000, 0.8);
    g.fillCircle(w / 2, h / 2, 12);
    g.generateTexture("threat-boss", w, h);
    g.destroy();
  }

  buildPowerupTexture(key, color, shape) {
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    const size = 34;
    g.lineStyle(2, 0xffffff, 0.8);
    g.fillStyle(color, 1);
    g.fillCircle(size / 2, size / 2, size / 2 - 2);
    g.strokeCircle(size / 2, size / 2, size / 2 - 2);

    g.fillStyle(0xffffff, 1);
    if (shape === "bolt") {
      g.fillTriangle(size * 0.55, 4, size * 0.3, size * 0.55, size * 0.5, size * 0.55);
      g.fillTriangle(size * 0.45, size * 0.55, size * 0.7, size * 0.55, size * 0.4, size - 4);
    } else if (shape === "hex") {
      const cx = size / 2, cy = size / 2, r = size * 0.28;
      const pts = [];
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 2;
        pts.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
      }
      g.fillPoints(
        pts.reduce((arr, v, i, src) => {
          if (i % 2 === 0) arr.push(new Phaser.Math.Vector2(v, src[i + 1]));
          return arr;
        }, []),
        true
      );
    } else if (shape === "star") {
      const cx = size / 2, cy = size / 2;
      const points = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? size * 0.32 : size * 0.14;
        const a = (Math.PI / 5) * i - Math.PI / 2;
        points.push(new Phaser.Math.Vector2(cx + r * Math.cos(a), cy + r * Math.sin(a)));
      }
      g.fillPoints(points, true);
    }

    g.generateTexture(key, size, size);
    g.destroy();
  }

  buildSparkTexture() {
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(0xffffff, 1);
    g.fillCircle(4, 4, 4);
    g.generateTexture("spark", 8, 8);
    g.destroy();
  }

  buildGridTexture() {
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    const size = 40;
    g.lineStyle(1, 0x1c2733, 1);
    g.strokeRect(0, 0, size, size);
    g.generateTexture("grid-tile", size, size);
    g.destroy();
  }
}
