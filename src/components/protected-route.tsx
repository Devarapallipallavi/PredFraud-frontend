import { useAuth } from "@/lib/auth";
import { Navigate } from "@tanstack/react-router";
import { AppShell } from "./app-shell";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Lock } from "lucide-react";

export function ProtectedRoute({
  children,
  allow,
}: {
  children: ReactNode;
  allow?: Array<"analyst" | "admin">;
}) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/" />;
  if (allow && !allow.includes(user.role)) {
    return (
      <AppShell>
        <Card className="mx-auto mt-16 max-w-md p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
            <Lock className="h-5 w-5 text-destructive" />
          </div>
          <h2 className="text-lg font-semibold">Access restricted</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            This area is reserved for Fraud Admins. Switch role from your profile menu to preview.
          </p>
        </Card>
      </AppShell>
    );
  }
  return <AppShell>{children}</AppShell>;
}
