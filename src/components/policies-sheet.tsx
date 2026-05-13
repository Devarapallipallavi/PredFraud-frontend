 
import { useState, useEffect, useCallback } from "react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { ShieldAlert, Pencil, Plus, Trash2, Lock, FileText, Eye, Loader2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
 
// ─── Constants ───────────────────────────────────────────────────────────────
 
const API_BASE = "https://predfraud-webapp-bxh8b2eudjgwevbb.eastus-01.azurewebsites.net";
const CURRENT_USER = "Compliance Admin";
 
// ─── Types ───────────────────────────────────────────────────────────────────
 
export type PolicySeverity = "low" | "medium" | "high" | "critical";
export type PolicyAction = "ALLOW" | "MFA" | "BLOCK" | "FREEZE" | "REVIEW" | string;
export type PolicyCategory =
  | "Transaction Monitoring"
  | "Authentication"
  | "Account Takeover"
  | "AML / Sanctions"
  | "Card Fraud"
  | "Device & Channel"
  | "Account Protection"
  | string;
 
/** Shape used in the UI */
export interface Policy {
  id: string;
  code: string;
  name: string;
  category: PolicyCategory;
  description: string;
  threshold: string;
  action: PolicyAction;
  severity: PolicySeverity;
  enabled: boolean;
  updatedAt: string;
  updatedBy: string;
}
 
/** Raw shape returned by the API */
interface ApiPolicy {
  id?: string;
  policy_id?: string;
  name: string;
  description: string;
  category: string;
  risk_level: string;
  suggested_action: string;
  is_active: boolean;
  created_by?: string;
  created_at?: string;
  updated_at?: string;
  updated_by?: string;
  _rid?: string;
  _self?: string;
  _etag?: string;
  _attachments?: string;
  _ts?: number;
}
 
// ─── Mappers ─────────────────────────────────────────────────────────────────
 
function toSeverity(raw: string): PolicySeverity {
  const map: Record<string, PolicySeverity> = {
    LOW: "low",
    MEDIUM: "medium",
    HIGH: "high",
    CRITICAL: "critical",
  };
  return map[raw?.toUpperCase()] ?? "low";
}
 
function fromApi(p: ApiPolicy): Policy {
  const id = p.policy_id ?? p.id ?? "";
  const codeParts = id.split("-");
  const code = codeParts.length >= 3 ? `${codeParts[1]}-${codeParts[2].slice(0, 4)}` : id;
 
  return {
    id,
    code,
    name: p.name,
    category: p.category,
    description: p.description,
    threshold: "",
    action: p.suggested_action ?? "ALLOW",
    severity: toSeverity(p.risk_level),
    enabled: p.is_active,
    updatedAt: p.updated_at ?? p.created_at ?? new Date().toISOString(),
    updatedBy: p.updated_by ?? p.created_by ?? CURRENT_USER,
  };
}
 
/** Convert UI form → API create payload (matches swagger exactly) */
function toCreatePayload(form: Partial<Policy>) {
  return {
    name: form.name ?? "",
    description: form.description ?? "",
    category: form.category ?? "Transaction Monitoring",
    risk_level: (form.severity ?? "low").toUpperCase(),
    suggested_action: form.action ?? "ALLOW",
    is_active: form.enabled ?? true,
    created_by: CURRENT_USER,
  };
}
 
/** Convert UI form → API update payload */
function toUpdatePayload(form: Partial<Policy>) {
  return {
    name: form.name,
    description: form.description,
    risk_level: form.severity ? form.severity.toUpperCase() : undefined,
    suggested_action: form.action,
    is_active: form.enabled,
    updated_by: CURRENT_USER,
  };
}
 
// ─── API helpers ─────────────────────────────────────────────────────────────
 
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", accept: "application/json" },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}
 
// ─── Style maps ──────────────────────────────────────────────────────────────
 
const SEVERITY_STYLES: Record<string, string> = {
  low: "bg-success/15 text-success border-success/30",
  medium: "bg-info/15 text-info border-info/30",
  high: "bg-warning/15 text-warning border-warning/30",
  critical: "bg-destructive/15 text-destructive border-destructive/30",
};
 
