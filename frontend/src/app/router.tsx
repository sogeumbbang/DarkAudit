import { createBrowserRouter, Navigate } from "react-router-dom";

import { AppLayout } from "@/layouts/AppLayout";
import { PublicLayout } from "@/layouts/PublicLayout";

const routeFallback = (
  <div className="flex min-h-screen items-center justify-center bg-background" role="status">
    <span className="text-sm font-semibold text-brand-700">
      DarkAudit 화면을 불러오는 중입니다.
    </span>
  </div>
);

export const router = createBrowserRouter([
  {
    element: <PublicLayout />,
    hydrateFallbackElement: routeFallback,
    children: [
      { path: "/", element: <Navigate to="/app/overview" replace /> },
      {
        path: "/landing",
        lazy: async () => ({
          Component: (await import("@/pages/landing/LandingPage")).LandingPage,
        }),
      },
    ],
  },
  {
    path: "/app",
    element: <AppLayout />,
    hydrateFallbackElement: routeFallback,
    children: [
      { index: true, element: <Navigate to="overview" replace /> },
      {
        path: "overview",
        lazy: async () => ({
          Component: (await import("@/pages/overview/OverviewPage")).OverviewPage,
        }),
      },
      {
        path: "audits",
        lazy: async () => ({
          Component: (await import("@/pages/support/SupportPages")).AuditManagementPage,
        }),
      },
      {
        path: "audits/new",
        lazy: async () => ({
          Component: (await import("@/pages/audit-create/AuditCreatePage")).AuditCreatePage,
        }),
      },
      {
        path: "guidelines",
        lazy: async () => ({
          Component: (await import("@/pages/support/SupportPages")).GuidelinesPage,
        }),
      },
      {
        path: "benchmark",
        lazy: async () => ({
          Component: (await import("@/pages/support/SupportPages")).BenchmarkPage,
        }),
      },
      {
        path: "settings",
        lazy: async () => ({
          Component: (await import("@/pages/support/SupportPages")).SettingsPage,
        }),
      },
    ],
  },
]);
