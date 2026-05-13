import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  Database,
  Cloud,
  CheckCircle2,
  Clock,
  X,
  Plus,
  HardDrive,
  Upload,
  Droplet,
  Plug,
  Loader2,
  AlertCircle,
  Trash2,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

const BASE_URL = "https://predfraud-webapp-bxh8b2eudjgwevbb.eastus-01.azurewebsites.net";

type SourceStatus = "connected" | "syncing" | "disconnected";

interface DataSource {
  id: string;        // stable React key — never changes after first connect
  apiId: string;     // latest API-issued datasource_id — updated on every reconnect
  name: string;
  type: string;
  icon: React.ComponentType<{ className?: string }>;
  status: SourceStatus;
  region: string;
  records: string;
  lastSync: string;
  metadata?: Record<string, unknown>;
  /** Saved so Reconnect can re-POST without asking for credentials again */
  savedPayload?: Record<string, unknown>;
  savedFile?: File;
}

type FieldDef = {
  key: string;
  label: string;
  placeholder: string;
  type?: "text" | "password";
  helpText?: string;
};

type SourceTemplate = {
  type: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
  apiPath: string;
  fields: FieldDef[];
  buildPayload: (name: string, values: Record<string, string>) => Record<string, unknown>;
};

const SOURCE_TEMPLATES: SourceTemplate[] = [
  {
    type: "AWS S3",
    label: "AWS S3",
    icon: Cloud,
    tone: "bg-warning/10 text-warning border-warning/30",
    apiPath: "/datasources/aws-s3",
    fields: [
      { key: "aws_access_key_id",     label: "AWS Access Key ID",     placeholder: "AKIAQXPZDH6LOSOV2WNM" },
      { key: "aws_secret_access_key", label: "AWS Secret Access Key", placeholder: "we1Y6gag9FChWzI2tQ…",  type: "password" },
      { key: "region_name",           label: "Region",                placeholder: "us-east-1" },
      { key: "bucket_name",           label: "Bucket Name",           placeholder: "my-bucket" },
    ],
    buildPayload: (name, v) => ({
      datasource_name:       name,
      aws_access_key_id:     v.aws_access_key_id,
      aws_secret_access_key: v.aws_secret_access_key,
      region_name:           v.region_name,
      bucket_name:           v.bucket_name,
    }),
  },
  {
    type: "Azure Blob",
    label: "Azure Blob Storage",
    icon: HardDrive,
    tone: "bg-info/10 text-info border-info/30",
    apiPath: "/datasources/azure-blob",
    fields: [
      {
        key: "connection_string", label: "Connection String",
        placeholder: "DefaultEndpointsProtocol=https;AccountName=…", type: "password",
        helpText: "Found in Azure Portal → Storage account → Access keys",
      },
    ],
    buildPayload: (name, v) => ({ datasource_name: name, connection_string: v.connection_string }),
  },
  {
    type: "CosmosDB",
    label: "Azure CosmosDB",
    icon: Database,
    tone: "bg-info/10 text-info border-info/30",
    apiPath: "/datasources/azure-cosmosdb",
    fields: [
      {
        key: "connection_string", label: "Connection String",
        placeholder: "AccountEndpoint=https://…;AccountKey=…", type: "password",
        helpText: "Found in Azure Portal → CosmosDB → Keys",
      },
    ],
    buildPayload: (name, v) => ({ datasource_name: name, connection_string: v.connection_string }),
  },
  {
    type: "Azure OneLake",
    label: "Microsoft Fabric OneLake",
    icon: Droplet,
    tone: "bg-primary/10 text-primary border-primary/30",
    apiPath: "/datasources/onelake",
    fields: [
      { key: "tenant_id",     label: "Tenant ID",     placeholder: "0eadb77e-42dc-47f8-bbe3-…" },
      { key: "client_id",     label: "Client ID",     placeholder: "e2eaa87b-ee2a-4680-9982-…" },
      { key: "client_secret", label: "Client Secret", placeholder: "Z_t8Q~qhn~Alz_HSWr…", type: "password" },
      { key: "workspace_id",  label: "Workspace ID",  placeholder: "86810933-d76b-4523-…" },
      { key: "lakehouse_id",  label: "Lakehouse ID",  placeholder: "42844840-eadd-4f18-…" },
    ],
    buildPayload: (name, v) => ({
      datasource_name: name, tenant_id: v.tenant_id, client_id: v.client_id,
      client_secret: v.client_secret, workspace_id: v.workspace_id, lakehouse_id: v.lakehouse_id,
    }),
  },
  {
    type: "Manual Upload",
    label: "Manual File Upload",
    icon: Upload,
    tone: "bg-success/10 text-success border-success/30",
    apiPath: "/datasources/upload-file",
    fields: [],
    buildPayload: (name) => ({ datasource_name: name }),
  },
];

