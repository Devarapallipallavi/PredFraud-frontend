import { createFileRoute } from "@tanstack/react-router";
import { ProtectedRoute } from "@/components/protected-route";
import { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation,
  type SimulationLinkDatum, type SimulationNodeDatum,
} from "d3-force";
import { drag } from "d3-drag";
import { select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomBehavior } from "d3-zoom";
import { cn } from "@/lib/utils";
import { riskLevel } from "@/lib/mock-data";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { DataSourcesPanel } from "@/components/data-sources-panel";

export const Route = createFileRoute("/network-analysis")({
  component: () => (
    <ProtectedRoute allow={["admin"]}>
      <NetworkAnalysisPage />
    </ProtectedRoute>
  ),
});

// ---------- Domain data (named, realistic) ----------
type EntityType = "account" | "device" | "beneficiary" | "ip" | "merchant";
type Entity = {
  id: string;
  label: string;
  subLabel: string;
  type: EntityType;
  risk: number;
  caseId?: string;
};
type Relation = { from: string; to: string; label: string };

const ENTITIES: Entity[] = [
  { id: "acc-helena",   label: "Helena V.",      subLabel: "ACC-44820", type: "account",     risk: 78, caseId: "CSE-10250" },
  { id: "acc-daniela",  label: "Daniela C.",     subLabel: "ACC-99041", type: "account",     risk: 42 },
  { id: "acc-lin",      label: "Lin W.",         subLabel: "ACC-30584", type: "account",     risk: 51 },
  { id: "acc-omar",     label: "Omar H.",        subLabel: "ACC-72119", type: "account",     risk: 35 },
  { id: "dev-iphone15", label: "iPhone 15",      subLabel: "iOS 17",    type: "device",      risk: 84 },
  { id: "dev-macbook",  label: "MacBook Pro",    subLabel: "Safari",    type: "device",      risk: 18 },
  { id: "dev-pixel8",   label: "Pixel 8",        subLabel: "Android 14",type: "device",      risk: 22 },
  { id: "ben-acme",     label: "Acme Holdings",  subLabel: "Beneficiary", type: "beneficiary", risk: 91 },
  { id: "mer-brightfx", label: "Bright FX",      subLabel: "Merchant",  type: "merchant",    risk: 88 },
  { id: "mer-globalpay",label: "GlobalPay LTD",  subLabel: "Merchant",  type: "merchant",    risk: 66 },
  { id: "ip-1",         label: "45.66.21.9",     subLabel: "Tor exit",  type: "ip",          risk: 89 },
  { id: "ip-2",         label: "203.0.113.44",   subLabel: "Datacenter",type: "ip",          risk: 72 },
];

const RELATIONS: Relation[] = [
  { from: "acc-helena",  to: "dev-iphone15", label: "uses" },
  { from: "acc-helena",  to: "ben-acme",     label: "transfers to" },
  { from: "acc-daniela", to: "dev-macbook",  label: "uses" },
  { from: "acc-daniela", to: "ip-1",         label: "from" },
  { from: "acc-lin",     to: "mer-brightfx", label: "pays" },
  { from: "mer-brightfx",to: "mer-globalpay",label: "settles" },
  { from: "acc-omar",    to: "dev-pixel8",   label: "uses" },
  { from: "acc-omar",    to: "ip-2",         label: "from" },
  { from: "ip-1",        to: "ben-acme",     label: "linked" },
  { from: "dev-iphone15",to: "ben-acme",     label: "linked" },
  { from: "acc-lin",     to: "ip-2",         label: "linked" },
];

// ---------- Visual helpers ----------
function riskHex(risk: number) {
  if (risk > 80) return "hsl(var(--destructive, 0 80% 60%))"; // fallback if not defined
  if (risk > 60) return "rgb(234 179 8)"; // amber
  if (risk > 30) return "rgb(59 130 246)"; // blue
  return "rgb(34 197 94)"; // green
}
// Use design tokens via direct CSS variables (oklch in theme):
function riskColor(risk: number) {
  if (risk > 80) return "var(--destructive)";
  if (risk > 60) return "var(--warning)";
  if (risk > 30) return "var(--info)";
  return "var(--success)";
}


