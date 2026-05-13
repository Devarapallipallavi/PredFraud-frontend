import { createFileRoute, Link } from "@tanstack/react-router";
import { ProtectedRoute } from "@/components/protected-route";
import { useAuth } from "@/lib/auth";
import { cases, liveEvents, ANALYST_ID } from "@/lib/mock-data";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip,
  PieChart, Pie, Cell, CartesianGrid,
} from "recharts";
import {
  ArrowUpRight, FolderOpen, UserMinus, Clock, CheckCircle2,
  Activity, Users, Mail, Phone, Award, TrendingUp, BadgeCheck,
  ShieldAlert, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { DataSourcesPanel } from "@/components/data-sources-panel";

const API_BASE = "https://predfraud-webapp-bxh8b2eudjgwevbb.eastus-01.azurewebsites.net";

// ── API types ─────────────────────────────────────────────────────────────────

type DashboardAPIResponse = {
  role: string;
  summary: {
    total_cases: number;
    open_cases: number;
    closed_cases: number;
    pending_cases: number;
    in_review_cases: number;
    unassigned_cases?: number;
  };
  risk_distribution: {
    ALLOW: number;
    MONITOR: number;
    CRITICAL: number;
    REVIEW: number;
    [key: string]: number;
  };
};

type APIRecentDecision = {
  case_id: string;
  decision: string;
  timestamp: string;
};

type APIMember = {
  emp_ID: string;
  full_name: string;
  email: string;
  phone_no: string;
  specialization: string;
  level: string;
  experience: string;
  metrics: {
    active: number;
    closed: number;
    level: string;
    decision_accuracy: number;
    recent_decisions: APIRecentDecision[];
  };
};

type TeamAPIResponse = {
  success: boolean;
  data: {
    team_id: string;
    team_name: string;
    admin_id: string;
    total_members: number;
    members: APIMember[];
  };
};

// ── Live events API type ──────────────────────────────────────────────────────

interface LiveAPIEvent {
  id: string;
  event_id: string;
  customer_id: string;
  amount: number;
  channel: string;
  device_id: string;
  ip_address: string;
  risk_score: number;
  risk_level: string;
  decision: string;
  action: string;
  case_id: string | null;
  case_status: string;
  timestamp: string;
  source: string;
}

// ── Chart data type ───────────────────────────────────────────────────────────

type ChartBucket = {
  hour: string;
  low: number;
  critical: number;
};

// ── Internal shapes ───────────────────────────────────────────────────────────

type RecentDecision = {
  caseId: string;
  decision: string;
  raw: string;
};

type AnalystDetail = {
  name: string;
  empId: string;
  cases: number;
  email: string;
  phone: string;
  team: string;
  level: string;
  experience: string;
  specialization: string;
  closedThisWeek: number;
  accuracy: string;
  recentDecisions: RecentDecision[];
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function normaliseDecision(raw: string): string {
  const upper = (raw ?? "").trim().toUpperCase();
  if (upper.startsWith("ALLOW") || upper === "APPROVE") return "ALLOW";
  if (upper.startsWith("MFA"))     return "MFA";
  if (upper.startsWith("FREEZE"))  return "FREEZE";
  if (upper.startsWith("BLOCK"))   return "BLOCK";
  if (upper.startsWith("MONITOR")) return "MONITOR";
  if (upper.startsWith("CRITICAL")) return "CRITICAL";
  if (upper.startsWith("REVIEW"))  return "REVIEW";
  return upper || raw;
}

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60)   return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

/** Only REVIEW and CRITICAL risk_level events qualify as high/critical */
function isHighOrCritical(e: LiveAPIEvent): boolean {
  const lvl = (e.risk_level ?? "").toUpperCase();
  return lvl === "REVIEW" || lvl === "CRITICAL";
}

// ── Hook: live critical stream ────────────────────────────────────────────────

const CRITICAL_POLL_MS  = 3000;
const CRITICAL_PAGE     = 50;
const CRITICAL_MAX_KEEP = 30;

function useCriticalStream() {
  const [events, setEvents]     = useState<LiveAPIEvent[]>([]);
  const [loading, setLoading]   = useState<boolean>(true);
  const cursorRef               = useRef<string | null>(null);
  const flashRef                = useRef<Set<string>>(new Set());
  const timerRef                = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const fetchCritical = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: String(CRITICAL_PAGE) });
      if (cursorRef.current) params.set("after", cursorRef.current);

      const res = await fetch(`${API_BASE}/events/live?${params.toString()}`, {
        headers: { accept: "application/json" },
      });
      if (!res.ok) return;

      const data = await res.json() as { count: number; events: LiveAPIEvent[] };
      const incoming: LiveAPIEvent[] = (data.events ?? []).filter(isHighOrCritical);
      if (!incoming.length) return;

      cursorRef.current = data.events[0].timestamp;

      setEvents((prev: LiveAPIEvent[]) => {
        const existingIds = new Set(prev.map((e) => e.id));
        const newEvts = incoming.filter((e) => !existingIds.has(e.id));
        newEvts.forEach((e) => flashRef.current.add(e.id));
        return [...newEvts, ...prev].slice(0, CRITICAL_MAX_KEEP);
      });

      setLoading(false);
    } catch {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCritical();
    timerRef.current = setInterval(fetchCritical, CRITICAL_POLL_MS);
    return () => clearInterval(timerRef.current);
  }, [fetchCritical]);

  return { events, loading, flashRef };
}

