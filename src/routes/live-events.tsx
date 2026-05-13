import { createFileRoute } from "@tanstack/react-router";
import { ProtectedRoute } from "@/components/protected-route";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Pause, Play, Search, AlertCircle, Loader2, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/live-events")({
  component: () => <ProtectedRoute><LiveEventsPage /></ProtectedRoute>,
});

// ── Types ─────────────────────────────────────────────────────────────────────

type RiskLevel = "critical" | "high" | "medium" | "low";
type DecisionType = "ALLOW" | "MONITOR" | "REVIEW" | "BLOCK";
type CaseStatus = "UNASSIGNED" | "CLOSED" | "OPEN" | "PENDING";

interface LiveEvent {
  id: string;
  event_id: string;
  customer_id: string;
  amount: number;
  channel: string;
  device_id: string;
  ip_address: string;
  risk_score: number;
  risk_level: string;
  decision: DecisionType;
  action: string;
  case_id: string | null;
  case_status: CaseStatus;
  timestamp: string;
  source: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const BASE_URL = "https://predfraud-webapp-bxh8b2eudjgwevbb.eastus-01.azurewebsites.net";
const POLL_INTERVAL_MS = 2400;
const PAGE_LIMIT = 50;
const MAX_EVENTS = 200;
// How long to wait after /stream/start before polling (gives backend time to spin up)
const RESUME_WARMUP_MS = 3000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function riskLevel(score: number): RiskLevel {
  if (score >= 0.75) return "critical";
  if (score >= 0.55) return "high";
  if (score >= 0.35) return "medium";
  return "low";
}

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

export function RiskPill({ score }: { score: number }) {
  const lvl = riskLevel(score);
  const tone =
    lvl === "critical" ? "bg-destructive/15 text-destructive border-destructive/30"
    : lvl === "high"   ? "bg-warning/15 text-warning border-warning/30"
    : lvl === "medium" ? "bg-info/15 text-info border-info/30"
    :                    "bg-success/15 text-success border-success/30";
  const label: Record<RiskLevel, string> = {
    critical: "Critical", high: "High", medium: "Medium", low: "Low",
  };
  const displayScore = Math.round(score * 100);
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-semibold", tone)}>
      <span className="font-mono">{displayScore}</span>
      <span className="opacity-80">·</span>
      <span className="uppercase tracking-wider">{label[lvl]}</span>
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    ALLOW:      "bg-success/15 text-success",
    MONITOR:    "bg-info/15 text-info",
    REVIEW:     "bg-warning/15 text-warning",
    BLOCK:      "bg-destructive/15 text-destructive",
    UNASSIGNED: "bg-muted text-muted-foreground",
    CLOSED:     "bg-muted text-muted-foreground",
    OPEN:       "bg-info/15 text-info",
    PENDING:    "bg-warning/15 text-warning",
  };
  const normalized = status?.toUpperCase() ?? "UNKNOWN";
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider",
      map[normalized] ?? "bg-muted text-muted-foreground"
    )}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {normalized}
    </span>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm">{value}</div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

function LiveEventsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [events, setEvents]               = useState<LiveEvent[]>([]);
  const [paused, setPaused]               = useState<boolean>(false);
  const [reconnecting, setReconnecting]   = useState<boolean>(false);
  const [streamLoading, setStreamLoading] = useState<boolean>(false);
  const [fetchError, setFetchError]       = useState<string | null>(null);
  const [selected, setSelected]           = useState<LiveEvent | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);
  const [newEventCount, setNewEventCount] = useState<number>(0);

  // Filters
  const [query, setQuery]                   = useState<string>("");
  const [channelFilter, setChannelFilter]   = useState<string>("all");
  const [riskFilter, setRiskFilter]         = useState<string>("all");
  const [decisionFilter, setDecisionFilter] = useState<string>("all");

  const cursorRef  = useRef<string | null>(null);
  const flashRef   = useRef<Set<string>>(new Set());
  const pollingRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  // ── Fetch events ─────────────────────────────────────────────────────────
  const fetchEvents = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: String(PAGE_LIMIT) });
      if (cursorRef.current) params.set("after", cursorRef.current);

      console.log("[LiveEvents] Fetching:", params.toString());

      const res = await fetch(`${BASE_URL}/events/live?${params.toString()}`, {
        headers: { accept: "application/json" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json() as { count: number; events: LiveEvent[] };
      const incoming: LiveEvent[] = data.events ?? [];

      console.log(`[LiveEvents] Got ${incoming.length} events, cursor was: ${cursorRef.current}`);

      setLastFetchedAt(new Date());

      if (!incoming.length) return;

      // Cursor = OLDEST event timestamp (last item in array, since API returns newest-first)
      // So next poll fetches the 50 events AFTER this point in time
      cursorRef.current = incoming[incoming.length - 1].timestamp;

      setEvents((prev: LiveEvent[]) => {
        const existingIds = new Set(prev.map((e: LiveEvent) => e.id));
        const newEvts = incoming.filter((e: LiveEvent) => !existingIds.has(e.id));
        console.log(`[LiveEvents] ${newEvts.length} truly new events after dedup`);
        newEvts.forEach((e: LiveEvent) => flashRef.current.add(e.id));
        if (newEvts.length > 0) setNewEventCount((c) => c + newEvts.length);
        return [...newEvts, ...prev].slice(0, MAX_EVENTS);
      });

      setFetchError(null);
      setSelected((prev) => prev ?? incoming[0] ?? null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to fetch events";
      console.error("[LiveEvents] Fetch error:", msg);
      setFetchError(msg);
    }
  }, []);

  // ── Initial load ──────────────────────────────────────────────────────────
  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // ── Polling loop ──────────────────────────────────────────────────────────
  useEffect(() => {
    clearInterval(pollingRef.current);
    if (paused || reconnecting) return;

    pollingRef.current = setInterval(fetchEvents, POLL_INTERVAL_MS);
    return () => clearInterval(pollingRef.current);
  }, [paused, reconnecting, fetchEvents]);

  // ── Stream toggle ─────────────────────────────────────────────────────────
  const toggleStream = async () => {
    setStreamLoading(true);
    const isCurrentlyPaused = paused;

    try {
      const endpoint = isCurrentlyPaused ? "/stream/start" : "/stream/stop";
      console.log(`[LiveEvents] Calling ${endpoint}`);

      const res = await fetch(`${BASE_URL}${endpoint}`, {
        method: "POST",
        headers: { accept: "application/json" },
      });

      const body = await res.json().catch(() => ({}));
      console.log(`[LiveEvents] ${endpoint} response:`, res.status, body);

      if (!res.ok) {
        throw new Error(`${endpoint} failed: HTTP ${res.status} — ${JSON.stringify(body)}`);
      }

      if (isCurrentlyPaused) {
        // RESUME:
        // Keep cursor as-is → continues paginating from where we left off
        // Keep old events in table so it doesn't go blank
        // Show "Reconnecting" banner during warmup so the user knows it's working
        flashRef.current.clear();
        setNewEventCount(0);
        setReconnecting(true);
        setPaused(false);

        setTimeout(async () => {
          console.log("[LiveEvents] Warmup done, fetching fresh events");
          setReconnecting(false);
          await fetchEvents();
          // polling useEffect auto-restarts once reconnecting=false
        }, RESUME_WARMUP_MS);

      } else {
        // PAUSE
        clearInterval(pollingRef.current);
        setPaused(true);
      }

      setFetchError(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Stream toggle failed";
      console.error("[LiveEvents] Toggle error:", msg);
      setFetchError(msg);
    } finally {
      setStreamLoading(false);
    }
  };

  // ── Status label / dot ────────────────────────────────────────────────────
  const streamStatus   = reconnecting ? "Reconnecting…" : paused ? "Paused" : "Streaming";
  const streamDotClass = reconnecting
    ? "bg-warning animate-pulse"
    : paused
      ? "bg-muted-foreground"
      : "bg-success animate-pulse";

  // ── Filtered view ─────────────────────────────────────────────────────────
  const filtered = useMemo(() => events.filter((e: LiveEvent) => {
    if (channelFilter !== "all" && e.channel !== channelFilter) return false;
    if (decisionFilter !== "all" && e.decision !== decisionFilter) return false;
    if (riskFilter !== "all" && riskLevel(e.risk_score) !== riskFilter) return false;
    if (query) {
      const q = query.toLowerCase();
      if (![e.id, e.event_id, e.customer_id, e.ip_address, e.device_id].some(
        (f) => f?.toLowerCase().includes(q)
      )) return false;
    }
    return true;
  }), [events, channelFilter, decisionFilter, riskFilter, query]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className={cn("grid grid-cols-1 gap-4", isAdmin ? "xl:grid-cols-[1fr_420px]" : "")}>

      {/* Error banner */}
      {fetchError && (
        <div className="col-span-full flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {fetchError}
        </div>
      )}

      {/* Reconnecting banner */}
      {reconnecting && (
        <div className="col-span-full flex items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-4 py-2 text-sm text-warning">
          <RefreshCw className="h-4 w-4 shrink-0 animate-spin" />
          Waiting for stream to start — new events will appear in ~3 seconds…
        </div>
      )}

      {/* ── Events table ── */}
      <Card className="overflow-hidden p-0">

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search ID, customer, device, IP…"
              className="w-64 pl-9"
            />
          </div>

          <Select value={channelFilter} onValueChange={setChannelFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Channel" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All channels</SelectItem>
              <SelectItem value="MOBILE_APP">Mobile App</SelectItem>
              <SelectItem value="NET_BANKING">Net Banking</SelectItem>
              <SelectItem value="CARD">Card</SelectItem>
              <SelectItem value="API">API</SelectItem>
            </SelectContent>
          </Select>

          <Select value={riskFilter} onValueChange={setRiskFilter}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Risk" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All risk</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>

          <Select value={decisionFilter} onValueChange={setDecisionFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Decision" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All decisions</SelectItem>
              <SelectItem value="ALLOW">Allow</SelectItem>
              <SelectItem value="MONITOR">Monitor</SelectItem>
              <SelectItem value="REVIEW">Review</SelectItem>
              <SelectItem value="BLOCK">Block</SelectItem>
            </SelectContent>
          </Select>

          <div className="ml-auto flex items-center gap-3">
            {/* Live stats */}
            {!paused && !reconnecting && lastFetchedAt && (
              <span className="text-[11px] text-muted-foreground">
                +{newEventCount} new · last poll {timeAgo(lastFetchedAt.toISOString())}
              </span>
            )}

            <Badge variant="outline" className="gap-1.5">
              <span className={cn("h-1.5 w-1.5 rounded-full", streamDotClass)} />
              {streamStatus}
            </Badge>

            <Button
              variant="outline"
              size="sm"
              onClick={toggleStream}
              disabled={streamLoading || reconnecting}
            >
              {streamLoading || reconnecting
                ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                : paused
                  ? <Play className="mr-1.5 h-3.5 w-3.5" />
                  : <Pause className="mr-1.5 h-3.5 w-3.5" />
              }
              {reconnecting ? "Connecting…" : paused ? "Resume" : "Pause"}
            </Button>
          </div>
        </div>

        {/* Table */}
        <div className="max-h-[70vh] overflow-auto scrollbar-thin">
          {events.length === 0 ? (
            <div className="flex items-center justify-center gap-2 p-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading events…
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-card">
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Event ID</th>
                  <th className="px-4 py-2 font-medium">Customer</th>
                  <th className="px-4 py-2 font-medium">Channel</th>
                  <th className="px-4 py-2 font-medium">Amount</th>
                  <th className="px-4 py-2 font-medium">Risk</th>
                  <th className="px-4 py-2 font-medium">Decision</th>
                  <th className="px-4 py-2 font-medium text-right">Time</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e: LiveEvent) => {
                  const flash = flashRef.current.has(e.id);
                  if (flash) setTimeout(() => flashRef.current.delete(e.id), 1500);
                  return (
                    <tr
                      key={e.id}
                      onClick={() => isAdmin && setSelected(e)}
                      className={cn(
                        "border-b border-border/60 transition-colors",
                        isAdmin && "cursor-pointer hover:bg-accent/40",
                        isAdmin && selected?.id === e.id && "bg-accent/60",
                        flash && "row-flash"
                      )}
                    >
                      <td className="px-4 py-2.5 font-mono text-xs">{e.event_id}</td>
                      <td className="px-4 py-2.5">
                        <div className="font-medium">{e.customer_id}</div>
                        <div className="font-mono text-[10px] text-muted-foreground">{e.device_id}</div>
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge variant="outline" className="text-[10px]">{e.channel}</Badge>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs">
                        ${e.amount?.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-2.5"><RiskPill score={e.risk_score} /></td>
                      <td className="px-4 py-2.5"><StatusBadge status={e.decision} /></td>
                      <td className="px-4 py-2.5 text-right font-mono text-[11px] text-muted-foreground">
                        {timeAgo(e.timestamp)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      {/* ── Details panel (admin only) ── */}
      {isAdmin && (
        <Card className="h-fit p-0">
          <div className="border-b border-border p-4">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Event details</div>
            <div className="mt-1 font-mono text-sm">{selected?.event_id ?? "—"}</div>
          </div>
          {selected ? (
            <div className="space-y-4 p-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <Field label="Customer"    value={selected.customer_id} />
                <Field label="Channel"     value={<Badge variant="outline" className="text-[10px]">{selected.channel}</Badge>} />
                <Field label="Decision"    value={<StatusBadge status={selected.decision} />} />
                <Field label="Action"      value={<StatusBadge status={selected.action} />} />
                <Field label="Risk"        value={<RiskPill score={selected.risk_score} />} />
                <Field label="Risk level"  value={selected.risk_level} />
                <Field label="Amount"      value={
                  <span className="font-mono">
                    ${selected.amount?.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                } />
                <Field label="IP address"  value={<span className="font-mono">{selected.ip_address}</span>} />
                <Field label="Device"      value={<span className="font-mono text-xs">{selected.device_id}</span>} />
                <Field label="Source"      value={selected.source} />
                <Field label="Case ID"     value={
                  selected.case_id
                    ? <span className="font-mono">{selected.case_id}</span>
                    : <span className="text-muted-foreground">—</span>
                } />
                <Field label="Case status" value={<StatusBadge status={selected.case_status} />} />
                <Field label="Timestamp"   value={
                  <span className="font-mono text-[10px]">
                    {selected.timestamp?.replace("T", " ").split(".")[0]}
                  </span>
                } />
                <Field label="Time ago"    value={timeAgo(selected.timestamp)} />
              </div>
            </div>
          ) : (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Select an event to inspect
            </div>
          )}
        </Card>
      )}
    </div>
  );
}