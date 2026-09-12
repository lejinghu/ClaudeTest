class GameOverScene extends Phaser.Scene {
  constructor() {
    super("GameOverScene");
  }

  init(data) {
    this.finalScore = data.score || 0;
    this.finalWave = data.wave || 1;
    this.victory = !!data.victory;
  }

  create() {
    const { width, height } = this.scale;

    this.add.tileSprite(0, 0, width, height, "grid-tile").setOrigin(0, 0).setAlpha(0.35);

    this.add.text(width / 2, 90, this.victory ? "DATA CENTER SECURED" : "BREACH DETECTED", {
      fontFamily: "Segoe UI, Arial",
      fontSize: "30px",
      color: this.victory ? "#2ecc71" : "#cc092f",
      fontStyle: "bold",
      align: "center",
    }).setOrigin(0.5);

    this.add.text(width / 2, 150, `Score: ${this.finalScore}   Wave: ${this.finalWave}`, {
      fontFamily: "Segoe UI, Arial",
      fontSize: "18px",
      color: "#ffffff",
    }).setOrigin(0.5);

    const reachedRule1234 = this.finalScore >= 1234;
    const statusLines = reachedRule1234
      ? ["Security Rule #1234 was activated —", "your segmentation held under fire."]
      : ["Reach a score of 1234 next run to", "unlock Security Rule #1234 overdrive."];

    this.add.text(width / 2, 200, statusLines.join("\n"), {
      fontFamily: "Segoe UI, Arial",
      fontSize: "13px",
      color: "#8fb6c9",
      align: "center",
      lineSpacing: 4,
    }).setOrigin(0.5);

    this.add.rectangle(width / 2, 320, width - 60, 150, 0x16181d, 0.9).setStrokeStyle(1, 0x2a2f38);
    this.add.text(width / 2, 320, [
      "Real threats move laterally in seconds.",
      "",
      "A modern distributed firewall with",
      "zero-trust micro-segmentation stops",
      "them before they ever reach a",
      "workload — no matter where it runs.",
    ].join("\n"), {
      fontFamily: "Segoe UI, Arial",
      fontSize: "12px",
      color: "#d7e4ea",
      align: "center",
      lineSpacing: 4,
    }).setOrigin(0.5);

    const btnY = 460;
    const btn = this.add.rectangle(width / 2, btnY, 220, 54, 0x0091da, 1)
      .setStrokeStyle(2, 0xffffff)
      .setInteractive({ useHandCursor: true });
    this.add.text(width / 2, btnY, "PLAY AGAIN", {
      fontFamily: "Segoe UI, Arial",
      fontSize: "18px",
      color: "#ffffff",
      fontStyle: "bold",
    }).setOrigin(0.5);

    btn.on("pointerover", () => btn.setFillStyle(0x2bb6ff));
    btn.on("pointerout", () => btn.setFillStyle(0x0091da));
    btn.on("pointerdown", () => this.scene.start("GameScene"));

    const menuBtn = this.add.text(width / 2, btnY + 46, "Back to Menu", {
      fontFamily: "Segoe UI, Arial",
      fontSize: "13px",
      color: "#6f8794",
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    menuBtn.on("pointerdown", () => this.scene.start("MenuScene"));

    this.input.keyboard.once("keydown-SPACE", () => this.scene.start("GameScene"));
  }
}