// ── Hook: dashboard data ──────────────────────────────────────────────────────

function useDashboardData(empId: string | undefined) {
  const [data, setData]       = useState<DashboardAPIResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    if (!empId) return;
    setLoading(true);
    setError(null);
    fetch(`${API_BASE}/dashboard/${empId}`, { headers: { accept: "application/json" } })
      .then((res) => {
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        return res.json() as Promise<DashboardAPIResponse>;
      })
      .then(setData)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Unknown error"))
      .finally(() => setLoading(false));
  }, [empId]);

  return { data, loading, error };
}

// ── Hook: team members ────────────────────────────────────────────────────────

function useTeamMembers(adminEmpId: string | undefined, enabled: boolean) {
  const [members, setMembers]   = useState<AnalystDetail[]>([]);
  const [teamName, setTeamName] = useState<string>("");
  const [loading, setLoading]   = useState<boolean>(false);

  useEffect(() => {
    if (!adminEmpId || !enabled) return;
    setLoading(true);
    fetch(`${API_BASE}/cases/admin/${adminEmpId}/analysts`, { headers: { accept: "application/json" } })
      .then((res) => {
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        return res.json() as Promise<TeamAPIResponse>;
      })
      .then((json) => {
        if (!json.success) return;
        setTeamName(json.data.team_name);
        setMembers(json.data.members.map((m) => ({
          name:           m.full_name.trim(),
          empId:          m.emp_ID,
          cases:          m.metrics.active,
          email:          m.email,
          phone:          m.phone_no,
          team:           json.data.team_name,
          level:          m.level,
          experience:     `${m.experience} yrs`,
          specialization: m.specialization,
          closedThisWeek: m.metrics.closed,
          accuracy:       m.metrics.decision_accuracy > 0 ? `${m.metrics.decision_accuracy}%` : "N/A",
          recentDecisions: (m.metrics.recent_decisions ?? []).map((d) => ({
            caseId:   d.case_id,
            decision: normaliseDecision(d.decision),
            raw:      d.decision,
          })),
        })));
      })
      .catch((err: unknown) => console.error("Team members API failed:", err))
      .finally(() => setLoading(false));
  }, [adminEmpId, enabled]);

  return { members, teamName, loading };
}

// ── Hook: live chart data (LOW vs CRITICAL — relative time buckets) ───────────
//
// Strategy: fetch the latest N events, find the actual time range they span,
// then divide that range into BUCKET_COUNT equal slots so the chart always
// fills the full width regardless of when the events occurred.

