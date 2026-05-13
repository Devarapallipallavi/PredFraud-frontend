import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Activity,
  Briefcase,
  Database,
  Network,
  Workflow,
  Sun,
  Moon,
  LogOut,
  ShieldAlert,
  ChevronsLeftRight,
} from "lucide-react";
import { useState, useEffect } from "react";
import { ChatbotWidget } from "@/components/chatbot-widget";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type NavItem = {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: Array<"analyst" | "admin">;
};

const NAV: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["analyst", "admin"] },
  { to: "/live-events", label: "Live Events", icon: Activity, roles: ["analyst", "admin"] },
  { to: "/cases", label: "Fraud Cases", icon: Briefcase, roles: ["analyst", "admin"] },
  { to: "/data-sources", label: "Data Sources", icon: Database, roles: ["analyst", "admin"] },
  { to: "/fraud-network", label: "Fraud Network", icon: Network, roles: ["admin"] },
  // { to: "/network-analysis", label: "Network Analysis", icon: Workflow, roles: ["admin"] },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [empId, setEmpId] = useState<string>("");

  // Load emp_id from localStorage
  useEffect(() => {
    const stored = localStorage.getItem("emp_id");
    if (stored) setEmpId(stored);
  }, []);

  if (!user) return <>{children}</>;

  const visible = NAV.filter((n) => n.roles.includes(user.role));
  const roleLabel = user.role === "admin" ? "Administrator" : "Analyst";

  // Use full_name from login response (as requested)
  const displayName = user.full_name || user.employee_name || user.email.split("@")[0];

  // Generate avatar initials from full name
  const getInitials = (str: string): string => {
    if (!str) return "U";
    return str
      .trim()
      .split(/\s+/)
      .map((word) => word[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const avatarInitials = getInitials(displayName);

  return (
    <div className="flex min-h-screen w-full bg-background text-foreground">
      {/* Sidebar */}
      <aside
        className={cn(
          "sticky top-0 flex h-screen flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200",
          collapsed ? "w-18" : "w-62"
        )}
      >
        <div className="flex h-16 items-center gap-2 border-b border-sidebar-border px-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-gradient-primary shadow-glow">
            <ShieldAlert className="h-5 w-5 text-primary-foreground" />
          </div>
          {!collapsed && (
            <div className="leading-tight">
              <div className="text-sm font-semibold tracking-tight text-sidebar-foreground">CFTIP</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Fraud Decision Platform</div>
            </div>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3 scrollbar-thin">
          <div className={cn("px-2 pb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground", collapsed && "hidden")}>
            Workspace
          </div>
          <ul className="space-y-0.5">
            {visible.map((item) => {
              const active = location.pathname === item.to || 
                           (item.to !== "/dashboard" && location.pathname.startsWith(item.to));
              const Icon = item.icon;
              return (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    className={cn(
                      "group flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-elevated"
                        : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                    )}
                  >
                    <Icon className={cn("h-4 w-4 shrink-0", active && "text-primary")} />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                    {!collapsed && active && (
                      <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="border-t border-sidebar-border p-2">
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-xs text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
          >
            <ChevronsLeftRight className="h-4 w-4" />
            {!collapsed && <span>Collapse Sidebar</span>}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar */}
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/80 px-6 backdrop-blur-md">
          <div className="flex flex-col">
            <h1 className="text-base font-semibold leading-tight text-foreground">
              {visible.find((n) => location.pathname.startsWith(n.to))?.label ?? "Overview"}
            </h1>
            <p className="text-xs text-muted-foreground">
              {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
            </p>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <span className="hidden items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1.5 text-xs text-muted-foreground md:flex">
              <span className="h-2 w-2 rounded-full bg-success pulse-dot" />
              Decision engine online
            </span>

            <Button variant="ghost" size="icon" onClick={toggle}>
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-3 rounded-full border border-border bg-card/60 py-1 pl-1 pr-4 text-left transition-all hover:bg-card">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-primary text-xs font-semibold text-primary-foreground">
                    {avatarInitials}
                  </span>
                  <span className="hidden flex-col leading-tight sm:flex">
                    <span className="text-sm font-medium text-foreground">{displayName}</span>
                    <span className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                      {roleLabel}
                      {empId && <span className="font-mono">• {empId}</span>}
                    </span>
                  </span>
                </button>
              </DropdownMenuTrigger>

              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel>
                  <div className="flex flex-col gap-1">
                   
                    <span className="text-xs text-muted-foreground">{user.email}</span>
                    <div className="flex items-center gap-2 mt-1">
                    
                      <span className="text-xs font-mono text-muted-foreground">
                        {empId || user.emp_id}
                      </span>
                    </div>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => { logout(); navigate({ to: "/" }); }}>
                  <LogOut className="mr-2 h-4 w-4" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="min-w-0 flex-1 px-6 py-6">{children}</main>
      </div>
      <ChatbotWidget />
    </div>
  );
}