const RISK_TONE: Record<string, string> = {
  low: "bg-success/10 text-success border-success/30",
  medium: "bg-info/10 text-info border-info/30",
  high: "bg-warning/10 text-warning border-warning/30",
  critical: "bg-destructive/10 text-destructive border-destructive/30",
};

// ---------- Page ----------
function NetworkAnalysisPage() {
  const [selectedId, setSelectedId] = useState<string>("acc-helena");

  const selected = ENTITIES.find((e) => e.id === selectedId) ?? null;
  type Conn = { other: Entity; label: string; direction: "in" | "out" };
  const connections = useMemo<Conn[]>(() => {
    if (!selected) return [];
    const out: Conn[] = [];
    for (const r of RELATIONS) {
      if (r.from === selected.id) {
        const other = ENTITIES.find((e) => e.id === r.to);
        if (other) out.push({ other, label: r.label, direction: "out" });
      } else if (r.to === selected.id) {
        const other = ENTITIES.find((e) => e.id === r.from);
        if (other) out.push({ other, label: r.label, direction: "in" });
      }
    }
    return out;
  }, [selected]);

  return (
    <Tabs defaultValue="graph" className="space-y-4">
   

      <TabsContent value="graph" className="mt-0">
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_360px]">
          {/* Canvas */}
          <Card className="relative h-[calc(100vh-14rem)] min-h-140 overflow-hidden p-0">
            {/* Counter chips */}
            <div className="pointer-events-none absolute left-3 top-3 z-10 flex items-center gap-2">
              <span className="rounded-full border border-border/60 bg-background/80 px-2.5 py-1 text-[11px] font-medium text-foreground backdrop-blur">
                <span className="mr-1 inline-block h-1.5 w-1.5 -translate-y-px rounded-full bg-info" />
                {ENTITIES.length} nodes
              </span>
              <span className="rounded-full border border-border/60 bg-background/80 px-2.5 py-1 text-[11px] font-medium text-foreground backdrop-blur">
                {RELATIONS.length} edges
              </span>
            </div>

            {/* Grid background */}
            <div className="absolute inset-0 bg-[linear-gradient(to_right,color-mix(in_oklab,var(--border)_55%,transparent)_1px,transparent_1px),linear-gradient(to_bottom,color-mix(in_oklab,var(--border)_55%,transparent)_1px,transparent_1px)] bg-size-[32px_32px] opacity-40" />

            <NamedForceGraph
              entities={ENTITIES}
              relations={RELATIONS}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          </Card>

          {/* Inspector */}
          <Card className="flex h-fit flex-col p-0">
            {selected ? (
              <NodeInspector entity={selected} connections={connections} onSelect={setSelectedId} />
            ) : (
              <div className="p-10 text-center text-xs text-muted-foreground">Select a node to inspect.</div>
            )}
          </Card>
        </div>
      </TabsContent>

      <TabsContent value="sources" className="mt-0">
        <DataSourcesPanel />
      </TabsContent>
    </Tabs>
  );
}

