import { createFileRoute } from "@tanstack/react-router";
import { ProtectedRoute } from "@/components/protected-route";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from "d3-force";
import { select } from "d3-selection";
import "d3-transition";
import { drag } from "d3-drag";
import { zoom, zoomIdentity, type ZoomBehavior } from "d3-zoom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { DataSourcesPanel } from "@/components/data-sources-panel";
import { cn } from "@/lib/utils";
import {
  Network,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Search,
  Snowflake,
  ShieldAlert,
  ExternalLink,
  Activity,
  Layers,
  GitBranch,
  Loader2,
  AlertCircle,
  RefreshCw,
} from "lucide-react";

// ─── Route ────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/fraud-network")({
  component: () => (
    <ProtectedRoute allow={["admin"]}>
      <FraudNetworkPage />
    </ProtectedRoute>
  ),
});

// ─── API base ────────────────────────────────────────────────────────────────

const API = "https://predfraud-webapp-bxh8b2eudjgwevbb.eastus-01.azurewebsites.net";

// ─── Types that mirror the live API ──────────────────────────────────────────

interface ApiNode {
  id: string;
  label: string;
  type: "customer" | "device" | "ip";
  risk_score: number; // 0-1
  risk_level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  connections: number;
  group: string;
}

interface ApiEdge {
  source: string;
  target: string;
  label: string;
  type: string;
}

interface ApiCluster {
  cluster_id: string;
  cluster_name: string;
  shared_via: string;
  shared_entity?: string;
  entity_count: number;
  risk_level: string;
  members: string[];
}

interface ApiGraphResponse {
  nodes: ApiNode[];
  edges: ApiEdge[];
  summary: { node_count: number; edge_count: number; critical_count: number };
  clusters: ApiCluster[];
}

interface ApiEntityDetail {
  node_id: string;
  type: string;
  risk_score: number;
  risk_level: string;
  transaction_count: number;
  linked_devices: string[];
  linked_ips: string[];
  recent_transactions: RecentTx[];
  suggested_actions: string[];
  error: string | null;
}

interface RecentTx {
  id: string;
  event_id: string;
  amount: number;
  channel: string;
  status: string;
  is_fraud: number;
  final_risk_score: number;
  ml_explanation: string;
  case_id: string | null;
  case_status: string;
  processed_at: string;
}

interface ApiStats {
  total_nodes: number;
  total_edges: number;
  critical_nodes: number;
}

// ─── Internal graph node type (adds d3 simulation fields) ───────────────────

