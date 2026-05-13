import { createFileRoute } from "@tanstack/react-router";
import { ProtectedRoute } from "@/components/protected-route";
import { useAuth } from "@/lib/auth";
import {
  ANALYST_ID,
  type FraudCase,
  type Decision,
} from "@/lib/mock-data";
import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RiskPill, StatusBadge } from "./live-events";
import {
  Search, UserPlus, FileUp, Send, ShieldCheck, MoreHorizontal, FileText,
  CheckCircle2, Sparkles, ShieldAlert, Loader2, X, History, Clock,
  AlertCircle, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { PoliciesSheet } from "@/components/policies-sheet";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { DataSourcesPanel } from "@/components/data-sources-panel";

export const Route = createFileRoute("/cases")({
  component: () => <ProtectedRoute><CasesPage /></ProtectedRoute>,
});

const API_BASE = "https://predfraud-webapp-bxh8b2eudjgwevbb.eastus-01.azurewebsites.net";

// ── API response types ──────────────────────────────────────────────────────

interface ApiCaseListItem {
  case_id: string;
  customer_id: string;
  event_id: string;
  event_type: string;
  ml_risk_level: string;
  ml_risk_score: number;
  ml_suggested_action: string;
  ml_explanation: string;
  status: string;
  assigned_to: string | null;
  updated_at: string;
}

interface ApiCaseDetail {
  case_id: string;
  customer_id: string;
  status: string;
  amount: number;
  event_id: string;
  event_type: string;
  risk_score: number;
  risk_level: string;
  assigned_to: string | null;
  channel: string;
  reason_codes: string[];
  system_suggestion: string;
  ml_explanation: string;
  analyst_decision: {
    decision: string | null;
    recommended_action?: string | null;
    analyst_recommended_action?: string | null;
    action?: string | null;
    analyst_notes?: string | null;
    notes?: string | null;
    reviewed_by: string | null;
    reviewed_at: string | null;
  };
  admin_decision?: {
    decision?: string | null;
    action?: string | null;
    final_decision?: string | null;
    final_action?: string | null;
    notes?: string | null;
    admin_notes?: string | null;
    reviewed_by?: string | null;
    admin_reviewed_by?: string | null;
    reviewed_at?: string | null;
    admin_reviewed_at?: string | null;
  } | null;
}

interface ApiHistoryEntry {
  action?: string;
  stage?: string;
  by: string;
  note?: string;
  decision?: string;
  notes?: string;
  reason?: string;
  timestamp: string;
  [key: string]: any;
}

interface ApiTeamMember {
  emp_ID: string;
  full_name: string;
  email?: string;
  role?: string;
  level?: string;
}

// ── Extended FraudCase with rawSuggestion ────────────────────────────────────
type FraudCaseWithRaw = FraudCase & { rawSuggestion?: string | null };

// ── Mapping helpers ─────────────────────────────────────────────────────────

// FIX: Map API channel strings to the strict union expected by FraudCase
function mapChannel(ch: string | null | undefined): FraudCase["channel"] {
  const c = (ch ?? "").toLowerCase();
  if (c.includes("mobile") || c.includes("upi") || c.includes("app")) return "mobile";
  if (c.includes("branch") || c.includes("counter")) return "branch";
  if (c.includes("atm")) return "atm";
  return "web"; // safe default for "NEFT", "RTGS", "API", etc.
}

function mapSuggestionStrict(action: string | null | undefined): Exclude<Decision, "PENDING"> | null {
  if (!action) return null;
  const upper = action.toUpperCase().trim();
  if (upper.startsWith("ALLOW")) return "ALLOW";
  if (upper.startsWith("MFA")) return "MFA";
  if (upper.startsWith("FREEZE")) return "FREEZE";
  if (upper.startsWith("BLOCK")) return "BLOCK";
  return null;
}

// FIX: returns Exclude<Decision, "PENDING"> with a safe default — satisfies FraudCase.suggestion
function mapSuggestionSafe(action: string | null | undefined): Exclude<Decision, "PENDING"> {
  return mapSuggestionStrict(action) ?? "BLOCK";
}

function mapStatus(status: string): FraudCase["status"] {
  const s = (status ?? "").toLowerCase();
  if (s === "open") return "open";
  if (s === "in_review") return "in_review";
  if (s === "pending" || s === "pending_admin_review") return "pending";
  if (s === "escalated") return "escalated";
  if (s === "closed") return "closed";
  if (s === "unassigned") return "unassigned";
  if (s === "assigned" || s === "reassigned") return "open";
  return "open";
}

function mapAnalystDecision(
  ad: ApiCaseDetail["analyst_decision"] | undefined
): FraudCase["analystSubmission"] | null {  // FIX: return null instead of undefined
  if (!ad) return null;

  if (!ad.reviewed_by && !ad.reviewed_at && !ad.decision && !ad.recommended_action) {
    return null;
  }

  const resolvedAction =
    mapSuggestionStrict(ad.recommended_action) ??
    mapSuggestionStrict(ad.analyst_recommended_action) ??
    mapSuggestionStrict(ad.action) ??
    mapSuggestionStrict(ad.decision) ??
    null;

  if (!resolvedAction) return null;

  const freeTextNotes = ad.analyst_notes ?? ad.notes ?? "";

  return {
    decision: resolvedAction,
    notes: freeTextNotes,
    submittedAt: ad.reviewed_at ?? new Date().toISOString(),
    submittedByName: ad.reviewed_by ?? "Analyst",
  };
}



function mapListItem(item: ApiCaseListItem): FraudCaseWithRaw {
  return {
    id: item.case_id,
    title: item.event_type ?? "Transaction",
    customer: item.customer_id,
    customerId: item.customer_id,
    country: "—",
    currency: "INR",
    amount: 0,
    riskScore: item.ml_risk_score ?? 0,
    channel: mapChannel(item.event_type),
    reasons: [],
    suggestion: mapSuggestionSafe(item.ml_suggested_action),
    rawSuggestion: item.ml_suggested_action ?? null,
    status: mapStatus(item.status),
    assignedTo: item.assigned_to ?? null,
    assignedToName: item.assigned_to ?? null,
    lastUpdate: item.updated_at ?? new Date().toISOString(),
    openedAt: item.updated_at ?? new Date().toISOString(), // ← ADD THIS
    analystSubmission: null,
    adminDecision: null,
    adminDecidedAt: null,
  };
}


function mergeDetail(existing: FraudCaseWithRaw, detail: ApiCaseDetail): FraudCaseWithRaw {
  const base: any = {
    ...existing,
    amount: detail.amount ?? existing.amount,
    channel: mapChannel(detail.channel ?? ""),  // FIX: use mapChannel
    reasons: detail.reason_codes ?? existing.reasons,
    suggestion: mapSuggestionSafe(detail.system_suggestion), // FIX: never returns "PENDING"
    rawSuggestion: existing.rawSuggestion ?? null,
    status: mapStatus(detail.status),
    assignedTo: detail.assigned_to ?? existing.assignedTo,
    assignedToName: detail.assigned_to ?? existing.assignedToName,
    analystSubmission: mapAnalystDecision(detail.analyst_decision) ?? existing.analystSubmission,
    riskScore: detail.risk_score ?? existing.riskScore,
  };

  const ad = detail.admin_decision;
  if (ad) {
    const resolvedAdminDecision =
      mapSuggestionStrict(ad.final_decision) ??
      mapSuggestionStrict(ad.final_action) ??
      mapSuggestionStrict(ad.action) ??
      mapSuggestionStrict(ad.decision) ??
      null;

    if (resolvedAdminDecision) {
      base.adminDecision = resolvedAdminDecision;
      base.adminDecidedAt = ad.admin_reviewed_at ?? ad.reviewed_at ?? null; // FIX: null fallback
      base.adminNotes = ad.admin_notes ?? ad.notes ?? "";
      base.adminDecidedBy = ad.admin_reviewed_by ?? ad.reviewed_by ?? "";
    }
  }

  return base as FraudCaseWithRaw;
}

// ── Decision label map ───────────────────────────────────────────────────────
const DECISION_LABELS: Record<Exclude<Decision, "PENDING">, string> = {
  ALLOW:  "ALLOW- Approve transaction",
  MFA:    "MFA- Step-up authentication",
  BLOCK:  "BLOCK- Block this transaction",
  FREEZE: "FREEZE- Freeze the account",
};

// ── Helper: does this raw suggestion string map to a known Decision? ─────────
// Used to decide whether to show RawSuggestionBadge or DecisionBadge in the table.
function isRawUnmapped(raw: string | null | undefined): boolean {
  return raw != null && mapSuggestionStrict(raw) === null;
}

// ── Main page ───────────────────────────────────────────────────────────────

function CasesPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const empId = user?.emp_id ?? "";

  const [data, setData] = useState<FraudCaseWithRaw[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  const [mineData, setMineData] = useState<FraudCaseWithRaw[]>([]);
  const [loadingMine, setLoadingMine] = useState(false);
  const [mineFetched, setMineFetched] = useState(false);

  const [teamMembers, setTeamMembers] = useState<ApiTeamMember[]>([]);

  const [loadingDetail, setLoadingDetail] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [tab, setTab] = useState<"mine" | "all">(isAdmin ? "all" : "mine");
  const [open, setOpen] = useState<FraudCaseWithRaw | null>(null);
  const [policiesOpen, setPoliciesOpen] = useState(false);

  const [historySheetOpen, setHistorySheetOpen] = useState(false);
  const [historyForCase, setHistoryForCase] = useState<string | null>(null);
  const [historyData, setHistoryData] = useState<ApiHistoryEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const openHistory = useCallback(async (caseId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setHistoryForCase(caseId);
    setHistorySheetOpen(true);
    setLoadingHistory(true);
    setHistoryData([]);
    try {
      const res = await fetch(`${API_BASE}/cases/${caseId}/history`, {
        headers: { accept: "application/json" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setHistoryData(json.history ?? []);
    } catch {
      toast.error("Could not load case history.");
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  // ── Fetch all cases ───────────────────────────────────────────────────────
  const fetchCases = useCallback(async () => {
    setLoadingList(true);
    try {
      const res = await fetch(`${API_BASE}/cases`, {
        headers: { accept: "application/json" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const items: ApiCaseListItem[] = json.cases ?? [];
      setData(items.map((item) => mapListItem(item)));
    } catch {
      toast.error("Failed to load cases. Please try again.");
    } finally {
      setLoadingList(false);
    }
  }, []);

  const fetchMineCases = useCallback(async () => {
    setLoadingMine(true);
    try {
      const res = await fetch(
        `${API_BASE}/cases/assigned-to-me?emp_id=${encodeURIComponent(empId)}`,
        { headers: { accept: "application/json" } }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const items: ApiCaseListItem[] = json.cases ?? [];
      setMineData(items.map((item) => mapListItem(item)));
      setMineFetched(true);
    } catch {
      toast.error("Failed to load your assigned cases.");
    } finally {
      setLoadingMine(false);
    }
  }, [empId]);

  const fetchTeamMembers = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const res = await fetch(
        `https://predfraud-webapp-bxh8b2eudjgwevbb.eastus-01.azurewebsites.net/cases/admin/${encodeURIComponent(empId)}/analysts`,
        { headers: { accept: "application/json" } }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const adminDetails: ApiTeamMember | undefined = json.data?.admin_details
        ? {
            emp_ID: json.data.admin_details.emp_ID,
            full_name: json.data.admin_details.full_name,
            email: json.data.admin_details.email,
            role: json.data.admin_details.role,
          }
        : undefined;
      const members: ApiTeamMember[] = (json.data?.members ?? []).map((m: any) => ({
        emp_ID: m.emp_ID,
        full_name: m.full_name,
        email: m.email,
        level: m.level,
      }));
      const all: ApiTeamMember[] = adminDetails ? [adminDetails, ...members] : members;
      setTeamMembers(all);
    } catch {
      // non-blocking
    }
  }, [isAdmin, empId]);

  useEffect(() => {
    fetchCases();
    fetchTeamMembers();
  }, [fetchCases, fetchTeamMembers]);

  useEffect(() => {
    if (!isAdmin) {
      fetchMineCases();
    }
  }, [isAdmin, fetchMineCases]);

  const handleTabChange = (nextTab: "mine" | "all") => {
    setTab(nextTab);
    if (nextTab === "mine" && !mineFetched) {
      fetchMineCases();
    }
  };

  // ── Fetch case detail ─────────────────────────────────────────────────────
  const refreshCaseDetail = useCallback(
    async (caseId: string): Promise<FraudCaseWithRaw | null> => {
      try {
        const res = await fetch(`${API_BASE}/cases/${caseId}`, {
          headers: { accept: "application/json" },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const detail: ApiCaseDetail = await res.json();

        let captured: FraudCaseWithRaw | null = null;

        setData((prev) => {
          const existing = prev.find((c) => c.id === caseId);
          if (!existing) return prev;
          const merged = mergeDetail(existing, detail);
          captured = merged;
          return prev.map((c) => (c.id === caseId ? merged : c));
        });

        setMineData((prev) => {
          const existing = prev.find((c) => c.id === caseId);
          if (!existing) return prev;
          const merged = mergeDetail(existing, detail);
          if (!captured) captured = merged;
          return prev.map((c) => (c.id === caseId ? merged : c));
        });

        setOpen((o) => {
          if (!o || o.id !== caseId) return o;
          const merged = mergeDetail(o, detail);
          if (!captured) captured = merged;
          return merged;
        });

        if (!captured) {
          const skeleton: FraudCaseWithRaw = {
  id: caseId,
  title: detail.event_type ?? "Transaction",
  customer: detail.customer_id,
  customerId: detail.customer_id,
  country: "—",
  currency: "INR",
  amount: detail.amount ?? 0,
  riskScore: detail.risk_score ?? 0,
  channel: mapChannel(detail.channel ?? ""),
  reasons: detail.reason_codes ?? [],
  suggestion: mapSuggestionSafe(detail.system_suggestion),
  rawSuggestion: detail.system_suggestion ?? null,
  status: mapStatus(detail.status),
  assignedTo: detail.assigned_to ?? null,
  assignedToName: detail.assigned_to ?? null,
  lastUpdate: new Date().toISOString(),
  openedAt: new Date().toISOString(), // ← ADD THIS
  analystSubmission: null,
  adminDecision: null,
  adminDecidedAt: null,
};
          captured = mergeDetail(skeleton, detail);
        }

        return captured;
      } catch {
        return null;
      }
    },
    []
  );

  const openCase = useCallback(
    async (c: FraudCaseWithRaw) => {
      setOpen(c);
      setLoadingDetail(true);
      try {
        const enriched = await refreshCaseDetail(c.id);
        if (enriched) setOpen(enriched);
      } catch {
        toast.error("Could not load full case details.");
      } finally {
        setLoadingDetail(false);
      }
    },
    [refreshCaseDetail]
  );

  // ── Policy counts ─────────────────────────────────────────────────────────
  const [activePolicyCount, setActivePolicyCount] = useState<number>(0);

  const fetchPolicyCount = async () => {
    try {
      const res = await fetch(`${API_BASE}/policies`, {
        headers: { accept: "application/json" },
      });
      if (!res.ok) return;
      const json = await res.json();
      const active = (json.policies ?? []).filter((p: any) => p.is_active).length;
      setActivePolicyCount(active);
    } catch { /* silently ignore */ }
  };

  useEffect(() => { fetchPolicyCount(); }, []);

  const handlePoliciesOpenChange = (isOpen: boolean) => {
    setPoliciesOpen(isOpen);
    if (!isOpen) fetchPolicyCount();
  };

  // ── Filtering ─────────────────────────────────────────────────────────────
  const hasActiveFilters = query !== "" || statusFilter !== "all";

  const clearFilters = () => {
    setQuery("");
    setStatusFilter("all");
  };

  const filtered = useMemo(() => {
    let rows = (!isAdmin || tab === "mine") ? mineData : data;
    if (statusFilter !== "all") rows = rows.filter((c) => c.status === statusFilter);
    if (query) {
      const q = query.toLowerCase();
      rows = rows.filter((c) =>
        [c.id, c.title, c.customer, c.customerId, c.assignedToName ?? ""].some((f) =>
          f.toLowerCase().includes(q)
        )
      );
    }
    return rows;
  }, [data, mineData, tab, isAdmin, statusFilter, query]);

  const isLoadingCurrentTab =
    (!isAdmin || tab === "mine") ? loadingMine : loadingList;

  // ── Local state mutations ─────────────────────────────────────────────────
  const updateCase = (id: string, patch: Partial<FraudCaseWithRaw>) => {
    const ts = new Date().toISOString();
    setData((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...patch, lastUpdate: ts } : c))
    );
    setMineData((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...patch, lastUpdate: ts } : c))
    );
    setOpen((o) =>
      o && o.id === id ? { ...o, ...patch, lastUpdate: ts } : o
    );
  };

  // ── Analyst decision API ──────────────────────────────────────────────────
  const submitAnalystDecision = async (
    caseId: string,
    decision: Exclude<Decision, "PENDING">,
    notes: string
  ): Promise<boolean> => {
    const label = DECISION_LABELS[decision];
    try {
      const res = await fetch(`${API_BASE}/cases/analyst-decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          case_id: caseId,
          analyst_emp_id: empId,
          analyst_decision: label,
          analyst_notes: notes,
          analyst_recommended_action: label,
        }),
      });
      return res.ok;
    } catch {
      return false;
    }
  };

  // ── Admin decision API ────────────────────────────────────────────────────
  const submitAdminDecision = async (
    caseId: string,
    decision: Exclude<Decision, "PENDING">,
    adminNotes: string
  ): Promise<boolean> => {
    const label = DECISION_LABELS[decision];
    try {
      const res = await fetch(`${API_BASE}/cases/admin-decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          case_id: caseId,
          admin_emp_id: empId,
          final_decision: label,
          final_action: label,
          admin_notes: adminNotes,
        }),
      });
      return res.ok;
    } catch {
      return false;
    }
  };

  // ── Reopen case API ───────────────────────────────────────────────────────
  const submitReopenCase = async (caseId: string, reopenedBy: string, reason: string) => {
    try {
      const res = await fetch(`${API_BASE}/cases/reopen`, {
        method: "POST",
        headers: { "Content-Type": "application/json", accept: "application/json" },
        body: JSON.stringify({ case_id: caseId, reopened_by: reopenedBy, reason }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      // non-blocking
    }
  };

  // ── Assign case API ───────────────────────────────────────────────────────
  const submitAssignCase = async (
    caseId: string,
    assigneeEmpId: string,
    assigneeName: string
  ) => {
    try {
      const res = await fetch(`${API_BASE}/cases/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          case_id: caseId,
          assignee_emp_id: assigneeEmpId,
          assignee_name: assigneeName,
          assigned_by_emp_id: empId,
          reason: "Assigned by admin",
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      return json as {
        assigned_to: string;
        assigned_to_name: string;
        status: string;
      };
    } catch {
      return null;
    }
  };

  // ── Auto-assign API ───────────────────────────────────────────────────────
  const [autoAssigning, setAutoAssigning] = useState(false);

  const submitAutoAssign = async (caseIds: string[]): Promise<{
    successfully_assigned: number;
    assigned_details: { case_id: string; assigned_to: string; status: string }[];
  } | null> => {
    try {
      const res = await fetch(`${API_BASE}/cases/auto-assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          case_ids: caseIds,
          assigned_by_emp_id: empId,
          reason: "Auto-assigned by system based on team workload",
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch {
      return null;
    }
  };

  const totalCols = isAdmin ? 10 : 9;

  return (
    <Tabs defaultValue="cases" className="space-y-4">
      <TabsContent value="cases" className="mt-0">
        <div className="space-y-4">

          {/* ── Toolbar ── */}
          <Card className="p-4">
            <div className="flex flex-wrap items-center gap-2">
              {isAdmin && (
                <div className="inline-flex rounded-md border border-border bg-muted/50 p-0.5">
                  <button
                    onClick={() => handleTabChange("all")}
                    className={cn(
                      "rounded px-3 py-1 text-xs font-medium",
                      tab === "all" ? "bg-card shadow-sm" : "text-muted-foreground"
                    )}
                  >
                    All cases ({data.length})
                  </button>
                  <button
                    onClick={() => handleTabChange("mine")}
                    className={cn(
                      "rounded px-3 py-1 text-xs font-medium",
                      tab === "mine" ? "bg-card shadow-sm" : "text-muted-foreground"
                    )}
                  >
                    Assigned to me
                    {mineData.length > 0 && (
                      <span className="ml-1 text-muted-foreground">({mineData.length})</span>
                    )}
                  </button>
                </div>
              )}
              {!isAdmin && (
                <Badge variant="outline" className="gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-info" />
                  Showing only cases assigned to you
                </Badge>
              )}

              <div className="ml-auto flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search case, customer…"
                    className="w-64 pl-9"
                  />
                </div>

                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All status</SelectItem>
                    <SelectItem value="unassigned">Unassigned</SelectItem>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="in_review">In Review</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="escalated">Escalated</SelectItem>
                    <SelectItem value="closed">Closed</SelectItem>
                  </SelectContent>
                </Select>

                {hasActiveFilters && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-9 gap-1.5 text-muted-foreground hover:text-foreground"
                    onClick={clearFilters}
                  >
                    <X className="h-3.5 w-3.5" />
                    Clear
                  </Button>
                )}

                {isAdmin && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={autoAssigning}
                    className="h-9 gap-1.5 border-primary/40 bg-primary/5 text-primary hover:bg-primary/10"
                    onClick={async () => {
                      const unassigned = data.filter((c) => c.status === "unassigned");
                      if (unassigned.length === 0) {
                        toast.message("No unassigned cases to distribute");
                        return;
                      }

                      setAutoAssigning(true);
                      try {
                        const caseIds = unassigned.map((c) => c.id);
                        const result = await submitAutoAssign(caseIds);

                        if (!result) {
                          toast.error("Auto-assign failed. Please try again.");
                          return;
                        }

                        const assignedMap = new Map(
                          result.assigned_details
                            .filter((d) => d.status === "ASSIGNED" || d.status === "REASSIGNED")
                            .map((d) => [d.case_id, d.assigned_to])
                        );

                        const applyPatch = (
                          cases: FraudCaseWithRaw[],
                          ts: string
                        ): FraudCaseWithRaw[] =>
                          cases.map((c) => {
                            const assignedTo = assignedMap.get(c.id);
                            if (!assignedTo) return c;
                            return {
                              ...c,
                              assignedTo,
                              assignedToName: assignedTo,
                              status: "open" as FraudCase["status"],
                              lastUpdate: ts,
                            };
                          });

                        const ts = new Date().toISOString();
                        setData((prev) => applyPatch(prev, ts));

                        toast.success(
                          `Auto-assigned ${result.successfully_assigned} case${result.successfully_assigned !== 1 ? "s" : ""} across the team`
                        );

                        await fetchCases();
                        setData((prev) => applyPatch(prev, ts));
                      } finally {
                        setAutoAssigning(false);
                      }
                    }}
                  >
                    {autoAssigning ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" />
                    )}
                    {autoAssigning ? "Assigning…" : "Auto-assign"}
                  </Button>
                )}

                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 gap-1.5"
                  onClick={() => setPoliciesOpen(true)}
                >
                  <ShieldAlert className="h-3.5 w-3.5" />
                  Policies
                  <Badge variant="secondary" className="ml-1 h-4 px-1.5 text-[10px]">
                    {activePolicyCount}
                  </Badge>
                </Button>
              </div>
            </div>
          </Card>

          {/* ── Table ── */}
          <Card className="overflow-hidden p-0">
            <div className="max-h-[72vh] overflow-auto scrollbar-thin">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-card">
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-2 font-medium">Case ID</th>
                    <th className="px-4 py-2 font-medium">Event</th>
                    <th className="px-4 py-2 font-medium">User</th>
                    <th className="px-4 py-2 font-medium">Risk</th>
                    <th className="px-4 py-2 font-medium">Suggestion</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium">Assignee</th>
                    <th className="px-4 py-2 font-medium">Updated</th>
                    <th className="px-4 py-2 font-medium">History</th>
                    {isAdmin && <th className="px-4 py-2 font-medium text-right">Action</th>}
                  </tr>
                </thead>
                <tbody>
                  {isLoadingCurrentTab &&
                    Array.from({ length: 5 }).map((_, i) => (
                      <tr key={`skeleton-${i}`} className="border-b border-border/60">
                        {Array.from({ length: totalCols }).map((_, j) => (
                          <td key={j} className="px-4 py-3">
                            <div className="h-4 w-full animate-pulse rounded bg-muted" />
                          </td>
                        ))}
                      </tr>
                    ))}

                  {!isLoadingCurrentTab &&
                    filtered.map((c) => (
                      <tr key={c.id} className="border-b border-border/60 hover:bg-accent/40">
                        <td
                          onClick={() => openCase(c)}
                          className="cursor-pointer px-4 py-3 font-mono text-xs text-primary hover:underline"
                        >
                          {c.id}
                        </td>
                        <td onClick={() => openCase(c)} className="cursor-pointer px-4 py-3">
                          <div className="font-medium">{c.title}</div>
                          <div className="text-[11px] text-muted-foreground">{c.channel}</div>
                        </td>
                        <td onClick={() => openCase(c)} className="cursor-pointer px-4 py-3">
                          <div className="font-medium">{c.customer}</div>
                          <div className="font-mono text-[11px] text-muted-foreground">{c.customerId}</div>
                        </td>
                        <td onClick={() => openCase(c)} className="cursor-pointer px-4 py-3">
                          <RiskPill score={c.riskScore} />
                        </td>

                        {/* FIX: Use isRawUnmapped() instead of comparing to "PENDING" */}
                        <td onClick={() => openCase(c)} className="cursor-pointer px-4 py-3">
                          {isRawUnmapped(c.rawSuggestion) ? (
                            <RawSuggestionBadge value={c.rawSuggestion!} />
                          ) : (
                            <DecisionBadge decision={c.suggestion} />
                          )}
                        </td>

                        <td onClick={() => openCase(c)} className="cursor-pointer px-4 py-3">
                          <StatusBadge status={c.status} />
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {c.assignedToName ? (
                            c.assignedToName
                          ) : (
                            <span className="italic text-muted-foreground">Unassigned</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-[11px] text-muted-foreground">
                          {new Date(c.lastUpdate).toLocaleTimeString()}
                        </td>

                        <td className="px-4 py-3">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                            onClick={(e) => openHistory(c.id, e)}
                          >
                            <History className="h-3.5 w-3.5" />
                            View
                          </Button>
                        </td>

                        {isAdmin && (
                          <td className="px-4 py-3 text-right">
                            <CaseRowActions
                              caseItem={c}
                              teamMembers={teamMembers}
                              onAssign={async (memberId, memberName) => {
                                updateCase(c.id, {
                                  assignedTo: memberId,
                                  assignedToName: memberName,
                                  status: c.status === "unassigned" ? "open" : c.status,
                                });
                                const result = await submitAssignCase(c.id, memberId, memberName);
                                if (result) {
                                  updateCase(c.id, {
                                    assignedTo: result.assigned_to,
                                    assignedToName: result.assigned_to_name,
                                  });
                                  toast.success(`Assigned to ${result.assigned_to_name}`);
                                } else {
                                  toast.success(`Assigned to ${memberName}`);
                                }
                              }}
                              onUnassign={() => {
                                updateCase(c.id, {
                                  assignedTo: null,
                                  assignedToName: null,
                                  status: "unassigned",
                                });
                                toast.message("Case unassigned");
                              }}
                            />
                          </td>
                        )}
                      </tr>
                    ))}

                  {!isLoadingCurrentTab && filtered.length === 0 && (
                    <tr>
                      <td
                        colSpan={totalCols}
                        className="px-4 py-12 text-center text-sm text-muted-foreground"
                      >
                        {tab === "mine"
                          ? "No cases are currently assigned to you."
                          : "No cases match your filters."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          {/* ── Case detail sheet ── */}
          <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
            <SheetContent className="w-full overflow-y-auto p-0 sm:max-w-2xl scrollbar-thin">
              {open && (
                <CaseDetail
                  caseItem={open}
                  isAdmin={!!isAdmin}
                  empId={empId}
                  loadingDetail={loadingDetail}
                  onSubmitAnalystReview={async (decision, notes, fileName) => {
                    updateCase(open.id, {
                      status: "pending",
                      analystSubmission: {
                        decision,
                        notes,
                        fileName,
                        submittedAt: new Date().toISOString(),
                        submittedByName: open.assignedToName ?? "Analyst",
                      },
                    });

                    const ok = await submitAnalystDecision(open.id, decision, notes);
                    await refreshCaseDetail(open.id);

                    if (ok) {
                      toast.success("Submitted to admin for final decision");
                    } else {
                      toast.success("Saved locally — server sync may be delayed");
                    }
                  }}
                  onAdminFinalize={async (decision, adminNotes) => {
                    updateCase(open.id, {
                      adminDecision: decision,
                      adminDecidedAt: new Date().toISOString(),
                      status: "closed",
                      adminNotes,
                    } as any);

                    const ok = await submitAdminDecision(open.id, decision, adminNotes);
                    await refreshCaseDetail(open.id);

                    if (ok) {
                      toast.success(`Final decision: ${decision}`);
                    } else {
                      toast.success(`Decision saved locally — server sync may be delayed`);
                    }
                  }}
                  onReopen={async (reason) => {
                    const reopenedBy = (user as any)?.name ?? (user as any)?.id ?? "Admin";
                    await submitReopenCase(open.id, reopenedBy, reason);
                    updateCase(open.id, {
                      status: "open",
                      adminDecision: null,      // FIX: null
                      adminDecidedAt: null,     // FIX: null
                      analystSubmission: null,  // FIX: null
                    });
                    await refreshCaseDetail(open.id);
                    toast.success("Case reopened successfully");
                  }}
                />
              )}
            </SheetContent>
          </Sheet>

          {/* ── History sheet ── */}
          <Sheet open={historySheetOpen} onOpenChange={setHistorySheetOpen}>
            <SheetContent className="w-full overflow-y-auto p-0 sm:max-w-lg scrollbar-thin">
              <SheetHeader className="border-b border-border p-6">
                <div className="flex items-center gap-2">
                  <History className="h-4 w-4 text-muted-foreground" />
                  <SheetTitle className="text-base">Case History</SheetTitle>
                </div>
                {historyForCase && (
                  <SheetDescription className="font-mono text-xs">
                    {historyForCase}
                  </SheetDescription>
                )}
              </SheetHeader>

              <div className="p-6">
                {loadingHistory ? (
                  <div className="flex flex-col gap-5">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="flex gap-3">
                        <div className="mt-0.5 h-7 w-7 shrink-0 animate-pulse rounded-full bg-muted" />
                        <div className="flex-1 space-y-2 pt-1">
                          <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
                          <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
                          <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : historyData.length === 0 ? (
                  <p className="py-8 text-center text-sm italic text-muted-foreground">
                    No history available for this case.
                  </p>
                ) : (
                  <ol className="relative border-l border-border pl-0">
                    {historyData.map((entry, idx) => (
                      <HistoryEntry
                        key={idx}
                        entry={entry}
                        isLast={idx === historyData.length - 1}
                      />
                    ))}
                  </ol>
                )}
              </div>
            </SheetContent>
          </Sheet>

          <PoliciesSheet
            open={policiesOpen}
            onOpenChange={handlePoliciesOpenChange}
            isAdmin={!!isAdmin}
          />
        </div>
      </TabsContent>
      <TabsContent value="sources" className="mt-0">
        <DataSourcesPanel />
      </TabsContent>
    </Tabs>
  );
}

// ── History timeline entry ──────────────────────────────────────────────────

const STAGE_CONFIG: Record<
  string,
  { label: string; icon: React.ReactNode; dot: string; badge: string }
> = {
  CASE_CREATED: {
    label: "Case Created",
    icon: <AlertCircle className="h-3.5 w-3.5" />,
    dot: "bg-info/20 text-info border-info/40",
    badge: "bg-info/10 text-info border-info/30",
  },
  ANALYST_REVIEW: {
    label: "Analyst Review",
    icon: <ShieldCheck className="h-3.5 w-3.5" />,
    dot: "bg-primary/20 text-primary border-primary/40",
    badge: "bg-primary/10 text-primary border-primary/30",
  },
  ADMIN_FINAL: {
    label: "Admin Decision",
    icon: <ShieldCheck className="h-3.5 w-3.5" />,
    dot: "bg-warning/20 text-warning border-warning/40",
    badge: "bg-warning/10 text-warning border-warning/30",
  },
  REOPEN: {
    label: "Reopened",
    icon: <RefreshCw className="h-3.5 w-3.5" />,
    dot: "bg-destructive/20 text-destructive border-destructive/40",
    badge: "bg-destructive/10 text-destructive border-destructive/30",
  },
};

function HistoryEntry({
  entry,
  isLast,
}: {
  entry: ApiHistoryEntry;
  isLast: boolean;
}) {
  const stageKey = entry.stage ?? entry.action ?? "EVENT";
  const config = STAGE_CONFIG[stageKey] ?? {
    label: stageKey,
    icon: <Clock className="h-3.5 w-3.5" />,
    dot: "bg-muted text-muted-foreground border-border",
    badge: "bg-muted text-muted-foreground border-border",
  };

  let ts = "—";
  try { ts = new Date(entry.timestamp).toLocaleString(); } catch { /* ignore */ }

  const actionValue = entry.stage ? entry.action : undefined;

  return (
    <li className={cn("relative mb-6 pl-8", isLast && "mb-0")}>
      <span
        className={cn(
          "absolute left-0 top-0.5 flex h-7 w-7 -translate-x-3.5 items-center justify-center rounded-full border",
          config.dot
        )}
      >
        {config.icon}
      </span>

      <div className="rounded-lg border border-border bg-card/60 p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span
            className={cn(
              "inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
              config.badge
            )}
          >
            {config.label}
          </span>
          <span className="text-[10px] text-muted-foreground">{ts}</span>
        </div>

        <div className="text-[11px] text-muted-foreground">
          By: <span className="font-medium text-foreground">{entry.by}</span>
        </div>

        {(entry.decision || actionValue) && (
          <div className="space-y-1">
            {entry.decision && (
              <div className="flex items-start gap-2 text-xs">
                <span className="min-w-16 text-muted-foreground">Decision:</span>
                <span className="font-medium">{entry.decision}</span>
              </div>
            )}
            {actionValue && (
              <div className="flex items-start gap-2 text-xs">
                <span className="min-w-16 text-muted-foreground">Action:</span>
                <span className="font-medium">{actionValue}</span>
              </div>
            )}
          </div>
        )}

        {(entry.notes || entry.note || entry.reason) && (
          <div className="rounded-md bg-muted/40 px-2.5 py-1.5 text-xs leading-relaxed text-muted-foreground">
            {entry.notes || entry.note || entry.reason}
          </div>
        )}
      </div>
    </li>
  );
}

// ── Row action dropdown ─────────────────────────────────────────────────────

function CaseRowActions({
  caseItem,
  teamMembers,
  onAssign,
  onUnassign,
}: {
  caseItem: FraudCaseWithRaw;
  teamMembers: ApiTeamMember[];
  onAssign: (memberId: string, memberName: string) => void;
  onUnassign: () => void;
}) {
  const initials = (name: string) =>
    name.trim().split(/\s+/).map((p) => p[0]?.toUpperCase() ?? "").join("").slice(0, 2);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-[11px]">
          <UserPlus className="h-3 w-3" />
          {caseItem.assignedTo ? "Reassign" : "Assign"}
          <MoreHorizontal className="ml-0.5 h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Assign to team member
        </DropdownMenuLabel>

        {teamMembers.length === 0 ? (
          <DropdownMenuItem disabled className="text-xs italic text-muted-foreground">
            No team members found
          </DropdownMenuItem>
        ) : (
          teamMembers.map((m) => (
            <DropdownMenuItem
              key={m.emp_ID}
              onClick={() => onAssign(m.emp_ID, m.full_name.trim())}
              className={cn(caseItem.assignedTo === m.emp_ID && "bg-accent")}
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">
                {initials(m.full_name)}
              </span>
              <span className="ml-2 flex-1 truncate">{m.full_name.trim()}</span>
              {m.role === "admin" && (
                <span className="ml-1 rounded px-1 text-[9px] font-semibold uppercase tracking-wide text-warning bg-warning/10">
                  Admin
                </span>
              )}
              {m.level && (
                <span className="ml-1 rounded px-1 text-[9px] font-semibold uppercase tracking-wide text-info bg-info/10">
                  {m.level}
                </span>
              )}
              {caseItem.assignedTo === m.emp_ID && (
                <CheckCircle2 className="ml-1 h-3 w-3 text-primary" />
              )}
            </DropdownMenuItem>
          ))
        )}

        {caseItem.assignedTo && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onUnassign} className="text-destructive">
              Unassign
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Case detail panel ───────────────────────────────────────────────────────

function CaseDetail({
  caseItem, isAdmin, empId, loadingDetail, onSubmitAnalystReview, onAdminFinalize, onReopen,
}: {
  caseItem: FraudCaseWithRaw;
  isAdmin: boolean;
  empId: string;
  loadingDetail: boolean;
  onSubmitAnalystReview: (decision: Exclude<Decision, "PENDING">, notes: string, fileName?: string) => Promise<void>;
  onAdminFinalize: (decision: Exclude<Decision, "PENDING">, adminNotes: string) => Promise<void>;
  onReopen: (reason: string) => void;
}) {
  const isMyCase = caseItem.assignedTo === empId;
  const canAnalystAct = !isAdmin && isMyCase && !caseItem.analystSubmission;

  const [analystDecision, setAnalystDecision] = useState<Exclude<Decision, "PENDING">>(
    caseItem.suggestion  // suggestion is now always Exclude<Decision,"PENDING"> — safe to use directly
  );
  const [notes, setNotes] = useState("");
  const [fileName, setFileName] = useState<string | undefined>(undefined);
  const fileRef = useRef<HTMLInputElement>(null);
  const [submitting, setSubmitting] = useState(false);

  const [adminSelectedDecision, setAdminSelectedDecision] = useState<Exclude<Decision, "PENDING">>("BLOCK");
  const [adminNotes, setAdminNotes] = useState("");
  const [adminSubmitting, setAdminSubmitting] = useState(false);

  const [reopening, setReopening] = useState(false);
  const isClosed = caseItem.status === "closed";
  const caseAny = caseItem as any;

  return (
    <>
      <SheetHeader className="border-b border-border p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-mono text-xs text-muted-foreground">{caseItem.id}</div>
            <SheetTitle className="text-lg">{caseItem.title}</SheetTitle>
          </div>
          <div className="flex items-center gap-2">
            {loadingDetail && (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            )}
            <StatusBadge status={caseItem.status} />
            {isClosed && isAdmin && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 border-info/40 bg-info/10 text-info hover:bg-info/20 text-xs"
                disabled={reopening}
                onClick={async () => {
                  setReopening(true);
                  try {
                    await onReopen("Reopened by admin");
                  } finally {
                    setReopening(false);
                  }
                }}
              >
                {reopening ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3" />
                )}
                Reopen
              </Button>
            )}
          </div>
        </div>
        <SheetDescription>
          {caseItem.customer} · {caseItem.customerId} · {caseItem.country}
        </SheetDescription>
      </SheetHeader>

      <div className="space-y-5 p-6">
        <div className="grid grid-cols-3 gap-3">
          <Stat
            label="Amount"
            value={
              loadingDetail && caseItem.amount === 0 ? (
                <span className="animate-pulse text-muted-foreground">Loading…</span>
              ) : (
                `${caseItem.currency} ${caseItem.amount.toLocaleString()}`
              )
            }
          />
          <Stat label="Risk score" value={<RiskPill score={caseItem.riskScore} />} />
          <Stat label="Channel" value={caseItem.channel} />
        </div>

        <div>
          <div className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">
            Reason codes
          </div>
          {loadingDetail && caseItem.reasons.length === 0 ? (
            <div className="flex gap-2">
              {[1, 2].map((i) => (
                <div key={i} className="h-5 w-24 animate-pulse rounded-full bg-muted" />
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {caseItem.reasons.map((r) => (
                <Badge key={r} variant="secondary" className="text-[11px]">{r}</Badge>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-border p-3">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            System suggestion
          </div>
          <div className="mt-2 flex items-center gap-2">
            {/* FIX: use isRawUnmapped instead of comparing to "PENDING" */}
            {isRawUnmapped(caseItem.rawSuggestion) ? (
              <RawSuggestionBadge value={caseItem.rawSuggestion!} />
            ) : (
              <DecisionBadge decision={caseItem.suggestion} />
            )}
            <span className="text-xs text-muted-foreground">based on risk score and signal weights</span>
          </div>
        </div>

        {/* ═══ ANALYST DECISION SECTION ═══════════════════════════════════════ */}
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-4 py-3">
            <ShieldCheck className="h-4 w-4 text-info" />
            <h4 className="text-sm font-semibold">Step 1 — Analyst Review</h4>
            {caseItem.analystSubmission && (
              <span className="ml-auto flex items-center gap-1 text-[11px] font-medium text-success">
                <CheckCircle2 className="h-3.5 w-3.5" /> Submitted
              </span>
            )}
          </div>

          <div className="p-4">
            {caseItem.analystSubmission ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-success/5 border border-success/20 px-3 py-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                  <span className="text-xs font-medium text-success">
                    Submitted by {caseItem.analystSubmission.submittedByName}
                  </span>
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {new Date(caseItem.analystSubmission.submittedAt).toLocaleString()}
                  </span>
                </div>

                <div className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2.5">
                  <span className="min-w-32.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Recommended action
                  </span>
                  {/* FIX: analystSubmission.decision is now Exclude<Decision,"PENDING"> — no "PENDING" check needed */}
                  <DecisionBadge decision={caseItem.analystSubmission.decision} />
                </div>

                <div>
                  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Investigation notes
                  </div>
                  {caseItem.analystSubmission.notes ? (
                    <div className="rounded-md border border-border bg-muted/20 p-3 text-sm leading-relaxed whitespace-pre-wrap min-h-15">
                      {caseItem.analystSubmission.notes}
                    </div>
                  ) : (
                    <div className="rounded-md border border-border bg-muted/10 px-3 py-2 text-xs italic text-muted-foreground">
                      No notes provided
                    </div>
                  )}
                </div>

                {caseItem.analystSubmission.fileName ? (
                  <div className="flex items-center gap-2.5 rounded-md border border-border bg-muted/20 px-3 py-2.5">
                    <FileText className="h-4 w-4 shrink-0 text-info" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Evidence file
                      </div>
                      <div className="truncate text-xs font-medium">
                        {caseItem.analystSubmission.fileName}
                      </div>
                    </div>
                    <span className="text-[10px] text-muted-foreground">Attached</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <FileText className="h-3.5 w-3.5" />
                    No evidence file attached
                  </div>
                )}
              </div>

            ) : canAnalystAct ? (
              <div className="space-y-4">
                <p className="text-[11px] text-muted-foreground">
                  Fill in your decision, investigation notes, and optional evidence file, then submit to the admin for final review.
                </p>

                <div>
                  <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Recommended action
                  </label>
                  <Select
                    value={analystDecision}
                    onValueChange={(v) => setAnalystDecision(v as Exclude<Decision, "PENDING">)}
                    disabled={submitting}
                  >
                    <SelectTrigger className="w-full h-10"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALLOW">ALLOW — Approve transaction</SelectItem>
                      <SelectItem value="MFA">MFA — Step-up authentication</SelectItem>
                      <SelectItem value="BLOCK">BLOCK — Block this transaction</SelectItem>
                      <SelectItem value="FREEZE">FREEZE — Freeze the account</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Investigation notes <span className="text-destructive">*</span>
                  </label>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Describe what you found, signals reviewed, customer contact outcome…"
                    rows={5}
                    disabled={submitting}
                    className="resize-none"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Evidence file <span className="font-normal text-muted-foreground/60">(optional)</span>
                  </label>
                  <input ref={fileRef} type="file" className="hidden"
                    onChange={(e) => setFileName(e.target.files?.[0]?.name)} />
                  <Button variant="outline" size="sm" className="h-9 gap-2"
                    disabled={submitting} onClick={() => fileRef.current?.click()}>
                    <FileUp className="h-3.5 w-3.5" />
                    {fileName
                      ? <span className="max-w-50 truncate">{fileName}</span>
                      : "Upload file"}
                  </Button>
                </div>

                <Button size="lg" disabled={submitting}
                  onClick={async () => {
                    if (!notes.trim()) {
                      toast.error("Investigation notes are required before submitting");
                      return;
                    }
                    setSubmitting(true);
                    try { await onSubmitAnalystReview(analystDecision, notes.trim(), fileName); }
                    finally { setSubmitting(false); }
                  }}
                  className="w-full gap-2 font-semibold"
                >
                  {submitting
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <Send className="h-4 w-4" />}
                  {submitting ? "Submitting…" : "Submit to admin for final decision"}
                </Button>
              </div>

            ) : (
              <div className="flex items-center gap-2 rounded-md bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
                <Clock className="h-4 w-4 shrink-0" />
                {!isMyCase && !isAdmin
                  ? "This case is not assigned to you."
                  : "Awaiting analyst submission."}
              </div>
            )}
          </div>
        </div>

        {/* ═══ ADMIN DECISION SECTION ════════════════════════════════════════ */}
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-4 py-3">
            <ShieldCheck className="h-4 w-4 text-warning" />
            <h4 className="text-sm font-semibold">Step 2 — Admin Final Decision</h4>
            {caseItem.adminDecision && (
              <span className="ml-auto flex items-center gap-1 text-[11px] font-medium text-success">
                <CheckCircle2 className="h-3.5 w-3.5" /> Finalized
              </span>
            )}
          </div>

          <div className="p-4">
            {caseItem.adminDecision ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-success/5 border border-success/20 px-3 py-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                  <span className="text-xs font-medium text-success">
                    Finalized by {caseAny.adminDecidedBy || "Admin"}
                  </span>
                  {caseItem.adminDecidedAt && (
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {new Date(caseItem.adminDecidedAt).toLocaleString()}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2.5">
                  <span className="min-w-32.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Final decision
                  </span>
                  <DecisionBadge decision={caseItem.adminDecision} />
                </div>

                <div>
                  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Admin notes
                  </div>
                  {caseAny.adminNotes ? (
                    <div className="rounded-md border border-border bg-muted/20 p-3 text-sm leading-relaxed whitespace-pre-wrap min-h-15">
                      {caseAny.adminNotes}
                    </div>
                  ) : (
                    <div className="rounded-md border border-border bg-muted/10 px-3 py-2 text-xs italic text-muted-foreground">
                      No admin notes provided
                    </div>
                  )}
                </div>
              </div>

            ) : isAdmin ? (
              <div className="space-y-4">
                {!caseItem.analystSubmission && (
                  <div className="flex items-start gap-2 rounded-md bg-warning/10 border border-warning/30 px-3 py-2.5 text-[11px] text-warning">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    No analyst submission yet. You may still finalize directly.
                  </div>
                )}

                <div>
                  <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Final decision <span className="text-destructive">*</span>
                  </label>
                  <Select
                    value={adminSelectedDecision}
                    onValueChange={(v) => setAdminSelectedDecision(v as Exclude<Decision, "PENDING">)}
                    disabled={adminSubmitting}
                  >
                    <SelectTrigger className="w-full h-10"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALLOW">ALLOW — Approve transaction</SelectItem>
                      <SelectItem value="MFA">MFA — Step-up authentication</SelectItem>
                      <SelectItem value="BLOCK">BLOCK — Block this transaction</SelectItem>
                      <SelectItem value="FREEZE">FREEZE — Freeze the account</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Admin notes <span className="font-normal text-muted-foreground/60">(optional)</span>
                  </label>
                  <Textarea
                    value={adminNotes}
                    onChange={(e) => setAdminNotes(e.target.value)}
                    placeholder="Add your review notes, rationale, or feedback for the analyst…"
                    rows={4}
                    disabled={adminSubmitting}
                    className="resize-none"
                  />
                </div>

                <Button size="lg" disabled={adminSubmitting}
                  onClick={async () => {
                    setAdminSubmitting(true);
                    try { await onAdminFinalize(adminSelectedDecision, adminNotes.trim()); }
                    finally { setAdminSubmitting(false); }
                  }}
                  className="w-full gap-2 font-semibold"
                >
                  {adminSubmitting
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <ShieldCheck className="h-4 w-4" />}
                  {adminSubmitting ? "Finalizing…" : `Finalize as ${adminSelectedDecision}`}
                </Button>
              </div>

            ) : (
              <div className="flex items-center gap-2 rounded-md bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
                <Clock className="h-4 w-4 shrink-0" />
                Awaiting admin's final decision.
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ── Shared small components ─────────────────────────────────────────────────

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card/60 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  );
}

export function DecisionBadge({ decision }: { decision: Exclude<Decision, "PENDING"> | Decision }) {
  // FIX: accept both the full Decision union and the strict subtype
  const map: Record<string, string> = {
    ALLOW:   "bg-success/15 text-success border-success/30",
    MFA:     "bg-info/15 text-info border-info/30",
    BLOCK:   "bg-warning/15 text-warning border-warning/30",
    FREEZE:  "bg-destructive/15 text-destructive border-destructive/30",
    PENDING: "bg-muted text-muted-foreground border-border",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-[11px] font-semibold tracking-wider",
        map[decision] ?? map["PENDING"]
      )}
    >
      {decision}
    </span>
  );
}

export function RawSuggestionBadge({ value }: { value: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-[11px] font-semibold tracking-wider",
        "bg-violet-500/10 text-violet-600 border-violet-500/30 dark:text-violet-400 dark:border-violet-500/40"
      )}
    >
      {value}
    </span>
  );
}