const CHART_FETCH_LIMIT = 500;   // pull as many events as possible
const CHART_POLL_MS     = 30_000; // refresh every 30s
const BUCKET_COUNT      = 24;    // number of columns in the chart

function useLiveChartData(): { chartData: ChartBucket[]; chartLoading: boolean } {
  const [chartData, setChartData]       = useState<ChartBucket[]>([]);
  const [chartLoading, setChartLoading] = useState<boolean>(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const buildBuckets = useCallback((events: LiveAPIEvent[]): ChartBucket[] => {
    if (!events.length) return [];

    // Find actual min/max timestamps in the dataset
    const times = events.map((e) => new Date(e.timestamp).getTime()).filter(Boolean);
    const minT   = Math.min(...times);
    const maxT   = Math.max(...times);
    const spanMs = maxT - minT || 1; // avoid /0

    // Build BUCKET_COUNT equal slots across [minT, maxT]
    const buckets: { low: number; critical: number; startMs: number }[] =
      Array.from({ length: BUCKET_COUNT }, (_, i) => ({
        low:      0,
        critical: 0,
        startMs:  minT + (spanMs / BUCKET_COUNT) * i,
      }));

    events.forEach((e) => {
      const t   = new Date(e.timestamp).getTime();
      const idx = Math.min(
        BUCKET_COUNT - 1,
        Math.floor(((t - minT) / spanMs) * BUCKET_COUNT),
      );
      const lvl   = (e.risk_level ?? "").toUpperCase();
      const score = e.risk_score ?? 0;

      // Mirror the riskLevel() fn in live-events.tsx:
      //   score >= 0.75 → critical, >= 0.55 → high, >= 0.35 → medium, else low
      // Also trust raw risk_level from the API (REVIEW = high in API terms)
      const isCriticalOrHigh =
        lvl === "CRITICAL" || lvl === "HIGH" || lvl === "REVIEW" || score >= 0.55;
      const isLow =
        lvl === "LOW" || lvl === "ALLOW" || (!isCriticalOrHigh && score < 0.35);

      if (isCriticalOrHigh) {
        buckets[idx].critical += 1;
      } else if (isLow) {
        buckets[idx].low += 1;
      }
    });

    // Format each bucket label as "HH:MM" from its start timestamp
    return buckets.map((b) => {
      const d  = new Date(b.startMs);
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      return { hour: `${hh}:${mm}`, low: b.low, critical: b.critical };
    });
  }, []);

  const fetchChart = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: String(CHART_FETCH_LIMIT) });
      const res = await fetch(`${API_BASE}/events/live?${params.toString()}`, {
        headers: { accept: "application/json" },
      });
      if (!res.ok) return;

      const data   = await res.json() as { count: number; events: LiveAPIEvent[] };
      const events: LiveAPIEvent[] = data.events ?? [];

      setChartData(buildBuckets(events));
      setChartLoading(false);
    } catch {
      setChartLoading(false);
    }
  }, [buildBuckets]);

  useEffect(() => {
    fetchChart();
    timerRef.current = setInterval(fetchChart, CHART_POLL_MS);
    return () => clearInterval(timerRef.current);
  }, [fetchChart]);

  return { chartData, chartLoading };
}

// ── Route ─────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/dashboard")({
  component: () => <ProtectedRoute><Dashboard /></ProtectedRoute>,
});

// ── Dashboard ─────────────────────────────────────────────────────────────────

