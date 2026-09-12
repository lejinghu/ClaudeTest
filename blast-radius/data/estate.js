// Blast Radius — estate data.
//
// This file IS the game design (see spec Section 4). It exports two frozen
// arrays: WORKLOADS (24 nodes) and FLOWS (92 edges). No DOM, no game logic —
// just data, built once at module load.
//
// kind: "infra" | "app" | "mgmt"
// zone: "shared" | "prod" | "dev" | "mgmt"

export const WORKLOADS = [
  { id: "dns-01", name: "DNS Primary", kind: "infra", zone: "shared" },
  { id: "dns-02", name: "DNS Secondary", kind: "infra", zone: "shared" },
  { id: "ntp-01", name: "NTP Server", kind: "infra", zone: "shared" },
  { id: "ldap-01", name: "LDAP Directory", kind: "infra", zone: "shared" },
  { id: "log-01", name: "Syslog Collector", kind: "infra", zone: "shared" },

  { id: "web-01", name: "Storefront Web 1", kind: "app", zone: "prod", app: "storefront", tier: "web" },
  { id: "web-02", name: "Storefront Web 2", kind: "app", zone: "prod", app: "storefront", tier: "web" },
  { id: "app-01", name: "Storefront App 1", kind: "app", zone: "prod", app: "storefront", tier: "app" },
  { id: "app-02", name: "Storefront App 2", kind: "app", zone: "prod", app: "storefront", tier: "app" },
  { id: "cache-01", name: "Session Cache", kind: "app", zone: "prod", app: "storefront", tier: "app" },
  { id: "db-01", name: "Orders DB", kind: "app", zone: "prod", app: "storefront", tier: "db" },
  { id: "bill-web-01", name: "Billing Portal", kind: "app", zone: "prod", app: "billing", tier: "web" },
  { id: "bill-app-01", name: "Billing Engine", kind: "app", zone: "prod", app: "billing", tier: "app" },
  { id: "pay-gw-01", name: "Payment Gateway", kind: "app", zone: "prod", app: "billing", tier: "app" },
  { id: "bill-db-01", name: "Billing DB", kind: "app", zone: "prod", app: "billing", tier: "db" },

  { id: "dev-web-01", name: "Dev Web", kind: "app", zone: "dev", app: "storefront-dev", tier: "web" },
  { id: "dev-app-01", name: "Dev App", kind: "app", zone: "dev", app: "storefront-dev", tier: "app" },
  { id: "dev-db-01", name: "Dev DB", kind: "app", zone: "dev", app: "storefront-dev", tier: "db" },
  { id: "jenkins-01", name: "Build Server", kind: "app", zone: "dev" },
  { id: "dev-vm-04", name: "Developer Sandbox", kind: "app", zone: "dev" },

  { id: "bkp-01", name: "Backup Server", kind: "mgmt", zone: "mgmt" },
  { id: "mon-01", name: "Monitoring", kind: "mgmt", zone: "mgmt" },
  { id: "jump-01", name: "Jump Host", kind: "mgmt", zone: "mgmt" },
  { id: "vc-01", name: "vCenter", kind: "mgmt", zone: "mgmt" },
];

const WORKLOAD_IDS = WORKLOADS.map((w) => w.id);

function assertKnown(id) {
  if (!WORKLOAD_IDS.includes(id)) {
    throw new Error(`estate.js: unknown workload id "${id}" referenced by a flow`);
  }
  return id;
}

function mkFlow(from, to, port, frequency, essential) {
  assertKnown(from);
  assertKnown(to);
  return {
    id: `${from}->${to}:${port}`,
    from,
    to,
    port,
    frequency,
    essential,
  };
}

const FLOWS = [];

// --- Infrastructure flows — the noise floor (45 flows) -------------------

// First 10 non-infra workloads -> dns-01, port 53, constant, essential.
// Remaining 9 non-infra workloads -> dns-02, port 53, constant, essential.
const NON_INFRA_ORDER = WORKLOADS.filter((w) => w.kind !== "infra").map((w) => w.id);
if (NON_INFRA_ORDER.length !== 19) {
  throw new Error(`estate.js: expected 19 non-infra workloads, found ${NON_INFRA_ORDER.length}`);
}
NON_INFRA_ORDER.slice(0, 10).forEach((id) => FLOWS.push(mkFlow(id, "dns-01", 53, "constant", true)));
NON_INFRA_ORDER.slice(10, 19).forEach((id) => FLOWS.push(mkFlow(id, "dns-02", 53, "constant", true)));

// -> ntp-01, port 123, periodic, essential.
["web-01", "app-01", "db-01", "bill-app-01", "bill-db-01", "vc-01"].forEach((id) =>
  FLOWS.push(mkFlow(id, "ntp-01", 123, "periodic", true))
);

