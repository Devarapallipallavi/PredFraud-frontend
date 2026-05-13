import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth, type Role } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { ShieldAlert, ShieldCheck, Lock, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const API_BASE = "https://predfraud-webapp-bxh8b2eudjgwevbb.eastus-01.azurewebsites.net";

export const Route = createFileRoute("/")({
  component: LoginPage,
  head: () => ({
    meta: [
      { title: "Sign in — CFTIP Banking Fraud Decision Platform" },
      { name: "description", content: "Secure sign-in to CFTIP." },
    ],
  }),
});

function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [role, setRole] = useState<Role>("analyst");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) navigate({ to: "/dashboard" });
  }, [user, navigate]);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (loading) return;

    if (!email.trim() || !password.trim()) {
      toast.error("Enter your email and password to continue");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier: email.trim(),
          password: password,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || "Login failed");
      }

      // ✅ Updated login call with full_name
      login(
        email, 
        data.role || role, 
        data.emp_id, 
        data.full_name, 
        data.employee_name
      );

      toast.success(`Welcome, ${data.full_name || (data.role === "admin" ? "Admin" : "Analyst")}!`);
      navigate({ to: "/dashboard" });
    } catch (err: any) {
      toast.error(err.message || "Invalid credentials");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative grid min-h-screen w-full grid-cols-1 lg:grid-cols-2">
      {/* Left brand panel */}
      <div className="relative hidden overflow-hidden bg-gradient-primary lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="absolute inset-0 grid-bg opacity-20" />
        <div className="relative flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-background/10 backdrop-blur">
            <ShieldAlert className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <div className="text-sm font-semibold tracking-tight text-primary-foreground">CFTIP</div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-primary-foreground/70">
              Fraud Decision Platform
            </div>
          </div>
        </div>

        <div className="relative space-y-6">
          <h2 className="max-w-md text-3xl font-semibold leading-tight tracking-tight text-primary-foreground">
            Investigate, decide and act on suspected fraud — in real time.
          </h2>
          <p className="max-w-md text-sm leading-relaxed text-primary-foreground/80">
            CFTIP gives analysts a focused investigation workspace and admins complete oversight of every alert, case and decision across the bank.
          </p>
          <div className="grid max-w-md grid-cols-3 gap-3">
            {[
              ["1.2M", "Events / day"],
              ["98.4%", "Decision SLA"],
              ["<60ms", "Avg. score time"],
            ].map(([v, l]) => (
              <div key={l} className="rounded-lg border border-primary-foreground/15 bg-background/5 p-3 backdrop-blur">
                <div className="text-lg font-semibold text-primary-foreground">{v}</div>
                <div className="text-[10px] uppercase tracking-wider text-primary-foreground/70">{l}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative text-[11px] text-primary-foreground/60">
          ISO 27001 · PCI DSS · SOC 2 Type II · Internal use only
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex items-center justify-center bg-background px-6 py-12">
        <Card className="w-full max-w-md border-border/60 p-8 shadow-elevated">
          <form onSubmit={submit} className="space-y-6">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Sign in to your account</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Use your corporate credentials to continue.
              </p>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    className="pl-9"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                  />
                </div>
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Sign in
            </Button>

            <p className="text-center text-xs text-muted-foreground">
              Don't have an account?{" "}
              <Link to="/signup" className="font-medium text-primary hover:underline">
                Sign up
              </Link>
            </p>
          </form>
        </Card>
      </div>
    </div>
  );
}

function RoleCard({
  active, onClick, icon, title, desc,
}: { 
  active: boolean; 
  onClick: () => void; 
  icon: React.ReactNode; 
  title: string; 
  desc: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg border p-3 text-left transition-all",
        active
          ? "border-primary bg-primary/5 shadow-glow"
          : "border-border bg-card hover:border-primary/40"
      )}
    >
      <div className="flex items-center gap-2">
        <span className={cn("flex h-6 w-6 items-center justify-center rounded-md", active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
          {icon}
        </span>
        <span className="text-sm font-medium">{title}</span>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">{desc}</p>
    </button>
  );
}