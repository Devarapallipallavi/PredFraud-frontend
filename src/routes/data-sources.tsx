import { createFileRoute } from "@tanstack/react-router";
import { ProtectedRoute } from "@/components/protected-route";
import { DataSourcesPanel } from "@/components/data-sources-panel";

export const Route = createFileRoute("/data-sources")({
  component: () => (
    <ProtectedRoute>
      <DataSourcesPage />
    </ProtectedRoute>
  ),
});

function DataSourcesPage() {
  return <DataSourcesPanel />;
}