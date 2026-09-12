class MenuScene extends Phaser.Scene {
  constructor() {
    super("MenuScene");
  }

  create() {
    const { width, height } = this.scale;

    this.add.tileSprite(0, 0, width, height, "grid-tile").setOrigin(0, 0).setAlpha(0.5);

    this.add.rectangle(width / 2, 90, width - 40, 130, 0x0a0b0d, 0.0);

    this.add.text(width / 2, 60, "BROADCOM", {
      fontFamily: "Segoe UI, Arial",
      fontSize: "22px",
      color: "#cc092f",
      fontStyle: "bold",
    }).setOrigin(0.5);

    this.add.text(width / 2, 88, "VMware vDefend", {
      fontFamily: "Segoe UI, Arial",
      fontSize: "26px",
      color: "#0091da",
      fontStyle: "bold",
    }).setOrigin(0.5);

    this.add.text(width / 2, 150, "DFW DEFENDER", {
      fontFamily: "Segoe UI, Arial",
      fontSize: "40px",
      color: "#ffffff",
      fontStyle: "bold",
    }).setOrigin(0.5);

    this.add.text(width / 2, 190, "Distributed Firewall · Service-defined Security Platform 5.2", {
      fontFamily: "Segoe UI, Arial",
      fontSize: "13px",
      color: "#8fb6c9",
      align: "center",
    }).setOrigin(0.5);

    const panelY = 280;
    this.add.rectangle(width / 2, panelY + 70, width - 60, 190, 0x16181d, 0.9)
      .setStrokeStyle(1, 0x2a2f38);

    const lines = [
      "Micro-segment the data center.",
      "Deploy DFW rules to neutralize inbound",
      "threats before they reach your VMs.",
      "",
      "Collect SSP 5.2 boosts, Zero-Trust",
      "pulses, and Micro-seg shields.",
      "",
      "Hit score 1234 to trigger the",
      "legendary DFW RULE #1234 overdrive!",
    ];

    this.add.text(width / 2, panelY, lines.join("\n"), {
      fontFamily: "Segoe UI, Arial",
      fontSize: "13px",
      color: "#d7e4ea",
      align: "center",
      lineSpacing: 6,
    }).setOrigin(0.5, 0);

    const btnY = 500;
    const btn = this.add.rectangle(width / 2, btnY, 220, 54, 0xcc092f, 1)
      .setStrokeStyle(2, 0xffffff)
      .setInteractive({ useHandCursor: true });

    const btnText = this.add.text(width / 2, btnY, "START DEFENSE", {
      fontFamily: "Segoe UI, Arial",
      fontSize: "18px",
      color: "#ffffff",
      fontStyle: "bold",
    }).setOrigin(0.5);

    btn.on("pointerover", () => btn.setFillStyle(0xff3b3b));
    btn.on("pointerout", () => btn.setFillStyle(0xcc092f));
    btn.on("pointerdown", () => this.scene.start("GameScene"));

    this.add.text(width / 2, btnY + 50, "Arrow keys / drag to move — SPACE or tap to fire", {
      fontFamily: "Segoe UI, Arial",
      fontSize: "12px",
      color: "#6f8794",
    }).setOrigin(0.5);

    this.add.text(width / 2, height - 24, "Not an official Broadcom or VMware product — fan-made promo game.", {
      fontFamily: "Segoe UI, Arial",
      fontSize: "10px",
      color: "#4a5761",
    }).setOrigin(0.5);

    this.input.keyboard.once("keydown-SPACE", () => this.scene.start("GameScene"));
  }
}
