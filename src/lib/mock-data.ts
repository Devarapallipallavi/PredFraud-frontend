export type Decision = "ALLOW" | "MFA" | "BLOCK" | "FREEZE" | "PENDING";
export type CaseStatus = "unassigned" | "open" | "in_review" | "pending" | "escalated" | "closed";
export type EventType = "login" | "transfer" | "card_payment" | "wire" | "device_link" | "password_reset";
export type EventStatus = "new" | "in_review" | "escalated" | "resolved" | "auto_closed";
export type RiskLevel = "low" | "medium" | "high" | "critical";

export function riskLevel(score: number): RiskLevel {
  if (score > 80) return "critical";
  if (score > 60) return "high";
  if (score > 30) return "medium";
  return "low";
}

export interface AnalystSubmission {
  decision: Exclude<Decision, "PENDING">;
  notes: string;
  fileName?: string;
  submittedAt: string;
  submittedByName: string;
}

export interface FraudCase {
  id: string;
  title: string;
  customer: string;
  customerId: string;
  amount: number;
  currency: string;
  riskScore: number;
  suggestion: Exclude<Decision, "PENDING">; // AI-suggested action
  status: CaseStatus;
  assignedTo: string | null;
  assignedToName: string | null;
  openedAt: string;
  lastUpdate: string;
  reasons: string[];
  country: string;
  channel: "mobile" | "web" | "branch" | "atm";
  analystSubmission: AnalystSubmission | null;
  adminDecision: Exclude<Decision, "PENDING"> | null;
  adminDecidedAt: string | null;
}

export interface LiveEvent {
  id: string;
  type: EventType;
  userId: string;
  userName: string;
  amount?: number;
  currency?: string;
  riskScore: number;
  status: EventStatus;
  ip: string;
  device: string;
  timestamp: string;
  caseId?: string;
  reasons: string[];
}

export interface GraphNode {
  id: string;
  label: string;
  type: "account" | "device" | "beneficiary" | "ip" | "merchant";
  risk: number;
  caseId?: string;
  cluster: string;
}
export interface GraphEdge { from: string; to: string; label: string; }

export interface FraudCluster {
  id: string;
  name: string;
  region: string;
  flagged: number;
}

export const ANALYST_ID = "u-analyst-204";

const teamMembers = [
  { id: "u-analyst-204", name: "Priya Raman" },
  { id: "u-analyst-211", name: "Marcus Lee" },
  { id: "u-analyst-219", name: "Sofia Alvarez" },
  { id: "u-analyst-227", name: "Ken Tanaka" },
];

const reasons = [
  "Device change",
  "Geo anomaly",
  "High-value transaction",
  "Beneficiary risk",
  "Velocity spike",
  "Known mule pattern",
  "Tor exit node",
  "First-time recipient",
  "Round-amount pattern",
];

function pick<T>(arr: T[], n = 1): T[] {
  const a = [...arr].sort(() => Math.random() - 0.5);
  return a.slice(0, n);
}

const customers = [
  ["Helena Vetter", "AC-44820"], ["Omar Haddad", "AC-72119"], ["Lin Wei", "AC-30584"],
  ["Daniela Costa", "AC-99041"], ["Frederik Holm", "AC-21765"], ["Aarav Patel", "AC-58332"],
  ["Yuki Sato", "AC-66109"], ["Noor Khan", "AC-47023"], ["Chloé Bernard", "AC-81277"],
  ["Tomás Ribeiro", "AC-13408"], ["Ines Marques", "AC-90553"], ["Jakub Nowak", "AC-35671"],
];

const countries = ["GB", "DE", "FR", "AE", "SG", "US", "BR", "JP", "ZA", "PL"];
const channels: FraudCase["channel"][] = ["mobile", "web", "branch", "atm"];
const statuses: CaseStatus[] = ["unassigned", "open", "in_review", "pending", "escalated", "closed"];

function isoMinusMinutes(min: number) {
  return new Date(Date.now() - min * 60_000).toISOString();
}

function suggestionFromRisk(risk: number): Exclude<Decision, "PENDING"> {
  if (risk > 85) return "FREEZE";
  if (risk > 70) return "BLOCK";
  if (risk > 50) return "MFA";
  return "ALLOW";
}

export const cases: FraudCase[] = Array.from({ length: 28 }).map((_, i) => {
  const [name, accId] = customers[i % customers.length];
  const status = statuses[i % statuses.length];
  // Unassigned cases have no analyst; ensure ANALYST_ID gets a few
  let assignee: { id: string; name: string } | null;
  if (status === "unassigned") {
    assignee = null;
  } else {
    assignee = teamMembers[i % teamMembers.length];
  }
  const risk = Math.floor(Math.random() * 100);
  const suggestion = suggestionFromRisk(risk);
  const hasAnalystSub = status === "pending" || status === "escalated" || status === "closed";
  const hasAdminDec = status === "closed";
  return {
    id: `CSE-${10250 + i}`,
    title: [
      "Suspicious wire to new beneficiary",
      "Multiple failed logins + transfer",
      "Device swap before payout",
      "Velocity anomaly on card",
      "ATM cash-out abroad",
      "Account takeover attempt",
      "SIM-swap indicator",
      "Mule account pattern",
    ][i % 8],
    customer: name,
    customerId: accId,
    amount: Math.round((Math.random() * 48000 + 500) * 100) / 100,
    currency: ["EUR", "GBP", "USD", "AED"][i % 4],
    riskScore: risk,
    suggestion,
    status,
    assignedTo: assignee?.id ?? null,
    assignedToName: assignee?.name ?? null,
    openedAt: isoMinusMinutes((i + 1) * 73),
    lastUpdate: isoMinusMinutes((i + 1) * 11),
    reasons: pick(reasons, 2 + (i % 3)),
    country: countries[i % countries.length],
    channel: channels[i % channels.length],
    analystSubmission: hasAnalystSub
      ? {
          decision: suggestion,
          notes:
            "Reviewed transaction history and device fingerprint. Customer was contacted and confirmed activity is suspicious. Recommending the suggested action based on velocity pattern and beneficiary risk score.",
          fileName: i % 2 === 0 ? "investigation-notes.pdf" : "transaction-log.csv",
          submittedAt: isoMinusMinutes((i + 1) * 9),
          submittedByName: assignee?.name ?? "Priya Raman",
        }
      : null,
    adminDecision: hasAdminDec ? suggestion : null,
    adminDecidedAt: hasAdminDec ? isoMinusMinutes((i + 1) * 4) : null,
  };
});

