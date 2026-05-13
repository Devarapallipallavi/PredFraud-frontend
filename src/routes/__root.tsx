import { Outlet, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import appCss from "../styles.css?url";
import { AuthProvider } from "@/lib/auth";
import { ThemeProvider } from "@/lib/theme";
import { Toaster } from "@/components/ui/sonner";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <a
          href="/"
          className="mt-6 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Go home
        </a>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "CFTIP — Banking Fraud Decision Platform" },
      { name: "description", content: "Enterprise banking fraud detection, investigation and decisioning platform with role-based access for analysts and supervisors." },
      { property: "og:title", content: "CFTIP — Banking Fraud Decision Platform" },
      { property: "og:description", content: "Enterprise banking fraud detection, investigation and decisioning platform with role-based access for analysts and supervisors." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "CFTIP — Banking Fraud Decision Platform" },
      { name: "twitter:description", content: "Enterprise banking fraud detection, investigation and decisioning platform with role-based access for analysts and supervisors." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/eb694cf5-ad2a-4ee9-8ab3-ed63afdae431/id-preview-a8f0bf29--0c027269-d45b-4a3b-bbdb-d5c1f98e8b6a.lovable.app-1776680358370.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/eb694cf5-ad2a-4ee9-8ab3-ed63afdae431/id-preview-a8f0bf29--0c027269-d45b-4a3b-bbdb-d5c1f98e8b6a.lovable.app-1776680358370.png" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <Outlet />
        <Toaster richColors position="top-right" />
      </AuthProvider>
    </ThemeProvider>
  );
}
