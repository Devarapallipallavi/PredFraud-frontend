import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth, type Role } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { ShieldAlert, ShieldCheck, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const API_BASE = "https://predfraud-webapp-bxh8b2eudjgwevbb.eastus-01.azurewebsites.net";

export const Route = createFileRoute("/signup")({
  component: SignUpPage,
  head: () => ({
    meta: [
      { title: "Sign up — CFTIP Banking Fraud Decision Platform" },
      { name: "description", content: "Create a CFTIP analyst or admin account." },
    ],
  }),
});

interface FormState {
  full_name: string;
  employee_name: string;
  email: string;
  mobile_no: string;
  specialization: string;
  location: string;
  experience: string;
  role: Role;
  password: string;
}

const INITIAL: FormState = {
  full_name: "",
  employee_name: "",
  email: "",
  mobile_no: "",
  specialization: "",
  location: "",
  experience: "",
  role: "analyst",
  password: "",
};

function SignUpPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(INITIAL);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) navigate({ to: "/dashboard" });
  }, [user, navigate]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;

    const required: Array<keyof FormState> = [
      "full_name", "employee_name", "email", "mobile_no", "specialization", "location", "experience", "password"
    ];

    for (const k of required) {
      if (!String(form[k]).trim()) {
        toast.error(`Please fill in ${k.replace("_", " ")}`);
        return;
      }
    }

    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: form.full_name,
          employee_name: form.employee_name,
          email: form.email,
          mobile_no: form.mobile_no,
          specialization: form.specialization,
          location: form.location,
          experience: form.experience,
          password: form.password,
          role: form.role,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || "Registration failed");
      }

      toast.success(`Account created successfully! Emp ID: ${data.emp_id}`);

      // Auto-login with real user data
      login(form.email, form.role, data.emp_id, form.full_name);

      navigate({ to: "/dashboard" });
    } catch (err: any) {
      toast.error(err.message || "Something went wrong");
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
            Join the CFTIP fraud command center.
          </h2>
          <p className="max-w-md text-sm leading-relaxed text-primary-foreground/80">
            Register to investigate alerts, decide on suspected fraud, and collaborate with global fraud teams.
          </p>
        </div>

        <div className="relative text-[11px] text-primary-foreground/60">
          ISO 27001 · PCI DSS · SOC 2 Type II · Internal use only
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex items-center justify-center bg-background px-6 py-12">
        <Card className="w-full max-w-lg border-border/60 p-8 shadow-elevated">
          <form onSubmit={submit} className="space-y-6">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Create your account</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Enter your professional details to register.
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Role</Label>
              <div className="grid grid-cols-2 gap-2">
                <RoleCard
                  active={form.role === "analyst"}
                  onClick={() => update("role", "analyst")}
                  icon={<ShieldCheck className="h-4 w-4" />}
                  title="Analyst"
                  desc="Investigate cases"
                />
                <RoleCard
                  active={form.role === "admin"}
                  onClick={() => update("role", "admin")}
                  icon={<ShieldAlert className="h-4 w-4" />}
                  title="Admin"
                  desc="Full system control"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field id="full_name" label="Full Name" value={form.full_name} onChange={(v) => update("full_name", v)} placeholder="Enter your full_name " />
              <Field id="employee_name" label="Employee Name" value={form.employee_name} onChange={(v) => update("employee_name", v)} placeholder="Enter your employee_name" />
              <Field id="email" type="email" label="Email" value={form.email} onChange={(v) => update("email", v)} placeholder="Enter your Email" />
              <Field id="mobile_no" label="Contact Number" value={form.mobile_no} onChange={(v) => update("mobile_no", v)} placeholder="Enter your Contact Number" />
              <Field id="specialization" label="Specialization" value={form.specialization} onChange={(v) => update("specialization", v)} placeholder="Enter your Specilization" />
              <Field id="location" label="Location" value={form.location} onChange={(v) => update("location", v)} placeholder="Enter your Location" />
              <Field id="experience" label="Experience (years)" value={form.experience} onChange={(v) => update("experience", v)} placeholder="Enter your Experience" />
              <div className="sm:col-span-2">
                <Field id="password" type="password" label="Password" value={form.password} onChange={(v) => update("password", v)} placeholder="••••••••" />
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create account
            </Button>

            <p className="text-center text-xs text-muted-foreground">
              Already have an account?{" "}
              <Link to="/" className="font-medium text-primary hover:underline">
                Sign in
              </Link>
            </p>
          </form>
        </Card>
      </div>
    </div>
  );
}

function Field({
  id, label, value, onChange, placeholder, type = "text",
}: { 
  id: string; 
  label: string; 
  value: string; 
  onChange: (v: string) => void; 
  placeholder?: string; 
  type?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input 
        id={id} 
        type={type} 
        value={value} 
        placeholder={placeholder} 
        onChange={(e) => onChange(e.target.value)} 
      />
    </div>
  );
}

function RoleCard({
  active, onClick, icon, title, desc,
}: { active: boolean; onClick: () => void; icon: React.ReactNode; title: string; desc: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg border p-3 text-left transition-all",
        active ? "border-primary bg-primary/5 shadow-glow" : "border-border bg-card hover:border-primary/40"
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