// Ensure analyst (Priya) has a few cases across different statuses
[1, 5, 9, 13, 17].forEach((idx) => {
  if (cases[idx]) {
    cases[idx].assignedTo = ANALYST_ID;
    cases[idx].assignedToName = "Priya Raman";
    if (cases[idx].status === "unassigned") cases[idx].status = "open";
  }
});

const eventTypes: EventType[] = ["login", "transfer", "card_payment", "wire", "device_link", "password_reset"];
const eventStatuses: EventStatus[] = ["new", "in_review", "escalated", "resolved", "auto_closed"];

export const liveEvents: LiveEvent[] = Array.from({ length: 60 }).map((_, i) => {
  const [name, accId] = customers[i % customers.length];
  const type = eventTypes[i % eventTypes.length];
  const risk = Math.floor(Math.random() * 100);
  const linkedCase = i % 4 === 0 ? cases[i % cases.length].id : undefined;
  const status: EventStatus =
    risk > 85 ? "escalated"
    : risk > 70 ? "in_review"
    : risk > 50 ? "new"
    : risk > 25 ? "resolved"
    : "auto_closed";
  return {
    id: `EVT-${500120 + i}`,
    type,
    userId: accId,
    userName: name,
    amount: type === "transfer" || type === "wire" || type === "card_payment"
      ? Math.round(Math.random() * 9800 + 50)
      : undefined,
    currency: "EUR",
    riskScore: risk,
    status: eventStatuses.includes(status) ? status : "new",
    ip: `${10 + (i % 240)}.${(i * 7) % 255}.${(i * 13) % 255}.${(i * 17) % 255}`,
    device: ["iPhone 15 · iOS 17", "Pixel 8 · Android 14", "MacBook · Safari", "Windows · Chrome", "ATM-Terminal"][i % 5],
    timestamp: isoMinusMinutes(i * 0.6 + 1),
    caseId: linkedCase,
    reasons: pick(reasons, 1 + (i % 3)),
  };
});

// Fraud network clusters and graph nodes
export const fraudClusters: FraudCluster[] = [
  { id: "cluster-all", name: "All entities", region: "Global", flagged: 42 },
  { id: "cluster-ring-karnataka", name: "Fraud Ring · Karnataka", region: "South Asia", flagged: 13 },
  { id: "cluster-mule-west", name: "Mule Network · West", region: "EMEA", flagged: 5 },
  { id: "cluster-alpha", name: "Cluster Alpha", region: "APAC", flagged: 3 },
  { id: "cluster-beta", name: "Cluster Beta", region: "LATAM", flagged: 1 },
];

const nodeTypes: GraphNode["type"][] = ["account", "device", "beneficiary", "ip", "merchant"];
function genCluster(prefix: string, count: number, clusterId: string, baseRisk: number): GraphNode[] {
  return Array.from({ length: count }).map((_, i) => ({
    id: `${prefix}-${i}`,
    label: `${prefix}-${i}`,
    type: nodeTypes[i % nodeTypes.length],
    risk: Math.min(100, Math.max(5, baseRisk + Math.floor(Math.random() * 30 - 15))),
    cluster: clusterId,
    caseId: i % 4 === 0 ? cases[i % cases.length].id : undefined,
  }));
}

export const graphNodes: GraphNode[] = [
  ...genCluster("KR", 14, "cluster-ring-karnataka", 82),
  ...genCluster("MW", 11, "cluster-mule-west", 65),
  ...genCluster("AL", 9, "cluster-alpha", 48),
  ...genCluster("BT", 8, "cluster-beta", 30),
];

function genEdges(): GraphEdge[] {
  const edges: GraphEdge[] = [];
  const byCluster: Record<string, GraphNode[]> = {};
  graphNodes.forEach((n) => {
    byCluster[n.cluster] = byCluster[n.cluster] || [];
    byCluster[n.cluster].push(n);
  });
  Object.values(byCluster).forEach((nodes) => {
    // Connect each node to ~2-3 others within cluster (force-directed friendly)
    nodes.forEach((a, i) => {
      const links = 2 + (i % 2);
      for (let k = 1; k <= links; k++) {
        const b = nodes[(i + k) % nodes.length];
        if (a.id !== b.id) edges.push({ from: a.id, to: b.id, label: "linked" });
      }
    });
  });
  // A few cross-cluster bridges
  edges.push({ from: "KR-0", to: "MW-2", label: "shared device" });
  edges.push({ from: "MW-3", to: "AL-1", label: "shared IP" });
  edges.push({ from: "AL-4", to: "BT-0", label: "shared beneficiary" });
  return edges;
}

export const graphEdges: GraphEdge[] = genEdges();

export const teamMembersList = teamMembers;
export const reasonCatalog = reasons;