// -> ldap-01, port 389, constant, essential.
["web-01", "web-02", "app-01", "app-02", "bill-web-01", "bill-app-01", "jump-01", "vc-01"].forEach((id) =>
  FLOWS.push(mkFlow(id, "ldap-01", 389, "constant", true))
);

// All 10 prod + jenkins-01 + vc-01 -> log-01, port 514, constant, not essential.
const PROD_IDS = WORKLOADS.filter((w) => w.zone === "prod").map((w) => w.id);
if (PROD_IDS.length !== 10) {
  throw new Error(`estate.js: expected 10 prod workloads, found ${PROD_IDS.length}`);
}
[...PROD_IDS, "jenkins-01", "vc-01"].forEach((id) => FLOWS.push(mkFlow(id, "log-01", 514, "constant", false)));

// --- Application flows — the structure to be discovered (14 flows) -------

[
  ["web-01", "app-01", 8080, "constant", true],
  ["web-02", "app-02", 8080, "constant", true],
  ["app-01", "db-01", 3306, "constant", true],
  ["app-02", "db-01", 3306, "constant", true],
  ["app-01", "cache-01", 6379, "constant", true],
  ["app-02", "cache-01", 6379, "constant", true],
  ["bill-web-01", "bill-app-01", 8443, "constant", true],
  ["bill-app-01", "bill-db-01", 5432, "constant", true],
  ["bill-app-01", "pay-gw-01", 443, "periodic", true],
  ["app-01", "bill-app-01", 8443, "periodic", true],
  ["dev-web-01", "dev-app-01", 8080, "constant", true],
  ["dev-app-01", "dev-db-01", 3306, "constant", true],
  ["dev-vm-04", "dev-db-01", 3306, "constant", false],
  ["dev-vm-04", "jenkins-01", 22, "constant", false],
].forEach(([from, to, port, frequency, essential]) => FLOWS.push(mkFlow(from, to, port, frequency, essential)));

// --- Monitoring — heavy noise from one hub (23 flows) ---------------------

WORKLOAD_IDS.filter((id) => id !== "mon-01").forEach((id) =>
  FLOWS.push(mkFlow("mon-01", id, 161, "constant", false))
);

// --- The traps (10 flows) --------------------------------------------------

[
  ["bkp-01", "db-01", 2049, "nightly", true],
  ["bkp-01", "bill-db-01", 2049, "nightly", true],
  ["bkp-01", "dev-db-01", 2049, "nightly", false],
  ["bkp-01", "vc-01", 2049, "nightly", true],
  ["jump-01", "web-01", 22, "weekly", true],
  ["jump-01", "app-01", 22, "weekly", true],
  ["jump-01", "db-01", 22, "weekly", true],
  ["jump-01", "bill-app-01", 22, "weekly", true],
  ["jenkins-01", "app-01", 8080, "weekly", true],
  ["jenkins-01", "bill-app-01", 8080, "weekly", true],
].forEach(([from, to, port, frequency, essential]) => FLOWS.push(mkFlow(from, to, port, frequency, essential)));

if (FLOWS.length !== 92) {
  throw new Error(`estate.js: expected 92 flows, built ${FLOWS.length}`);
}

export { FLOWS };

// --- Fencing groups (spec 3.5) ---------------------------------------------

export const FENCE_GROUPS = {
  "infra-dns": { label: "infra-dns", members: ["dns-01", "dns-02"], category: "infra" },
  "infra-core": { label: "infra-core", members: ["ntp-01", "ldap-01", "log-01"], category: "infra" },
  "zone-prod": {
    label: "zone-prod",
    members: WORKLOADS.filter((w) => w.zone === "prod").map((w) => w.id),
    category: "zone",
  },
  "zone-dev": {
    label: "zone-dev",
    members: WORKLOADS.filter((w) => w.zone === "dev").map((w) => w.id),
    category: "zone",
  },
  "zone-mgmt": {
    label: "zone-mgmt",
    members: WORKLOADS.filter((w) => w.zone === "mgmt").map((w) => w.id),
    category: "zone",
  },
};

// Turn schedule for the "trap" frequencies (spec 3.2).
export const FREQUENCY_TURNS = {
  constant: null, // every turn
  periodic: [3, 6, 9, 12, 15],
  nightly: [7, 14],
  weekly: [12],
};

export function isFlowActiveOnTurn(flow, turn) {
  const schedule = FREQUENCY_TURNS[flow.frequency];
  if (schedule === null) return true;
  return schedule.includes(turn);
}

// Degree (flow count) per workload id — used for attacker target weighting.
export function computeDegrees() {
  const degrees = Object.fromEntries(WORKLOAD_IDS.map((id) => [id, 0]));
  for (const flow of FLOWS) {
    degrees[flow.from] += 1;
    degrees[flow.to] += 1;
  }
  return degrees;
}