// ---------- Inspector ----------
function NodeInspector({
  entity,
  connections,
  onSelect,
}: {
  entity: Entity;
  connections: { other: Entity; label: string; direction: "in" | "out" }[];
  onSelect: (id: string) => void;
}) {
  const lvl = riskLevel(entity.risk);
  return (
    <div className="p-4">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Selected node
      </div>
      <h3 className="mt-1 text-base font-semibold tracking-tight">
        {entity.label} · <span className="capitalize text-muted-foreground">{entity.type.slice(0, 3)}</span>
      </h3>
      <div className="mt-0.5 font-mono text-xs text-muted-foreground">{entity.subLabel}</div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Field label="Type" value={<span className="capitalize">{entity.type}</span>} />
        <Field
          label="Risk"
          value={
            <span className={cn("inline-flex items-center gap-1.5 text-foreground")}>
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  lvl === "critical" && "bg-destructive",
                  lvl === "high" && "bg-warning",
                  lvl === "medium" && "bg-info",
                  lvl === "low" && "bg-success",
                )}
              />
              {entity.risk}
            </span>
          }
        />
        <Field
          label="Linked case"
          value={
            entity.caseId ? <span className="font-mono">{entity.caseId}</span> : <span className="text-muted-foreground">—</span>
          }
        />
        <Field label="Connections" value={connections.length} />
      </div>

      <div className="mt-5">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Relationships
        </div>
        <div className="space-y-1.5">
          {connections.map((c, i) => (
            <button
              key={i}
              onClick={() => onSelect(c.other.id)}
              className="flex w-full items-center justify-between gap-2 rounded-md border border-border bg-card/60 px-2.5 py-2 text-left text-xs transition-colors hover:bg-accent/40"
            >
              <span className="truncate">
                <span className="text-muted-foreground">{c.label}</span>{" "}
                <span className="text-muted-foreground">→</span>{" "}
                <span className="font-medium">{c.other.label}</span>
              </span>
              <Badge
                variant="outline"
                className={cn("shrink-0 text-[10px] capitalize", RISK_TONE[riskLevel(c.other.risk)])}
              >
                {c.other.type}
              </Badge>
            </button>
          ))}
          {connections.length === 0 && (
            <div className="rounded-md border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
              No relationships found.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-card/60 px-2.5 py-1.5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-xs font-medium">{value}</div>
    </div>
  );
}

// ---------- D3 Named Force Graph ----------
interface SimNode extends SimulationNodeDatum, Entity {}
interface SimLink extends SimulationLinkDatum<SimNode> { label: string }

