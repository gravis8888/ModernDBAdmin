import { Suspense, lazy, useEffect, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { AppShell } from "@/components/layout/app-shell";
import { LoginPage } from "@/pages/LoginPage";
import { SetupPage } from "@/pages/SetupPage";
import { useAuth } from "@/providers/auth-context";
import { resolveTheme, useThemeStore } from "@/stores/theme-store";

const DashboardPage = lazy(() =>
  import("@/pages/DashboardPage").then((module) => ({ default: module.DashboardPage })),
);
const ConnectionsPage = lazy(() =>
  import("@/pages/ConnectionsPage").then((module) => ({ default: module.ConnectionsPage })),
);
const WorkbenchPage = lazy(() =>
  import("@/pages/WorkbenchPage").then((module) => ({ default: module.WorkbenchPage })),
);
const TablePage = lazy(() =>
  import("@/pages/TablePage").then((module) => ({ default: module.TablePage })),
);
const SqlEditorPage = lazy(() =>
  import("@/pages/SqlEditorPage").then((module) => ({ default: module.SqlEditorPage })),
);
const DbUsersPage = lazy(() =>
  import("@/pages/DbUsersPage").then((module) => ({ default: module.DbUsersPage })),
);
const AppUsersPage = lazy(() =>
  import("@/pages/AppUsersPage").then((module) => ({ default: module.AppUsersPage })),
);

function FullscreenMessage({
  message,
  actionLabel,
  onAction,
}: {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="app-shell-bg flex min-h-screen items-center justify-center px-4">
      <div className="app-panel rounded-3xl px-6 py-5 text-center text-sm text-[var(--muted)]">
        <p>{message}</p>
        {actionLabel && onAction ? (
          <div className="mt-4">
            <Button onClick={onAction} variant="secondary">
              {actionLabel}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function LoginRoute() {
  const auth = useAuth();

  if (!auth.isReady) {
    return <FullscreenMessage message="セッション状態を確認しています..." />;
  }
  if (auth.setupCompleted === null) {
    return (
      <FullscreenMessage
        actionLabel="再試行"
        message={
          auth.statusError ??
          "初回セットアップ状態を確認できませんでした。バックエンドの状態を確認してください。"
        }
        onAction={() => {
          void auth.refresh();
        }}
      />
    );
  }
  if (auth.setupCompleted === false) {
    return <Navigate replace to="/setup" />;
  }
  if (auth.user) {
    return <Navigate replace to="/app/dashboard" />;
  }
  return <LoginPage />;
}

function SetupRoute() {
  const auth = useAuth();

  if (!auth.isReady) {
    return <FullscreenMessage message="初回セットアップ状態を確認しています..." />;
  }
  if (auth.setupCompleted === null) {
    return (
      <FullscreenMessage
        actionLabel="再試行"
        message={
          auth.statusError ??
          "初回セットアップ状態を確認できませんでした。バックエンドの状態を確認してください。"
        }
        onAction={() => {
          void auth.refresh();
        }}
      />
    );
  }
  if (auth.setupCompleted && auth.user) {
    return <Navigate replace to="/app/dashboard" />;
  }
  if (auth.setupCompleted) {
    return <Navigate replace to="/login" />;
  }
  return <SetupPage />;
}

function ProtectedAppRoute() {
  const auth = useAuth();

  if (!auth.isReady) {
    return <FullscreenMessage message="認証を確認しています..." />;
  }
  if (auth.setupCompleted === null) {
    return (
      <FullscreenMessage
        actionLabel="再試行"
        message={
          auth.statusError ??
          "初回セットアップ状態を確認できませんでした。バックエンドの状態を確認してください。"
        }
        onAction={() => {
          void auth.refresh();
        }}
      />
    );
  }
  if (auth.setupCompleted === false) {
    return <Navigate replace to="/setup" />;
  }
  if (!auth.user) {
    return <Navigate replace to="/login" />;
  }
  return <AppShell />;
}

function LazyRoute({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<FullscreenMessage message="画面を読み込んでいます..." />}>
      {children}
    </Suspense>
  );
}

export default function App() {
  const mode = useThemeStore((state) => state.mode);

  useEffect(() => {
    const theme = resolveTheme(mode);
    document.documentElement.dataset.theme = theme;
  }, [mode]);

  return (
    <Routes>
      <Route element={<LoginRoute />} path="/login" />
      <Route element={<SetupRoute />} path="/setup" />
      <Route element={<ProtectedAppRoute />} path="/app">
        <Route element={<Navigate replace to="/app/dashboard" />} index />
        <Route
          element={
            <LazyRoute>
              <DashboardPage />
            </LazyRoute>
          }
          path="dashboard"
        />
        <Route
          element={
            <LazyRoute>
              <ConnectionsPage />
            </LazyRoute>
          }
          path="connections"
        />
        <Route
          element={
            <LazyRoute>
              <WorkbenchPage />
            </LazyRoute>
          }
          path="workbench"
        />
        <Route
          element={
            <LazyRoute>
              <TablePage />
            </LazyRoute>
          }
          path="table"
        />
        <Route
          element={
            <LazyRoute>
              <SqlEditorPage />
            </LazyRoute>
          }
          path="sql"
        />
        <Route
          element={
            <LazyRoute>
              <DbUsersPage />
            </LazyRoute>
          }
          path="db-users"
        />
        <Route
          element={
            <LazyRoute>
              <AppUsersPage />
            </LazyRoute>
          }
          path="app-users"
        />
      </Route>
      <Route element={<Navigate replace to="/app/dashboard" />} path="*" />
    </Routes>
  );
}