interface SimNode extends SimulationNodeDatum, ApiNode {}
interface SimLink extends SimulationLinkDatum<SimNode> {
  label: string;
  edgeType: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function riskScore100(node: ApiNode) {
  return Math.round(node.risk_score * 100);
}

function riskColor(score100: number) {
  if (score100 > 80) return "var(--destructive)";
  if (score100 > 60) return "var(--warning)";
  if (score100 > 30) return "var(--info)";
  return "var(--success)";
}

function riskLevelLabel(score100: number): "low" | "medium" | "high" | "critical" {
  if (score100 > 80) return "critical";
  if (score100 > 60) return "high";
  if (score100 > 30) return "medium";
  return "low";
}

const RISK_TONE: Record<string, string> = {
  low: "bg-success/10 text-success border-success/30",
  medium: "bg-info/10 text-info border-info/30",
  high: "bg-warning/10 text-warning border-warning/30",
  critical: "bg-destructive/10 text-destructive border-destructive/30",
};

// ─── All-entities pseudo-cluster ─────────────────────────────────────────────

const ALL_CLUSTER_ID = "cluster-all";

// ─── Main page ───────────────────────────────────────────────────────────────

function FraudNetworkPage() {
  // ── Data state ──
  const [graphData, setGraphData] = useState<ApiGraphResponse | null>(null);
  const [clusters, setClusters] = useState<ApiCluster[]>([]);
  const [stats, setStats] = useState<ApiStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── UI state ──
  const [activeClusterId, setActiveClusterId] = useState<string>(ALL_CLUSTER_ID);
  const [selected, setSelected] = useState<SimNode | null>(null);
  const [entityDetail, setEntityDetail] = useState<ApiEntityDetail | null>(null);
  const [entityLoading, setEntityLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [highlightId, setHighlightId] = useState<string | null>(null);

  // ── Initial data fetch ──
  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [graphRes, clustersRes, statsRes] = await Promise.all([
        fetch(`${API}/network/graph`),
        fetch(`${API}/network/clusters`),
        fetch(`${API}/network/stats`),
      ]);
      if (!graphRes.ok) throw new Error(`Graph API ${graphRes.status}`);
      if (!clustersRes.ok) throw new Error(`Clusters API ${clustersRes.status}`);
      if (!statsRes.ok) throw new Error(`Stats API ${statsRes.status}`);

      const [graph, clusterPayload, statsPayload] = await Promise.all([
        graphRes.json() as Promise<ApiGraphResponse>,
        clustersRes.json() as Promise<{ clusters: ApiCluster[] }>,
        statsRes.json() as Promise<ApiStats>,
      ]);

      setGraphData(graph);
      setClusters(clusterPayload.clusters ?? []);
      setStats(statsPayload);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load network data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  // ── Fetch entity detail when selection changes ──
  useEffect(() => {
    if (!selected) {
      setEntityDetail(null);
      return;
    }
    setEntityLoading(true);
    fetch(`${API}/network/entity/${selected.id}`)
      .then((r) => r.json())
      .then((d: ApiEntityDetail) => setEntityDetail(d))
      .catch(() => setEntityDetail(null))
      .finally(() => setEntityLoading(false));
  }, [selected]);

  // ── Compute visible nodes/edges based on active cluster ──
  const allNodes: ApiNode[] = graphData?.nodes ?? [];
  const allEdges = graphData?.edges ?? [];

  const visibleNodes = useMemo<ApiNode[]>(() => {
    if (activeClusterId === ALL_CLUSTER_ID) return allNodes;
    const cluster = clusters.find((c) => c.cluster_id === activeClusterId);
    if (!cluster) return allNodes;
    const memberSet = new Set(cluster.members);
    return allNodes.filter((n) => memberSet.has(n.id));
  }, [activeClusterId, allNodes, clusters]);

  const visibleEdges = useMemo(() => {
    const ids = new Set(visibleNodes.map((n) => n.id));
    return allEdges.filter((e) => ids.has(e.source) && ids.has(e.target));
  }, [visibleNodes, allEdges]);

  // ── Search ──
  async function runSearch() {
    const q = search.trim();
    if (!q) {
      setHighlightId(null);
      return;
    }
    try {
      const res = await fetch(`${API}/network/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (data.results?.length) {
        const firstId: string =
          data.results[0].customer_id ??
          data.results[0].device_id ??
          data.results[0].ip_address;
        setHighlightId(firstId);
        const found = visibleNodes.find((n) => n.id === firstId);
        if (found) setSelected(found as unknown as SimNode);
      }
    } catch {
      const lower = q.toLowerCase();
      const found = visibleNodes.find((n) => n.id.toLowerCase().includes(lower));
      if (found) {
        setHighlightId(found.id);
        setSelected(found as unknown as SimNode);
      }
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin text-info" />
          <p className="text-sm font-medium">Loading fraud network…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center">
          <AlertCircle className="h-10 w-10 text-destructive" />
          <p className="text-sm text-muted-foreground max-w-xs">{error}</p>
          <Button size="sm" variant="outline" onClick={fetchAll}>
            <RefreshCw className="mr-2 h-3.5 w-3.5" /> Retry
          </Button>
        </div>
      </div>
    );
  }

  const criticalCount = visibleNodes.filter((n) => n.risk_score > 0.8).length;

  return (
    <Tabs defaultValue="graph" className="space-y-4">
      <TabsList>
        <TabsTrigger value="graph">Network Graph</TabsTrigger>
        {/* <TabsTrigger value="sources">Data Sources</TabsTrigger> */}
      </TabsList>

      <TabsContent value="graph" className="mt-0">
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[300px_1fr_340px]">
          {/* ── Left: Cluster sidebar ────────────────────────────────────── */}
          <ClusterSidebar
            clusters={clusters}
            allNodes={allNodes}
            activeClusterId={activeClusterId}
            totalNodes={allNodes.length}
            onSelectCluster={(id) => {
              setActiveClusterId(id);
              setSelected(null);
              setHighlightId(null);
            }}
          />

          {/* ── Centre: Canvas ────────────────────────────────────────────── */}
          <Card className="relative flex h-[calc(100vh-7rem)] flex-col overflow-hidden p-0">
            {/* toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card/80 p-3 backdrop-blur">
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2.5 py-1.5">
                  <Network className="h-3.5 w-3.5 text-info" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider">
                    Network graph
                  </span>
                </div>
                <div className="hidden items-center gap-3 text-[11px] text-muted-foreground md:flex">
                  <span className="flex items-center gap-1">
                    <Layers className="h-3 w-3" /> {visibleNodes.length} nodes
                  </span>
                  <span className="flex items-center gap-1">
                    <GitBranch className="h-3 w-3" /> {visibleEdges.length} edges
                  </span>
                  {criticalCount > 0 && (
                    <span className="flex items-center gap-1 text-destructive">
                      <ShieldAlert className="h-3 w-3" /> {criticalCount} critical
                    </span>
                  )}
                  {stats && (
                    <span className="flex items-center gap-1 text-muted-foreground/60">
                      / {stats.total_nodes} total
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && runSearch()}
                    placeholder="Find node ID…"
                    className="h-8 w-44 pl-8 text-xs"
                  />
                </div>
                <GraphToolbar />
              </div>
            </div>

            {/* canvas */}
            <div className="relative flex-1 grid-bg">
              <ForceGraph
                nodes={visibleNodes}
                edges={visibleEdges}
                selectedId={selected?.id ?? null}
                highlightId={highlightId}
                onSelect={(n) => setSelected(n)}
              />
              <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-1.5 rounded-full border border-border bg-card/80 px-2.5 py-1 backdrop-blur">
                <span className="h-1.5 w-1.5 rounded-full bg-success pulse-dot" />
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Force simulation active
                </span>
              </div>
            </div>
          </Card>

          {/* ── Right: Entity inspector ────────────────────────────────── */}
          <EntityInspector
            node={selected}
            detail={entityDetail}
            loading={entityLoading}
            allEdges={allEdges}
            allNodes={allNodes}
          />
        </div>
      </TabsContent>

      <TabsContent value="sources" className="mt-0">
        <DataSourcesPanel />
      </TabsContent>
    </Tabs>
  );
}

// ─── Cluster Sidebar ─────────────────────────────────────────────────────────

interface ClusterSidebarProps {
  clusters: ApiCluster[];
  allNodes: ApiNode[];
  activeClusterId: string;
  totalNodes: number;
  onSelectCluster: (id: string) => void;
}

function ClusterSidebar({
  clusters,
  allNodes,
  activeClusterId,
  totalNodes,
  onSelectCluster,
}: ClusterSidebarProps) {
  function avgRisk(members: string[]) {
    if (!members.length) return 0;
    const scores = members
      .map((id) => allNodes.find((n) => n.id === id)?.risk_score ?? 0)
      .filter(Boolean);
    if (!scores.length) return 0;
    return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100);
  }

  const allAvgRisk = allNodes.length
    ? Math.round(
        (allNodes.reduce((s, n) => s + n.risk_score, 0) / allNodes.length) * 100
      )
    : 0;

  const allLevel = riskLevelLabel(allAvgRisk);

  const dotCls = (lvl: string) =>
    cn(
      "h-2 w-2 shrink-0 rounded-full",
      lvl === "critical" && "bg-destructive",
      lvl === "high" && "bg-warning",
      lvl === "medium" && "bg-info",
      lvl === "low" && "bg-success"
    );

  const barCls = (lvl: string) =>
    cn(
      "h-full",
      lvl === "critical" && "bg-destructive",
      lvl === "high" && "bg-warning",
      lvl === "medium" && "bg-info",
      lvl === "low" && "bg-success"
    );

  const allRow = {
    cluster_id: ALL_CLUSTER_ID,
    cluster_name: "All entities",
    shared_via: "global",
    entity_count: totalNodes,
    risk_level: allLevel,
    avgRisk: allAvgRisk,
    members: [],
  };

  return (
    <Card className="flex h-[calc(100vh-7rem)] flex-col p-0">
      <div className="border-b border-border p-4">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-info">
          <Layers className="h-3 w-3" />
          Clusters
        </div>
        <h3 className="mt-1 text-sm font-semibold">Detected fraud rings</h3>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Isolate a sub-graph to investigate connected entities.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {[
          allRow,
          ...clusters.map((c) => ({
            ...c,
            avgRisk: avgRisk(c.members),
            risk_level: riskLevelLabel(avgRisk(c.members)),
          })),
        ].map((c) => {
          const active = activeClusterId === c.cluster_id;
          const lvl = c.risk_level as string;
          const flagged =
            c.cluster_id === ALL_CLUSTER_ID
              ? allNodes.filter((n) => n.risk_score > 0.6).length
              : c.members.filter((id) => {
                  const n = allNodes.find((x) => x.id === id);
                  return n && n.risk_score > 0.6;
                }).length;

          return (
            <button
              key={c.cluster_id}
              onClick={() => onSelectCluster(c.cluster_id)}
              className={cn(
                "block w-full border-b border-border/60 p-3 text-left transition-colors hover:bg-accent/40",
                active && "bg-accent/60"
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className={dotCls(lvl)} />
                    <div className="truncate text-xs font-semibold">{c.cluster_name}</div>
                  </div>
                  <div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                    {"shared_entity" in c && c.shared_entity
                      ? `via ${c.shared_entity}`
                      : c.shared_via ?? "global"}
                  </div>
                </div>
                <Badge variant="outline" className="font-mono text-[10px]">
                  {c.entity_count}
                </Badge>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                  <div className={barCls(lvl)} style={{ width: `${c.avgRisk}%` }} />
                </div>
                <span className="font-mono text-[10px] text-muted-foreground">{c.avgRisk}</span>
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground">
                {flagged} flagged entities
              </div>
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div className="border-t border-border p-3">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Risk levels
        </div>
        <div className="grid grid-cols-2 gap-1.5 text-[11px]">
          {(["Low", "Medium", "High", "Critical"] as const).map((l) => (
            <div key={l} className="flex items-center gap-1.5">
              <span
                className={cn(
                  "h-2 w-2 rounded-full",
                  l === "Critical" && "bg-destructive",
                  l === "High" && "bg-warning",
                  l === "Medium" && "bg-info",
                  l === "Low" && "bg-success"
                )}
              />
              <span className="text-muted-foreground">{l}</span>
            </div>
          ))}
        </div>

        {/* ── Updated Entity Types legend ── */}
        <div className="mt-3 mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Entity types
        </div>
        <div className="grid grid-cols-2 gap-1.5 text-[11px] text-muted-foreground">
          {/* Account → circle */}
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full border-2 border-current" />
            Account
          </div>
          {/* Critical → diamond */}
          <div className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 border-2 border-current"
              style={{ transform: "rotate(45deg)" }}
            />
            Critical
          </div>
          {/* Device → square */}
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 border-2 border-current" />
            Device
          </div>
          {/* High-risk / IP → triangle */}
          <div className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 bg-current"
              style={{ clipPath: "polygon(50% 0%, 0% 100%, 100% 100%)" }}
            />
            High / IP
          </div>
        </div>
      </div>
    </Card>
  );
}

// ─── Entity Inspector ─────────────────────────────────────────────────────────

interface EntityInspectorProps {
  node: SimNode | null;
  detail: ApiEntityDetail | null;
  loading: boolean;
  allEdges: ApiEdge[];
  allNodes: ApiNode[];
}

function EntityInspector({ node, detail, loading, allEdges, allNodes }: EntityInspectorProps) {
  const score100 = node ? riskScore100(node) : 0;
  const lvl = riskLevelLabel(score100);

  const linkedEdges = node
    ? allEdges.filter((e) => e.source === node.id || e.target === node.id)
    : [];

  return (
    <Card className="flex h-[calc(100vh-7rem)] flex-col p-0">
      <div className="border-b border-border p-4">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Entity inspector
        </div>
        {node ? (
          <>
            <h3 className="mt-1 truncate font-mono text-base font-semibold">{node.id}</h3>
            <div className="mt-1 flex items-center gap-2">
              <Badge
                variant="outline"
                className={cn("text-[10px] uppercase", RISK_TONE[lvl])}
              >
                {lvl} · {score100}
              </Badge>
              <span className="text-[11px] capitalize text-muted-foreground">{node.type}</span>
            </div>
          </>
        ) : (
          <h3 className="mt-1 text-sm font-semibold text-muted-foreground">No node selected</h3>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 scrollbar-thin">
        {!node ? (
          <div className="flex h-full flex-col items-center justify-center text-center text-muted-foreground">
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-muted/30">
              <Network className="h-5 w-5" />
            </div>
            <p className="mt-3 max-w-55 text-xs leading-relaxed">
              Click any node on the canvas to inspect its connections, risk score, and recommended
              actions.
            </p>
          </div>
        ) : loading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Risk gauge */}
            <div>
              <div className="mb-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <span>Risk score</span>
                <span className="font-mono">{score100} / 100</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full transition-all",
                    lvl === "critical" && "bg-destructive",
                    lvl === "high" && "bg-warning",
                    lvl === "medium" && "bg-info",
                    lvl === "low" && "bg-success"
                  )}
                  style={{ width: `${score100}%` }}
                />
              </div>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Type" value={<span className="capitalize">{node.type}</span>} />
              <Stat label="Connections" value={node.connections} />
              <Stat label="Transactions" value={detail?.transaction_count ?? "—"} />
              <Stat label="Risk level" value={node.risk_level} />
            </div>

            {/* Linked devices */}
            {detail?.linked_devices?.length ? (
              <div>
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Linked devices ({detail.linked_devices.length})
                </div>
                <div className="space-y-1">
                  {detail.linked_devices.slice(0, 5).map((d) => (
                    <div
                      key={d}
                      className="rounded-md border border-border bg-card/60 px-2.5 py-1.5 text-xs font-mono"
                    >
                      {d}
                    </div>
                  ))}
                  {detail.linked_devices.length > 5 && (
                    <p className="text-[10px] text-muted-foreground">
                      +{detail.linked_devices.length - 5} more
                    </p>
                  )}
                </div>
              </div>
            ) : null}

            {/* Linked IPs */}
            {detail?.linked_ips?.length ? (
              <div>
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Linked IPs ({detail.linked_ips.length})
                </div>
                <div className="space-y-1">
                  {detail.linked_ips.slice(0, 4).map((ip) => (
                    <div
                      key={ip}
                      className="rounded-md border border-border bg-card/60 px-2.5 py-1.5 text-xs font-mono"
                    >
                      {ip}
                    </div>
                  ))}
                  {detail.linked_ips.length > 4 && (
                    <p className="text-[10px] text-muted-foreground">
                      +{detail.linked_ips.length - 4} more
                    </p>
                  )}
                </div>
              </div>
            ) : null}

            {/* Direct relationships */}
            <div>
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Direct relationships ({linkedEdges.length})
              </div>
              <div className="space-y-1.5">
                {linkedEdges.slice(0, 8).map((e, i) => {
                  const otherId = e.source === node.id ? e.target : e.source;
                  const other = allNodes.find((n) => n.id === otherId);
                  const otherScore = other ? riskScore100(other) : 0;
                  return (
                    <div
                      key={i}
                      className="flex items-center justify-between rounded-md border border-border bg-card/60 px-2.5 py-1.5 text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ background: riskColor(otherScore) }}
                        />
                        <span className="font-mono">{otherId}</span>
                      </div>
                      <span className="text-[10px] text-muted-foreground">{e.label}</span>
                    </div>
                  );
                })}
                {linkedEdges.length === 0 && (
                  <div className="rounded-md border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
                    No connections
                  </div>
                )}
              </div>
            </div>

            {/* Recent transactions */}
            {detail?.recent_transactions?.length ? (
              <div>
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Recent transactions
                </div>
                <div className="space-y-1.5">
                  {detail.recent_transactions.slice(0, 4).map((tx) => (
                    <div
                      key={tx.id}
                      className={cn(
                        "rounded-md border px-2.5 py-2 text-xs",
                        tx.is_fraud
                          ? "border-destructive/30 bg-destructive/5"
                          : "border-border bg-card/60"
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {tx.event_id}
                        </span>
                        <span
                          className={cn(
                            "text-[10px] font-semibold",
                            tx.is_fraud ? "text-destructive" : "text-success"
                          )}
                        >
                          {tx.is_fraud ? "FRAUD" : "CLEAN"}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center justify-between">
                        <span className="font-medium">₹{tx.amount.toLocaleString()}</span>
                        <span className="text-[10px] text-muted-foreground">{tx.channel}</span>
                      </div>
                      {tx.ml_explanation && (
                        <p className="mt-0.5 text-[10px] text-muted-foreground line-clamp-1">
                          {tx.ml_explanation}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Investigation actions */}
            <div>
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Investigation actions
              </div>
              <div className="space-y-1.5">
                {(
                  detail?.suggested_actions ?? [
                    "Open linked case",
                    "Trace transactions",
                    "Freeze entity",
                    "Add to watchlist",
                  ]
                ).map((action) => {
                  const icon = action.toLowerCase().includes("case") ? (
                    <ExternalLink className="mr-2 h-3.5 w-3.5" />
                  ) : action.toLowerCase().includes("trace") ? (
                    <Activity className="mr-2 h-3.5 w-3.5" />
                  ) : action.toLowerCase().includes("freeze") ? (
                    <Snowflake className="mr-2 h-3.5 w-3.5" />
                  ) : (
                    <ShieldAlert className="mr-2 h-3.5 w-3.5" />
                  );
                  return (
                    <Button
                      key={action}
                      variant="outline"
                      size="sm"
                      className="w-full justify-start text-xs"
                    >
                      {icon}
                      {action}
                    </Button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

// ─── Force Graph ──────────────────────────────────────────────────────────────

interface ForceGraphProps {
  nodes: ApiNode[];
  edges: ApiEdge[];
  selectedId: string | null;
  highlightId: string | null;
  onSelect: (n: SimNode) => void;
}

function ForceGraph({ nodes, edges, selectedId, highlightId, onSelect }: ForceGraphProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() =>
      setSize({ w: el.clientWidth, h: el.clientHeight })
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!svgRef.current || size.w === 0 || !nodes.length) return;
    const svg = select(svgRef.current);
    svg.selectAll("*").remove();

    const defs = svg.append("defs");
    const grad = defs
      .append("radialGradient")
      .attr("id", "bgFade")
      .attr("cx", "50%")
      .attr("cy", "50%")
      .attr("r", "60%");
    grad
      .append("stop")
      .attr("offset", "0%")
      .attr("stop-color", "var(--primary)")
      .attr("stop-opacity", 0.04);
    grad
      .append("stop")
      .attr("offset", "100%")
      .attr("stop-color", "var(--background)")
      .attr("stop-opacity", 0);
    svg
      .append("rect")
      .attr("width", size.w)
      .attr("height", size.h)
      .attr("fill", "url(#bgFade)");

    const root = svg.append("g").attr("class", "root");
    const linkLayer = root.append("g").attr("class", "links").attr("stroke-opacity", 0.45);
    const nodeLayer = root.append("g").attr("class", "nodes");

    const simNodes: SimNode[] = nodes.map((n) => ({ ...n }));
    const idIndex = new Map(simNodes.map((n) => [n.id, n]));

    const simLinks: SimLink[] = edges.flatMap<SimLink>((e) => {
      const s = idIndex.get(e.source);
      const t = idIndex.get(e.target);
      if (!s || !t) return [];
      return [{ source: s, target: t, label: e.label, edgeType: e.type } as SimLink];
    });

    const sim = forceSimulation<SimNode>(simNodes)
      .force(
        "link",
        forceLink<SimNode, SimLink>(simLinks)
          .id((d) => d.id)
          .distance(80)
          .strength(0.45)
      )
      .force("charge", forceManyBody<SimNode>().strength(-220))
      .force("collide", forceCollide<SimNode>().radius((d) => 10 + d.risk_score * 12))
      .force("center", forceCenter(size.w / 2, size.h / 2));

    const link = linkLayer
      .selectAll("line")
      .data(simLinks)
      .join("line")
      .attr("stroke", (d) => {
        const r = Math.max(
          (d.source as SimNode).risk_score,
          (d.target as SimNode).risk_score
        );
        return riskColor(Math.round(r * 100));
      })
      .attr("stroke-width", 1.1);

    const node = nodeLayer
      .selectAll<SVGGElement, SimNode>("g")
      .data(simNodes)
      .join("g")
      .attr("class", "node")
      .style("cursor", "pointer")
      .on("click", (_event, d) => onSelect(d));

    // ── Node shape rendering ──────────────────────────────────────────────────
    // Shape is determined by RISK LEVEL (matches Image 3 & 4):
    //   ◆ Diamond  → CRITICAL  (score > 80)
    //   △ Triangle → HIGH or IP (score > 60, or type === "ip")
    //   □ Square   → DEVICE
    //   ● Circle   → everything else (account / customer / low-medium)
    node.each(function (d) {
      const g = select(this);
      const score = Math.round(d.risk_score * 100);
      const r = 7 + d.risk_score * 10; // slightly larger than before
      const color = riskColor(score);
      const isCritical = score > 80;
      const isHigh = score > 60;

      // Soft glow ring for critical nodes
      if (isCritical) {
        g.append("circle")
          .attr("r", r + 8)
          .attr("fill", color)
          .attr("fill-opacity", 0.15);
      }

      if (isCritical) {
        // ◆ Diamond — rotate a square 45°
        g.append("rect")
          .attr("x", -r)
          .attr("y", -r)
          .attr("width", r * 2)
          .attr("height", r * 2)
          .attr("transform", "rotate(45)")
          .attr("fill", color)
          .attr("fill-opacity", 0.85)
          .attr("stroke", color)
          .attr("stroke-width", 1.5);
      } else if (d.type === "device") {
        // □ Square — device nodes
        g.append("rect")
          .attr("x", -r)
          .attr("y", -r)
          .attr("width", r * 2)
          .attr("height", r * 2)
          .attr("fill", color)
          .attr("fill-opacity", 0.75)
          .attr("stroke", color)
          .attr("stroke-width", 1.2);
      } else if (d.type === "ip" || isHigh) {
        // △ Triangle — high-risk customer or IP address
        const h = r * 1.8;
        const points = `0,${-(h * 0.6)} ${r},${h * 0.4} ${-r},${h * 0.4}`;
        g.append("polygon")
          .attr("points", points)
          .attr("fill", color)
          .attr("fill-opacity", 0.8)
          .attr("stroke", color)
          .attr("stroke-width", 1.2);
      } else {
        // ● Circle — account / customer / low-medium risk
        g.append("circle")
          .attr("r", r)
          .attr("fill", color)
          .attr("fill-opacity", 0.75)
          .attr("stroke", color)
          .attr("stroke-width", 1.2);
      }
    });

    // Selection / highlight outline
    const targetId = selectedId ?? highlightId;
    if (targetId) {
      node
        .filter((d) => d.id === targetId)
        .selectAll("circle, rect, polygon")
        .attr("stroke", "var(--primary)")
        .attr("stroke-width", 2.8);
    }

    // Drag behaviour
    const dragBehavior = drag<SVGGElement, SimNode>()
      .on("start", (event, d) => {
        if (!event.active) sim.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on("end", (event, d) => {
        if (!event.active) sim.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });
    node.call(dragBehavior);

    // Zoom behaviour
    const zoomBehavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 6])
      .on("zoom", (event) => {
        root.attr("transform", event.transform.toString());
      });
    zoomRef.current = zoomBehavior;
    svg.call(zoomBehavior);
    svg.on("dblclick.zoom", null);

    // Toolbar wiring
    const onZoomIn = () => svg.transition().duration(250).call(zoomBehavior.scaleBy, 1.3);
    const onZoomOut = () => svg.transition().duration(250).call(zoomBehavior.scaleBy, 1 / 1.3);
    const onFit = () =>
      svg.transition().duration(400).call(zoomBehavior.transform, zoomIdentity);
    document.querySelectorAll("[data-graph-action]").forEach((btn) => {
      const action = btn.getAttribute("data-graph-action");
      const handler =
        action === "zoom-in"
          ? onZoomIn
          : action === "zoom-out"
            ? onZoomOut
            : action === "fit"
              ? onFit
              : null;
      if (handler) (btn as HTMLElement).onclick = handler;
    });

    sim.on("tick", () => {
      link
        .attr("x1", (d) => (d.source as SimNode).x ?? 0)
        .attr("y1", (d) => (d.source as SimNode).y ?? 0)
        .attr("x2", (d) => (d.target as SimNode).x ?? 0)
        .attr("y2", (d) => (d.target as SimNode).y ?? 0);
      node.attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });

    return () => {
      sim.stop();
    };
  }, [nodes, edges, size, selectedId, highlightId, onSelect]);

  return (
    <div ref={containerRef} className="absolute inset-0">
      <svg ref={svgRef} width={size.w} height={size.h} />
    </div>
  );
}

// ─── Toolbar ──────────────────────────────────────────────────────────────────

function GraphToolbar() {
  return (
    <div className="flex items-center gap-0.5 rounded-md border border-border bg-muted/30 p-0.5">
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        data-graph-action="zoom-in"
        title="Zoom in"
      >
        <ZoomIn className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        data-graph-action="zoom-out"
        title="Zoom out"
      >
        <ZoomOut className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        data-graph-action="fit"
        title="Reset view"
      >
        <Maximize2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

// ─── Stat cell ────────────────────────────────────────────────────────────────

function Stat({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="rounded-md border border-border bg-card/60 p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("mt-0.5 text-xs font-medium", mono && "font-mono")}>{value}</div>
    </div>
  );
}