function NamedForceGraph({
  entities, relations, selectedId, onSelect,
}: {
  entities: Entity[];
  relations: Relation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!svgRef.current || size.w === 0) return;
    const svg = select(svgRef.current);
    svg.selectAll("*").remove();

    const root = svg.append("g");
    const linkLayer = root.append("g").attr("stroke-opacity", 0.55);
    const linkLabelLayer = root.append("g");
    const nodeLayer = root.append("g");

    const simNodes: SimNode[] = entities.map((e) => ({ ...e }));
    const idIndex = new Map(simNodes.map((n) => [n.id, n]));
    const simLinks: SimLink[] = relations.flatMap<SimLink>((r) => {
      const s = idIndex.get(r.from);
      const t = idIndex.get(r.to);
      if (!s || !t) return [];
      return [{ source: s, target: t, label: r.label }];
    });

    const sim = forceSimulation<SimNode>(simNodes)
      .force("link", forceLink<SimNode, SimLink>(simLinks).id((d) => d.id).distance(140).strength(0.4))
      .force("charge", forceManyBody<SimNode>().strength(-520))
      .force("collide", forceCollide<SimNode>().radius(46))
      .force("center", forceCenter(size.w / 2, size.h / 2));

    // Edges
    const link = linkLayer
      .selectAll("line")
      .data(simLinks)
      .join("line")
      .attr("stroke", "color-mix(in oklab, var(--muted-foreground) 55%, transparent)")
      .attr("stroke-width", 1);

    const linkLabel = linkLabelLayer
      .selectAll("text")
      .data(simLinks)
      .join("text")
      .attr("font-size", 9)
      .attr("fill", "var(--muted-foreground)")
      .attr("text-anchor", "middle")
      .attr("paint-order", "stroke")
      .attr("stroke", "var(--background)")
      .attr("stroke-width", 3)
      .text((d) => d.label);

    // Node groups (icon circle + label below)
    const node = nodeLayer
      .selectAll<SVGGElement, SimNode>("g.node")
      .data(simNodes)
      .join("g")
      .attr("class", "node")
      .style("cursor", "pointer")
      .on("click", (_e, d) => onSelect(d.id));

    const R = 22;

    // Halo for critical
    node.filter((d) => d.risk > 80)
      .append("circle")
      .attr("r", R + 6)
      .attr("fill", (d) => riskColor(d.risk))
      .attr("fill-opacity", 0.1);

    // Outer ring
    node.append("circle")
      .attr("r", R)
      .attr("fill", "var(--card)")
      .attr("stroke", (d) => riskColor(d.risk))
      .attr("stroke-width", 1.8);

    // Selection ring
    node.append("circle")
      .attr("class", "sel-ring")
      .attr("r", R + 4)
      .attr("fill", "none")
      .attr("stroke", "var(--primary)")
      .attr("stroke-width", 2)
      .attr("opacity", (d) => (d.id === selectedId ? 1 : 0));

    // Inner icon (rendered via foreignObject so we can use lucide React)
    node.append("foreignObject")
      .attr("x", -10).attr("y", -10).attr("width", 20).attr("height", 20)
      .append("xhtml:div")
      .attr("style", "display:flex;align-items:center;justify-content:center;width:20px;height:20px;color:var(--foreground);")
      .html((d) => iconSvg(d.type));

    // Label
    node.append("text")
      .attr("y", R + 14)
      .attr("text-anchor", "middle")
      .attr("font-size", 11)
      .attr("font-weight", 500)
      .attr("fill", "var(--foreground)")
      .attr("paint-order", "stroke")
      .attr("stroke", "var(--background)")
      .attr("stroke-width", 3)
      .text((d) => d.label);

    // Risk sublabel
    node.append("text")
      .attr("y", R + 26)
      .attr("text-anchor", "middle")
      .attr("font-size", 9)
      .attr("fill", (d) => riskColor(d.risk))
      .attr("paint-order", "stroke")
      .attr("stroke", "var(--background)")
      .attr("stroke-width", 3)
      .text((d) => `risk ${d.risk}`);

    // Drag
    const dragBehavior = drag<SVGGElement, SimNode>()
      .on("start", (event, d) => { if (!event.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
      .on("drag", (event, d) => { d.fx = event.x; d.fy = event.y; })
      .on("end", (event, d) => { if (!event.active) sim.alphaTarget(0); d.fx = null; d.fy = null; });
    node.call(dragBehavior);

    // Zoom
    const zoomBehavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3])
      .on("zoom", (event) => root.attr("transform", event.transform.toString()));
    zoomRef.current = zoomBehavior;
    svg.call(zoomBehavior);
    svg.on("dblclick.zoom", null);
    // Initial fit-ish
    svg.call(zoomBehavior.transform, zoomIdentity);

    sim.on("tick", () => {
      link
        .attr("x1", (d) => (d.source as SimNode).x ?? 0)
        .attr("y1", (d) => (d.source as SimNode).y ?? 0)
        .attr("x2", (d) => (d.target as SimNode).x ?? 0)
        .attr("y2", (d) => (d.target as SimNode).y ?? 0);
      linkLabel
        .attr("x", (d) => (((d.source as SimNode).x ?? 0) + ((d.target as SimNode).x ?? 0)) / 2)
        .attr("y", (d) => (((d.source as SimNode).y ?? 0) + ((d.target as SimNode).y ?? 0)) / 2);
      node.attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });

    return () => { sim.stop(); };
  }, [entities, relations, size, selectedId, onSelect]);

  return (
    <div ref={containerRef} className="absolute inset-0">
      <svg ref={svgRef} width={size.w} height={size.h} />
    </div>
  );
}

// Inline SVG icons (so they render inside foreignObject reliably across browsers)
function iconSvg(type: EntityType): string {
  const stroke = "currentColor";
  const common = `xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`;
  switch (type) {
    case "account":
      return `<svg ${common}><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>`;
    case "device":
      return `<svg ${common}><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/></svg>`;
    case "beneficiary":
      return `<svg ${common}><path d="M3 21V7l9-4 9 4v14"/><path d="M9 21v-6h6v6"/></svg>`;
    case "merchant":
      return `<svg ${common}><path d="M3 9 5 4h14l2 5"/><path d="M4 9h16v11H4z"/></svg>`;
    case "ip":
      return `<svg ${common}><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>`;
  }
}

// (riskHex kept for potential future use)
void riskHex;