const ACTION_STYLES: Record<string, string> = {
  ALLOW: "bg-success/15 text-success border-success/30",
  MFA: "bg-info/15 text-info border-info/30",
  BLOCK: "bg-warning/15 text-warning border-warning/30",
  FREEZE: "bg-destructive/15 text-destructive border-destructive/30",
  REVIEW: "bg-warning/15 text-warning border-warning/30",
};
 
// ─── Component props ──────────────────────────────────────────────────────────
 
interface PoliciesSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  policies?: Policy[];
  onPoliciesChange?: (policies: Policy[]) => void;
  isAdmin: boolean;
}
 
// ─── Main Component ───────────────────────────────────────────────────────────
 
export function PoliciesSheet({ open, onOpenChange, isAdmin }: PoliciesSheetProps) {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
 
  const [editing, setEditing]   = useState<Policy | null>(null);
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing]   = useState<Policy | null>(null);
 
  // ── Fetch all policies ──────────────────────────────────────────────────────
  const fetchPolicies = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ policies: ApiPolicy[] }>("/policies");
      setPolicies((data.policies ?? []).map(fromApi));
    } catch (e: any) {
      setError(e.message ?? "Failed to load policies");
    } finally {
      setLoading(false);
    }
  }, []);
 
  useEffect(() => {
    if (open) fetchPolicies();
  }, [open, fetchPolicies]);
 
  // ── Toggle ──────────────────────────────────────────────────────────────────
  const togglePolicy = async (policy: Policy, enabled: boolean) => {
    setPolicies((prev) => prev.map((p) => (p.id === policy.id ? { ...p, enabled } : p)));
    try {
      await apiFetch(`/policies/${policy.id}/toggle`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: enabled, updated_by: CURRENT_USER }),
      });
      toast.message(`${policy.name} ${enabled ? "enabled" : "disabled"}`);
    } catch (e: any) {
      setPolicies((prev) => prev.map((p) => (p.id === policy.id ? { ...p, enabled: !enabled } : p)));
      toast.error(`Toggle failed: ${e.message}`);
    }
  };
 
  // ── Update ──────────────────────────────────────────────────────────────────
  const updatePolicy = async (id: string, patch: Partial<Policy>) => {
    try {
      const updated = await apiFetch<ApiPolicy>(`/policies/${id}`, {
        method: "PATCH",
        body: JSON.stringify(toUpdatePayload(patch)),
      });
      setPolicies((prev) => prev.map((p) => (p.id === id ? fromApi(updated) : p)));
      toast.success("Policy updated");
      setEditing(null);
    } catch (e: any) {
      toast.error(`Update failed: ${e.message}`);
    }
  };
 
  // ── Delete ──────────────────────────────────────────────────────────────────
  const deletePolicy = async (id: string) => {
    const prev = policies;
    setPolicies((ps) => ps.filter((p) => p.id !== id));
    try {
      await apiFetch(`/policies/${id}`, { method: "DELETE" });
      toast.success("Policy removed");
    } catch (e: any) {
      setPolicies(prev);
      toast.error(`Delete failed: ${e.message}`);
    }
  };
 
  // ── Create ──────────────────────────────────────────────────────────────────
  const addPolicy = async (form: Partial<Policy>) => {
    try {
      const created = await apiFetch<ApiPolicy>("/policies", {
        method: "POST",
        body: JSON.stringify(toCreatePayload(form)),
      });
      // Code is auto-generated by the API from the returned policy_id
      const newPolicy: Policy = {
        ...fromApi(created),
        threshold: form.threshold ?? "",
      };
      setPolicies((prev) => [newPolicy, ...prev]);
      toast.success("Policy created");
      setCreating(false);
    } catch (e: any) {
      toast.error(`Create failed: ${e.message}`);
    }
  };
 
  // ─── Render ────────────────────────────────────────────────────────────────
 
  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full overflow-y-auto p-0 sm:max-w-3xl scrollbar-thin">
          <SheetHeader className="border-b border-border p-6">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <ShieldAlert className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <SheetTitle className="text-lg">Fraud Detection Policies</SheetTitle>
                  <SheetDescription>
                    {isAdmin
                      ? "Configure rule thresholds, actions, and activation status."
                      : "Read-only view of active fraud detection rules."}
                  </SheetDescription>
                </div>
              </div>
              {isAdmin ? (
                <Button size="sm" onClick={() => setCreating(true)}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  New policy
                </Button>
              ) : (
                <Badge variant="outline" className="gap-1.5">
                  <Lock className="h-3 w-3" />
                  Read only
                </Badge>
              )}
            </div>
          </SheetHeader>
 
          <div className="space-y-3 p-6">
            {loading && (
              <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm">Loading policies…</span>
              </div>
            )}
 
            {!loading && error && (
              <div className="flex flex-col items-center gap-3 py-12 text-center">
                <AlertCircle className="h-8 w-8 text-destructive" />
                <p className="text-sm text-muted-foreground">{error}</p>
                <Button size="sm" variant="outline" onClick={fetchPolicies}>Retry</Button>
              </div>
            )}
 
            {!loading && !error && policies.map((p) => (
              <div
                key={p.id}
                className={cn("rounded-lg border border-border p-4 transition-colors", !p.enabled && "opacity-60")}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[10px] text-muted-foreground">{p.code}</span>
                      <h4 className="font-semibold">{p.name}</h4>
                      <Badge variant="outline" className={cn("text-[10px] uppercase", SEVERITY_STYLES[p.severity] ?? "")}>
                        {p.severity}
                      </Badge>
                      <Badge variant="outline" className={cn("font-mono text-[10px]", ACTION_STYLES[p.action] ?? "")}>
                        {p.action}
                      </Badge>
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">{p.category}</div>
                  </div>
 
                  <div className="flex flex-col items-end gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        {p.enabled ? "Active" : "Disabled"}
                      </span>
                      <Switch
                        checked={p.enabled}
                        disabled={!isAdmin}
                        onCheckedChange={(v) => togglePolicy(p, v)}
                      />
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => setViewing(p)}>
                        <Eye className="mr-1 h-3 w-3" />View
                      </Button>
                      {isAdmin && (
                        <>
                          <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => setEditing(p)}>
                            <Pencil className="mr-1 h-3 w-3" />Edit
                          </Button>
                          <Button
                            size="sm" variant="outline"
                            className="h-7 px-2 text-[11px] text-destructive hover:bg-destructive/10"
                            onClick={() => deletePolicy(p.id)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-2 text-[10px] text-muted-foreground">
                  <span>Last updated {new Date(p.updatedAt).toLocaleString()}</span>
                  <span>by {p.updatedBy}</span>
                </div>
              </div>
            ))}
 
            {!loading && !error && policies.length === 0 && (
              <div className="py-12 text-center text-sm text-muted-foreground">No policies found.</div>
            )}
          </div>
        </SheetContent>
      </Sheet>
 
      {/* Edit dialog */}
      <PolicyEditDialog
        policy={editing}
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        onSave={(patch) => editing && updatePolicy(editing.id, patch)}
      />
 
      {/* Create dialog */}
      <PolicyEditDialog
        policy={null}
        open={creating}
        onOpenChange={setCreating}
        onSave={addPolicy}
        isCreate
      />
 
      {/* View dialog */}
      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-w-lg">
          {viewing && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <ShieldAlert className="h-5 w-5 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-mono text-[10px] text-muted-foreground">{viewing.code}</div>
                    <DialogTitle className="text-base">{viewing.name}</DialogTitle>
                    <DialogDescription className="text-xs">{viewing.category}</DialogDescription>
                  </div>
                </div>
              </DialogHeader>
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className={cn("text-[10px] uppercase", SEVERITY_STYLES[viewing.severity] ?? "")}>
                    {viewing.severity}
                  </Badge>
                  <Badge variant="outline" className={cn("font-mono text-[10px]", ACTION_STYLES[viewing.action] ?? "")}>
                    {viewing.action}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    {viewing.enabled ? "Active" : "Disabled"}
                  </Badge>
                </div>
                <div>
                  <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Description</div>
                  <p className="rounded-md border border-border bg-muted/30 p-3 text-sm leading-relaxed">{viewing.description}</p>
                </div>
                {viewing.threshold && (
                  <div>
                    <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Trigger condition</div>
                    <div className="flex items-center gap-2 rounded-md bg-muted/40 px-3 py-2 text-sm">
                      <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="font-mono text-xs">{viewing.threshold}</span>
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between border-t border-border pt-3 text-[11px] text-muted-foreground">
                  <span>Last updated {new Date(viewing.updatedAt).toLocaleString()}</span>
                  <span>by {viewing.updatedBy}</span>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
 
// ─── Edit / Create Dialog ─────────────────────────────────────────────────────
 
function PolicyEditDialog({
  policy, open, onOpenChange, onSave, isCreate,
}: {
  policy: Policy | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSave: (patch: Partial<Policy>) => void;
  isCreate?: boolean;
}) {
  const [form, setForm] = useState<Partial<Policy>>({});
  const [saving, setSaving] = useState(false);
 
  const initialized = useState({ id: "" })[0];
  if (open && initialized.id !== (policy?.id ?? "__new__")) {
    initialized.id = policy?.id ?? "__new__";
    setForm(
      policy ?? {
        name: "",
        category: "Transaction Monitoring",
        description: "",
        threshold: "",
        action: "MFA",
        severity: "medium",
        enabled: true,
      }
    );
  }
 
  const handleSave = async () => {
    // ✅ Only name is required — code is auto-generated by the API on creation
    if (!form.name?.trim()) {
      toast.error("Name is required");
      return;
    }
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  };
 
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-137.5">
        <DialogHeader>
          <DialogTitle>{isCreate ? "Create policy" : "Edit policy"}</DialogTitle>
          <DialogDescription>
            Define the rule's trigger condition and the automated action.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="flex gap-3">
            <div>
              <label className="mb-1 block text-[11px] uppercase text-muted-foreground">Name</label>
              <Input
                className="w-61.25"
                value={form.name ?? ""}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. High-Velocity Transaction Rule"
              />
            </div>
            <div className="w-60">
              <label className="mb-1 block text-[11px] uppercase text-muted-foreground">Severity</label>
              <Select
                value={form.severity}
                onValueChange={(v) => setForm({ ...form, severity: v as PolicySeverity })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
 
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-[11px] uppercase text-muted-foreground">Category</label>
              <Select
                value={form.category}
                onValueChange={(v) => setForm({ ...form, category: v as PolicyCategory })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Transaction Monitoring">Transaction Monitoring</SelectItem>
                  <SelectItem value="Authentication">Authentication</SelectItem>
                  <SelectItem value="Account Takeover">Account Takeover</SelectItem>
                  <SelectItem value="AML / Sanctions">AML / Sanctions</SelectItem>
                  <SelectItem value="Card Fraud">Card Fraud</SelectItem>
                  <SelectItem value="Device & Channel">Device & Channel</SelectItem>
                  <SelectItem value="Account Protection">Account Protection</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] uppercase text-muted-foreground">Action</label>
              <Select
                value={form.action}
                onValueChange={(v) => setForm({ ...form, action: v as PolicyAction })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALLOW">ALLOW</SelectItem>
                  <SelectItem value="MFA">MFA</SelectItem>
                  <SelectItem value="BLOCK">BLOCK</SelectItem>
                  <SelectItem value="FREEZE">FREEZE</SelectItem>
                  <SelectItem value="REVIEW">REVIEW</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
 
          <div>
            <label className="mb-1 block text-[11px] uppercase text-muted-foreground">Description</label>
            <Textarea
              rows={3}
              value={form.description ?? ""}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Describe what this policy detects and why it triggers…"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            {isCreate ? "Create" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
 