function Dashboard() {
  const { user } = useAuth();
  const [openAnalyst, setOpenAnalyst] = useState<AnalystDetail | null>(null);

  if (!user) return null;

  const isAdmin = user.role === "admin";

  const empId: string =
    (user as unknown as Record<string, unknown>).emp_id as string ??
    (user as unknown as Record<string, unknown>).employee_id as string ??
    (user as unknown as Record<string, unknown>).employee_name as string ??
    user.email.split("@")[0];

  const fullName =
    user.full_name ||
    (user as unknown as Record<string, unknown>).employee_name as string ||
    user.email.split("@")[0];

  const { data: apiData, loading: apiLoading }        = useDashboardData(empId);
  const { members: teamMembers, teamName, loading: teamLoading } = useTeamMembers(empId, isAdmin);
  const { events: criticalEvents, loading: criticalLoading, flashRef } = useCriticalStream();

  // ── Live chart data ─────────────────────────────────────────────────────────
  const { chartData, chartLoading } = useLiveChartData();

  // ── KPI values ──────────────────────────────────────────────────────────────
  const myCases       = cases.filter((c) => c.assignedTo === ANALYST_ID);
  const visibleCases  = isAdmin ? cases : myCases;

  const openCount = apiData
    ? apiData.summary.open_cases + (apiData.summary.in_review_cases ?? 0)
    : visibleCases.filter((c) => c.status === "open" || c.status === "in_review").length;

  const unassignedCount =
    isAdmin && apiData?.summary.unassigned_cases != null
      ? apiData.summary.unassigned_cases
      : visibleCases.filter((c) => c.status === "unassigned" || c.assignedTo === null).length;

  const pendingCount = apiData
    ? apiData.summary.pending_cases
    : visibleCases.filter((c) => c.status === "pending" || c.status === "escalated").length;

  const closedCount = apiData
    ? apiData.summary.closed_cases
    : visibleCases.filter((c) => c.status === "closed").length;

  const totalCases   = apiData?.summary.total_cases ?? visibleCases.length;
  const openCaseLabel = apiData ? `${totalCases} total cases` : "Currently active";

  // ── Decision / risk distribution ────────────────────────────────────────────
  const PIE_COLORS = [
    "var(--success)",
    "var(--info)",
    "var(--warning)",
    "var(--destructive)",
  ];

  const decisionData = apiData
    ? Object.entries(apiData.risk_distribution).map(([name, value]) => ({ name, value }))
    : ["ALLOW", "MFA", "BLOCK", "FREEZE"].map((d) => ({
        name:  d,
        value: visibleCases.filter((c) => (c.adminDecision ?? c.suggestion) === d).length,
      }));

  return (
    <Tabs defaultValue="overview" className="space-y-4">
      <TabsContent value="overview" className="mt-0">
        <div className="space-y-6">

          {/* ── Header ── */}
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">
                {isAdmin ? "Global fraud command" : "My investigation workspace"}
              </h2>
              <p className="text-sm text-muted-foreground">
                {isAdmin
                  ? `Live overview across all teams · ${totalCases} active cases`
                  : `Hello ${fullName} — you have ${openCount} open cases assigned`}
              </p>
            </div>
            <Badge variant="outline" className="gap-2 border-primary/30 bg-primary/5 text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-primary pulse-dot" />
              {apiLoading ? "Syncing…" : `Live · last sync ${new Date().toLocaleTimeString()}`}
            </Badge>
          </div>

          {/* ── KPIs ── */}
          <div className={cn("grid gap-4", isAdmin ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-1 sm:grid-cols-3")}>
            <Kpi label="Open cases"      value={apiLoading ? "…" : openCount}      icon={FolderOpen}   delta={apiLoading ? "Loading…" : openCaseLabel} tone="info" />
            {isAdmin && (
              <Kpi label="Unassigned cases" value={apiLoading ? "…" : unassignedCount} icon={UserMinus}   delta="Awaiting assignment" tone="warning" />
            )}
            <Kpi label="Pending review"   value={apiLoading ? "…" : pendingCount}   icon={Clock}        delta="Analyst submitted"   tone="warning" />
            <Kpi label="Closed cases"     value={apiLoading ? "…" : closedCount}    icon={CheckCircle2} delta="Resolved"            tone="success" />
          </div>

          {/* ── Charts row ── */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2 p-5">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold">Low risk vs Critical · last 24h</h3>
                  <p className="text-xs text-muted-foreground">Live event volume by risk classification</p>
                </div>
                <Badge variant="secondary" className="gap-1.5">
                  <Activity className="h-3 w-3" /> Real-time
                </Badge>
              </div>
              <div className="h-64">
                {chartLoading ? (
                  <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading live data…
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor="var(--success)"     stopOpacity={0.4} />
                          <stop offset="95%" stopColor="var(--success)"     stopOpacity={0}   />
                        </linearGradient>
                        <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor="var(--destructive)" stopOpacity={0.45} />
                          <stop offset="95%" stopColor="var(--destructive)" stopOpacity={0}    />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="hour" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                      {/* <YAxis stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} /> */}
                      
                      <YAxis
  stroke="var(--muted-foreground)"
  fontSize={11}
  tickLine={false}
  axisLine={false}
  domain={[0, "auto"]}
  tickCount={6}
  allowDecimals={false}
/>
                      
                      <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} />
                      <Area dataKey="low"      name="Low Risk"        stroke="var(--success)"     strokeWidth={2} fill="url(#g1)" />
                      <Area dataKey="critical" name="Critical / High"  stroke="var(--destructive)" strokeWidth={2} fill="url(#g2)" />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
              <div className="mt-3 flex gap-4 text-xs">
                <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-success" /><span className="text-muted-foreground">Low Risk</span></div>
                <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-destructive" /><span className="text-muted-foreground">Critical / High</span></div>
              </div>
            </Card>

            <Card className="p-5">
              <h3 className="text-sm font-semibold">Decision distribution</h3>
              <p className="text-xs text-muted-foreground">{isAdmin ? "Across all cases" : "Across your assigned cases"}</p>
              <div className="mt-2 h-48">
                {apiLoading ? (
                  <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Loading…</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={decisionData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={3}>
                        {decisionData.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                {decisionData.map((d, i) => (
                  <div key={d.name} className="flex items-center gap-2">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                    <span className="truncate text-muted-foreground">{d.name}</span>
                    <span className="ml-auto font-medium">{d.value}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* ── ★ LIVE CRITICAL / HIGH EVENTS STREAM ── */}
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-destructive" />
                <h3 className="text-sm font-semibold">Live critical &amp; high-risk events</h3>
                <Badge variant="outline" className="gap-1.5 border-destructive/30 bg-destructive/5 text-destructive text-[10px]">
                  <span className="h-1.5 w-1.5 rounded-full bg-destructive animate-pulse" />
                  Streaming
                </Badge>
              </div>
              <Link to="/live-events" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                View all <ArrowUpRight className="h-3 w-3" />
              </Link>
            </div>

            {criticalLoading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Connecting to stream…
              </div>
            ) : criticalEvents.length === 0 ? (
              <div className="rounded-md border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                No critical or high-risk events at the moment.
              </div>
            ) : (
              <>
                {/* Table header */}
                <div className="mb-1 grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-4 px-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <span>Customer / Device</span>
                  <span>Channel</span>
                  <span>Amount</span>
                  <span>Risk</span>
                  <span className="text-right">Time</span>
                </div>

                <div className="divide-y divide-border/60 rounded-md border border-border overflow-hidden">
                  {criticalEvents.map((e: LiveAPIEvent) => {
                    const isNew = flashRef.current.has(e.id);
                    if (isNew) setTimeout(() => flashRef.current.delete(e.id), 1600);

                    const riskLvl = (e.risk_level ?? "").toUpperCase();
                    const isCritical = riskLvl === "CRITICAL";

                    return (
                      <div
                        key={e.id}
                        className={cn(
                          "grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-x-4 px-3 py-2.5 text-sm transition-colors",
                          isCritical ? "bg-destructive/5 hover:bg-destructive/10" : "bg-warning/5 hover:bg-warning/10",
                          isNew && "row-flash"
                        )}
                      >
                        {/* Customer / Device */}
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className={cn(
                              "h-1.5 w-1.5 shrink-0 rounded-full",
                              isCritical ? "bg-destructive animate-pulse" : "bg-warning animate-pulse"
                            )} />
                            <span className="truncate font-medium">{e.customer_id}</span>
                          </div>
                          <div className="mt-0.5 font-mono text-[10px] text-muted-foreground truncate">
                            {e.device_id} · {e.ip_address}
                          </div>
                        </div>

                        {/* Channel */}
                        <Badge variant="outline" className="text-[10px] whitespace-nowrap">
                          {e.channel}
                        </Badge>

                        {/* Amount */}
                        <span className="font-mono text-xs whitespace-nowrap">
                          ${e.amount?.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>

                        {/* Risk pill */}
                        <span className={cn(
                          "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap",
                          isCritical
                            ? "border-destructive/30 bg-destructive/15 text-destructive"
                            : "border-warning/30 bg-warning/15 text-warning"
                        )}>
                          <span className="font-mono">{Math.round(e.risk_score * 100)}</span>
                          <span className="opacity-70">·</span>
                          <span className="uppercase tracking-wider">{riskLvl}</span>
                        </span>

                        {/* Time */}
                        <span className="text-right font-mono text-[11px] text-muted-foreground whitespace-nowrap">
                          {timeAgo(e.timestamp)}
                        </span>
                      </div>
                    );
                  })}
                </div>

                <p className="mt-2 text-right text-[10px] text-muted-foreground">
                  Showing {criticalEvents.length} most recent · auto-refreshes every 3s
                </p>
              </>
            )}
          </Card>

          {/* ── Team performance (admin only) ── */}
          {isAdmin && (
            <Card className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold">Team performance</h3>
                  {teamName && <Badge variant="secondary" className="text-[10px]">{teamName}</Badge>}
                </div>
                {teamLoading && <span className="text-[11px] text-muted-foreground">Loading…</span>}
              </div>

              {!teamLoading && teamMembers.length === 0 ? (
                <div className="rounded-md border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                  No team members found.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {(teamLoading ? Array(4).fill(null) : teamMembers).map((m, idx) =>
                    m === null ? (
                      <div key={idx} className="h-28 animate-pulse rounded-lg border border-border bg-muted/40" />
                    ) : (
                      <button
                        key={m.empId}
                        onClick={() => setOpenAnalyst(m)}
                        className="group rounded-lg border border-border bg-card/60 p-3 text-left transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:bg-accent/40 hover:shadow-sm"
                      >
                        <div className="flex items-center gap-2">
                          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">
                            {m.name.split(" ").filter(Boolean).map((p: string) => p[0]).join("").toUpperCase().slice(0, 2)}
                          </span>
                          <div className="truncate text-sm font-medium">{m.name}</div>
                        </div>
                        <div className="mt-2 flex items-baseline gap-2">
                          <span className="text-2xl font-semibold">{m.cases}</span>
                          <span className="text-xs text-muted-foreground">cases</span>
                        </div>
                        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <BadgeCheck className="h-3 w-3 text-primary" />
                          <span className="truncate">{m.level}</span>
                        </div>
                        <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                          <span>{m.experience} exp.</span>
                          {m.recentDecisions.length > 0 && (
                            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                              {m.recentDecisions.length} decision{m.recentDecisions.length > 1 ? "s" : ""}
                            </span>
                          )}
                          <span className="text-primary opacity-0 transition-opacity group-hover:opacity-100">View →</span>
                        </div>
                      </button>
                    )
                  )}
                </div>
              )}
            </Card>
          )}

          {/* ── Analyst detail dialog ── */}
          <Dialog open={!!openAnalyst} onOpenChange={(o) => !o && setOpenAnalyst(null)}>
            <DialogContent className="sm:max-w-lg">
              {openAnalyst && (
                <>
                  <DialogHeader>
                    <div className="flex items-center gap-3">
                      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
                        {openAnalyst.name.split(" ").map((p: string) => p[0]).join("").toUpperCase().slice(0, 2)}
                      </span>
                      <div>
                        <DialogTitle className="text-base">{openAnalyst.name}</DialogTitle>
                        <DialogDescription className="text-xs">{openAnalyst.level} · {openAnalyst.team}</DialogDescription>
                      </div>
                    </div>
                  </DialogHeader>

                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 p-2">
                        <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="truncate">{openAnalyst.email}</span>
                      </div>
                      <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 p-2">
                        <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                        <span>{openAnalyst.phone}</span>
                      </div>
                    </div>

                    <div className="rounded-lg border border-border p-3">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Specialization</div>
                      <div className="mt-1 text-sm capitalize">{openAnalyst.specialization}</div>
                      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <BadgeCheck className="h-3 w-3 text-primary" />
                        {openAnalyst.level} · {openAnalyst.experience} experience
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <MiniStat label="Active"    value={openAnalyst.cases} />
                      <MiniStat label="Closed/wk" value={openAnalyst.closedThisWeek} />
                      <MiniStat label="Level"     value={openAnalyst.level.split(" ")[0]} />
                    </div>

                    <div className="rounded-lg border border-border p-3">
                      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        <Award className="h-3 w-3" /> Decision accuracy
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                          <div className="h-full bg-success" style={{ width: openAnalyst.accuracy === "N/A" ? "0%" : openAnalyst.accuracy }} />
                        </div>
                        <span className="text-sm font-semibold">{openAnalyst.accuracy}</span>
                      </div>
                    </div>

                    <div>
                      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        <TrendingUp className="h-3 w-3" /> Recent decisions
                      </div>
                      {openAnalyst.recentDecisions.length === 0 ? (
                        <div className="rounded-md border border-dashed border-border p-3 text-center text-[11px] text-muted-foreground">
                          No recent decisions yet.
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          {openAnalyst.recentDecisions.map((d, idx) => (
                            <div key={`${d.caseId}-${idx}`} className="flex items-center justify-between rounded-md border border-border bg-card/60 px-2.5 py-1.5 text-xs">
                              <span className="font-mono text-muted-foreground">{d.caseId}</span>
                              <DecisionChip decision={d.decision} />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </DialogContent>
          </Dialog>

        </div>
      </TabsContent>

      <TabsContent value="sources" className="mt-0">
        <DataSourcesPanel />
      </TabsContent>
    </Tabs>
  );
}

// ── DecisionChip ──────────────────────────────────────────────────────────────

function DecisionChip({ decision }: { decision: string }) {
  const colourMap: Record<string, string> = {
    ALLOW:    "border-success/30 bg-success/10 text-success",
    MFA:      "border-info/30 bg-info/10 text-info",
    BLOCK:    "border-warning/30 bg-warning/10 text-warning",
    FREEZE:   "border-destructive/30 bg-destructive/10 text-destructive",
    MONITOR:  "border-info/30 bg-info/10 text-info",
    CRITICAL: "border-destructive/30 bg-destructive/10 text-destructive",
    REVIEW:   "border-warning/30 bg-warning/10 text-warning",
  };
  return (
    <span className={cn("rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold", colourMap[decision] ?? "border-border bg-muted text-muted-foreground")}>
      {decision}
    </span>
  );
}

// ── Shared components ─────────────────────────────────────────────────────────

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-border bg-card/60 p-2 text-center">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm font-semibold">{value}</div>
    </div>
  );
}

function Kpi({
  label, value, icon: Icon, delta, tone,
}: {
  label: string;
  value: number | string;
  icon: React.ComponentType<{ className?: string }>;
  delta?: string;
  tone?: "success" | "warning" | "destructive" | "info";
}) {
  const toneClass =
    tone === "success"     ? "text-success"
    : tone === "warning"   ? "text-warning"
    : tone === "destructive" ? "text-destructive"
    : tone === "info"      ? "text-info"
    : "text-muted-foreground";
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
        <span className={cn("flex h-8 w-8 items-center justify-center rounded-md bg-muted", toneClass)}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <div className="mt-3 text-3xl font-semibold tracking-tight">{value}</div>
      {delta && <div className={cn("mt-1 text-xs", toneClass)}>{delta}</div>}
    </Card>
  );
}