const TEMPLATE_BY_TYPE: Record<string, SourceTemplate> = SOURCE_TEMPLATES.reduce(
  (acc, t) => ({ ...acc, [t.type]: t }), {},
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatRecords(meta: Record<string, unknown> | undefined): string {
  if (!meta) return "—";
  const r = meta.total_records ?? meta.file_count ?? meta.files;
  if (typeof r === "number") return r.toLocaleString();
  if (Array.isArray(r)) return r.length.toString();
  return "—";
}

function formatRegion(meta: Record<string, unknown> | undefined, type: string): string {
  if (!meta) return "—";
  if (type === "AWS S3") return (meta.region as string) ?? "—";
  if (type === "Azure OneLake") return (meta.workspace_name as string) ?? "—";
  return "—";
}

async function callConnectApi(
  template: SourceTemplate,
  payload: Record<string, unknown>,
  file?: File,
): Promise<Response> {
  if (template.type === "Manual Upload") {
    const fd = new FormData();
    fd.append("datasource_name", payload.datasource_name as string);
    if (file) fd.append("file", file);
    return fetch(`${BASE_URL}${template.apiPath}`, {
      method: "POST", headers: { accept: "application/json" }, body: fd,
    });
  }
  return fetch(`${BASE_URL}${template.apiPath}`, {
    method: "POST",
    headers: { accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

// ─── Main component ───────────────────────────────────────────────────────────

export function DataSourcesPanel() {
  const [sources, setSources] = useState<DataSource[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [activeTemplate, setActiveTemplate] = useState<SourceTemplate | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [dsName, setDsName] = useState("");
  const [fileInput, setFileInput] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const connectedCount = sources.filter((s) => s.status === "connected").length;

  const openDraft = (t: SourceTemplate) => {
    setActiveTemplate(t);
    setFormValues({});
    setDsName("");
    setFileInput(null);
    setFormError(null);
    setPickerOpen(false);
  };

  const closeDraft = () => {
    setActiveTemplate(null);
    setFormValues({});
    setFormError(null);
  };

  /**
   * Apply a successful connect API response into state.
   * Key fix: always updates by `datasource_id` — so reconnecting an existing
   * source updates its card in-place instead of appending a duplicate.
   */
  /**
   * originalId = the card's stable ID before the API call.
   * The API always issues a NEW datasource_id on every connect/reconnect,
   * so passing the original lets us find and update the existing card
   * without appending a duplicate.
   */
  const applyConnectResponse = (
    data: Record<string, unknown>,
    template: SourceTemplate,
    savedPayload: Record<string, unknown>,
    savedFile?: File,
    originalId?: string,
  ) => {
    // Use the caller-supplied original ID when available; otherwise the API id (new source)
    const stableId = originalId ?? (data.datasource_id as string);
    const latestApiId = data.datasource_id as string;  // always the freshest ID from the API

    const autoDisconnected: string[] =
      ((data.auto_disconnected as { name: string }[]) ?? []).map((d) => d.name);

    const updatedSource: DataSource = {
      id:          stableId,
      apiId:       latestApiId,  // updated on every connect/reconnect
      name:        (data.datasource as { datasource_name: string })?.datasource_name
                     ?? (savedPayload.datasource_name as string),
      type:        template.type,
      icon:        template.icon,
      status:      "connected",
      region:      formatRegion(data.metadata as Record<string, unknown>, template.type),
      records:     formatRecords(data.metadata as Record<string, unknown>),
      lastSync:    "just now",
      metadata:    data.metadata as Record<string, unknown>,
      savedPayload,
      savedFile,
    };

    setSources((prev) => {
      const exists = prev.some((s) => s.id === stableId);

      const updated = exists
        ? prev.map((s) => (s.id === stableId ? updatedSource : s))   // update in-place
        : [...prev, updatedSource];                                    // truly new — append

      return updated.map((s) =>
        autoDisconnected.includes(s.name) && s.id !== stableId
          ? { ...s, status: "disconnected" as SourceStatus }
          : s,
      );
    });
  };

  /** First-time connect (from the credentials form) */
  const handleConnect = async () => {
    if (!activeTemplate) return;
    if (!dsName.trim()) { setFormError("Data source name is required."); return; }
    for (const f of activeTemplate.fields) {
      if (!formValues[f.key]?.trim()) { setFormError(`"${f.label}" is required.`); return; }
    }
    if (activeTemplate.type === "Manual Upload" && !fileInput) {
      setFormError("Please select a file to upload."); return;
    }

    setLoading(true);
    setFormError(null);
    try {
      const payload = activeTemplate.buildPayload(dsName.trim(), formValues);
      const response = await callConnectApi(activeTemplate, payload, fileInput ?? undefined);
      const data = await response.json();
      if (!response.ok) {
        setFormError(data?.detail?.[0]?.msg ?? data?.message ?? "Connection failed.");
        return;
      }
      applyConnectResponse(data, activeTemplate, payload, fileInput ?? undefined);
      toast.success(`${activeTemplate.label} connected successfully`);
      closeDraft();
    } catch {
      setFormError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  /**
   * Reconnect — reuses saved credentials, no dialog.
   * applyConnectResponse handles updating the existing card in-place.
   */
  const handleReconnect = async (source: DataSource) => {
    const template = TEMPLATE_BY_TYPE[source.type];
    if (!template || !source.savedPayload) return;

    setActionLoadingId(source.id);
    try {
      const response = await callConnectApi(template, source.savedPayload, source.savedFile);
      const data = await response.json();
      if (!response.ok) {
        toast.error(data?.detail?.[0]?.msg ?? data?.message ?? "Reconnect failed.");
        return;
      }
      applyConnectResponse(data, template, source.savedPayload, source.savedFile, source.id);
      toast.success(`${source.name} reconnected successfully`);
    } catch {
      toast.error("Network error during reconnect.");
    } finally {
      setActionLoadingId(null);
    }
  };

  /**
   * Disconnect — calls POST /datasources/{id}/disconnect,
   * then marks the card as disconnected in-place (preserves saved credentials
   * so the user can Reconnect later without re-entering them).
   */
  const handleDisconnect = async (source: DataSource) => {
    setActionLoadingId(source.id);
    try {
      const response = await fetch(`${BASE_URL}/datasources/${source.apiId}/disconnect`, {
        method: "POST",
        headers: { accept: "application/json" },
      });
      const data = await response.json();
      if (!response.ok) {
        toast.error(data?.detail?.[0]?.msg ?? data?.message ?? "Disconnect failed.");
        return;
      }
      // Update status in-place; keep savedPayload/savedFile for future Reconnect
      setSources((prev) =>
        prev.map((s) => (s.id === source.id ? { ...s, status: "disconnected" } : s)),
      );
      toast.success(`"${source.name}" disconnected successfully`);
    } catch {
      toast.error("Network error during disconnect.");
    } finally {
      setActionLoadingId(null);
    }
  };

  /** Delete — calls DELETE /datasources/{id} then removes the card entirely */
  const handleDelete = async (source: DataSource) => {
    setDeleteConfirmId(null);
    setActionLoadingId(source.id);
    try {
      const response = await fetch(`${BASE_URL}/datasources/${source.apiId}`, {
        method: "DELETE",
        headers: { accept: "application/json" },
      });
      const data = await response.json();
      if (!response.ok) {
        toast.error(data?.detail?.[0]?.msg ?? data?.message ?? "Delete failed.");
        return;
      }
      setSources((prev) => prev.filter((s) => s.id !== source.id));
      toast.success(`"${source.name}" deleted successfully`);
    } catch {
      toast.error("Network error during delete.");
    } finally {
      setActionLoadingId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="border-b border-border pb-4">
        <h2 className="text-base font-semibold tracking-tight">Connected data sources</h2>
        <p className="text-xs text-muted-foreground">
          Manage ingestion endpoints powering the fraud platform.
        </p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <SummaryStat label="Connected sources" value={String(connectedCount)} tone="text-success" />
        <SummaryStat
          label="Total records"
          value={
            sources
              .filter((s) => s.status === "connected")
              .reduce((acc, s) => acc + (parseInt(s.records.replace(/,/g, "")) || 0), 0)
              .toLocaleString() || "—"
          }
          tone="text-foreground"
        />
        <SummaryStat
          label="Last sync"
          value={connectedCount > 0 ? "live" : "—"}
          tone={connectedCount > 0 ? "text-success" : "text-muted-foreground"}
        />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card/60 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold tracking-tight">Source connections</h3>
          <p className="text-xs text-muted-foreground">
            Review current endpoints or add a new connector.
          </p>
        </div>
        <Button
          size="sm"
          className="gap-1.5 bg-primary text-primary-foreground shadow-sm hover:bg-primary/90"
          onClick={() => setPickerOpen(true)}
        >
          <Plus className="h-3.5 w-3.5" />
          Add data source
        </Button>
      </div>

      {/* Source cards */}
      {sources.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-border py-16 text-center">
          <Database className="mb-3 h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm font-medium text-muted-foreground">No data sources connected yet</p>
          <p className="mt-1 text-xs text-muted-foreground/60">
            Click "Add data source" to connect your first source.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {sources.map((s) => {
            const Icon = s.icon;
            const tone =
              TEMPLATE_BY_TYPE[s.type]?.tone ?? "bg-primary/10 text-primary border-primary/30";
            const isActing = actionLoadingId === s.id;

            return (
              <Card key={s.id} className="flex flex-col p-4">
                {/* Header */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className={cn("flex h-9 w-9 items-center justify-center rounded-md border", tone)}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{s.name}</div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        {s.type}{s.region && s.region !== "—" ? ` · ${s.region}` : ""}
                      </div>
                    </div>
                  </div>
                  <StatusBadge status={s.status} />
                </div>

                {/* Stats */}
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <Field label="Records" value={s.records} />
                  <Field label="Last sync" value={s.lastSync} />
                </div>

                {/* Action buttons */}
                <div className="mt-3 flex gap-2">
                  {s.status === "connected" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 gap-1.5"
                      disabled={isActing}
                      onClick={() => handleDisconnect(s)}
                    >
                      {isActing ? (
                        <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Disconnecting…</>
                      ) : (
                        <><X className="h-3.5 w-3.5" /> Disconnect</>
                      )}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      className="flex-1 gap-1.5"
                      disabled={isActing}
                      onClick={() => handleReconnect(s)}
                    >
                      {isActing ? (
                        <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Connecting…</>
                      ) : (
                        <><RefreshCw className="h-3.5 w-3.5" /> Reconnect</>
                      )}
                    </Button>
                  )}

                  {/* Delete */}
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    disabled={isActing}
                    onClick={() => setDeleteConfirmId(s.id)}
                  >
                    {isActing && deleteConfirmId !== s.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                    Delete
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* ── Picker dialog ── */}
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Choose a data source</DialogTitle>
            <DialogDescription>Select a connector type to configure.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
            {SOURCE_TEMPLATES.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.type}
                  onClick={() => openDraft(t)}
                  className={cn(
                    "flex flex-col items-center gap-2 rounded-md border p-3 text-xs font-medium transition-colors hover:bg-accent",
                    t.tone,
                  )}
                >
                  <Icon className="h-6 w-6" />
                  <span className="text-center text-foreground">{t.label}</span>
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Credentials dialog (new source only) ── */}
      <Dialog open={!!activeTemplate} onOpenChange={(o) => !o && !loading && closeDraft()}>
        <DialogContent className="max-w-lg">
          {activeTemplate && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <activeTemplate.icon className="h-5 w-5" />
                  New {activeTemplate.label} source
                </DialogTitle>
                <DialogDescription>
                  Provide the credentials below. All fields are required.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3 py-1">
                <FormField
                  id="ds-name"
                  label="Data source name"
                  placeholder='XXXXXX'
                  value={dsName}
                  onChange={setDsName}
                  disabled={loading}
                />
                {activeTemplate.fields.map((f) => (
                  <FormField
                    key={f.key}
                    id={f.key}
                    label={f.label}
                    placeholder='XXXXXX'
                    type={f.type ?? "text"}
                    value={formValues[f.key] ?? ""}
                    onChange={(v) => setFormValues((prev) => ({ ...prev, [f.key]: v }))}
                    helpText={f.helpText}
                    disabled={loading}
                  />
                ))}
                {activeTemplate.type === "Manual Upload" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="file-upload" className="text-xs font-semibold">File</Label>
                    <Input
                      id="file-upload"
                      type="file"
                      disabled={loading}
                      onChange={(e) => setFileInput(e.target.files?.[0] ?? null)}
                      className="cursor-pointer text-xs"
                    />
                    {fileInput && (
                      <p className="text-[10px] text-muted-foreground">
                        {fileInput.name} ({(fileInput.size / 1024).toFixed(1)} KB)
                      </p>
                    )}
                  </div>
                )}
                {formError && (
                  <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{formError}</span>
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button variant="ghost" onClick={closeDraft} disabled={loading}>
                  Cancel
                </Button>
                <Button onClick={handleConnect} disabled={loading} className="gap-1.5">
                  {loading ? (
                    <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Connecting…</>
                  ) : (
                    <><Plug className="h-3.5 w-3.5" /> Connect</>
                  )}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Delete confirmation dialog ── */}
      <Dialog open={!!deleteConfirmId} onOpenChange={(o) => !o && setDeleteConfirmId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-4 w-4" />
              Delete data source
            </DialogTitle>
            <DialogDescription>
              This will permanently remove{" "}
              <span className="font-semibold">
                {sources.find((s) => s.id === deleteConfirmId)?.name}
              </span>{" "}
              from the platform. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteConfirmId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="gap-1.5"
              onClick={() => {
                const src = sources.find((s) => s.id === deleteConfirmId);
                if (src) handleDelete(src);
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function FormField({
  id, label, placeholder, type = "text", value, onChange, helpText, disabled,
}: {
  id: string; label: string; placeholder: string; type?: string;
  value: string; onChange: (v: string) => void; helpText?: string; disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs font-semibold">{label}</Label>
      <Input
        id={id}
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={cn("font-mono text-xs", type === "password" && "tracking-widest")}
        autoComplete="off"
      />
      {helpText && <p className="text-[10px] text-muted-foreground">{helpText}</p>}
    </div>
  );
}

function StatusBadge({ status }: { status: SourceStatus }) {
  const map = {
    connected:    { className: "border-success/30 bg-success/10 text-success",  icon: CheckCircle2 },
    syncing:      { className: "border-warning/30 bg-warning/10 text-warning",  icon: Clock },
    disconnected: { className: "border-border bg-muted text-muted-foreground",  icon: Plug },
  } as const;
  const cfg = map[status];
  const Icon = cfg.icon;
  return (
    <Badge variant="outline" className={cn("shrink-0 gap-1 text-[10px]", cfg.className)}>
      <Icon className={cn("h-3 w-3", status === "syncing" && "animate-pulse")} />
      {status}
    </Badge>
  );
}

function SummaryStat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <Card className="p-6">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("mt-2 text-3xl font-bold", tone)}>{value}</div>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-card/60 px-2.5 py-1.5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-xs font-medium">{value}</div>
    </div>
  );
}

