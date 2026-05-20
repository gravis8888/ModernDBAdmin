import { Activity, ArrowRight, Database, ShieldAlert, UserCog } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { dashboardApi, formatApiError } from "@/lib/api";
import { formatDateTime, formatNumber } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { useRuntimeStore } from "@/stores/runtime-store";

export function DashboardPage() {
  const sqlHistory = useRuntimeStore((state) => state.sqlHistory);
  const dashboardQuery = useQuery({
    queryKey: ["dashboard"],
    queryFn: dashboardApi.get,
  });

  if (dashboardQuery.isError) {
    return (
      <section className="app-panel rounded-[28px] p-5 text-sm text-[var(--danger)]">
        {formatApiError(dashboardQuery.error)}
      </section>
    );
  }

  const summary = dashboardQuery.data?.summary;
  const metrics = [
    {
      label: "登録接続",
      value: formatNumber(summary?.connectionCount),
      icon: Database,
    },
    {
      label: "接続済み",
      value: formatNumber(summary?.activeConnectionCount),
      icon: Activity,
    },
    {
      label: "管理画面ロール",
      value: formatNumber(summary?.appRoleCount),
      icon: ShieldAlert,
    },
    {
      label: "管理画面ユーザー",
      value: formatNumber(summary?.appUserCount),
      icon: UserCog,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-4 md:grid-cols-2">
        {metrics.map((metric) => (
          <section className="app-panel-muted rounded-[28px] p-5" key={metric.label}>
            <div className="flex items-center justify-between">
              <p className="text-sm text-[var(--muted)]">{metric.label}</p>
              <metric.icon className="size-4 text-[var(--accent)]" />
            </div>
            <p className="mt-4 text-xl font-semibold text-[var(--foreground)]">{metric.value}</p>
          </section>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="app-panel rounded-[28px] p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">セッション SQL 履歴</h3>
            <Badge>{sqlHistory.length} entries</Badge>
          </div>
          <div className="mt-4 space-y-3">
            {sqlHistory.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--panel)] p-4 text-sm text-[var(--muted)]">
                まだ履歴はありません。SQL を実行するとここに表示されます。
              </div>
            ) : (
              sqlHistory.map((query) => (
                <pre
                  className="overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4 text-sm text-[var(--foreground)]"
                  key={query}
                >
                  {query}
                </pre>
              ))
            )}
          </div>
        </section>
        <div className="space-y-5">
          <section className="app-panel rounded-[28px] p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold">権限管理の入口</h3>
                <p className="mt-2 text-sm text-[var(--muted)]">
                  MySQL / PostgreSQL
                  の実ユーザー権限は、接続一覧か左の接続ツリーから対象接続を選んで操作します。
                </p>
              </div>
              <Badge tone="outline">Security</Badge>
            </div>
            <div className="mt-4 space-y-3">
              <Link
                className="flex items-center justify-between rounded-2xl border border-[var(--border)] bg-[var(--panel)] px-4 py-4 transition hover:border-[var(--accent)] hover:bg-[var(--panel-strong)]"
                to="/app/connections"
              >
                <div className="flex items-start gap-3">
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel-soft)] p-2 text-[var(--accent)]">
                    <Database className="size-4" />
                  </div>
                  <div>
                    <p className="font-medium text-[var(--foreground)]">接続から DB権限を開く</p>
                    <p className="mt-1 text-sm text-[var(--muted)]">
                      接続一覧、接続ツリー、テーブル画面から対象接続の DBユーザー / role を開く
                    </p>
                  </div>
                </div>
                <ArrowRight className="size-4 text-[var(--muted)]" />
              </Link>
              <Link
                className="flex items-center justify-between rounded-2xl border border-[var(--border)] bg-[var(--panel)] px-4 py-4 transition hover:border-[var(--accent)] hover:bg-[var(--panel-strong)]"
                to="/app/app-users"
              >
                <div>
                  <p className="font-medium text-[var(--foreground)]">管理画面ユーザー</p>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    Modern DB Admin 自体へログインする内部ユーザーを管理する
                  </p>
                </div>
                <ArrowRight className="size-4 text-[var(--muted)]" />
              </Link>
            </div>
          </section>
          <section className="app-panel rounded-[28px] p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">最近の監査ログ</h3>
            </div>
            <div className="mt-4 space-y-3">
              {(dashboardQuery.data?.recentAuditLogs ?? []).length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--panel)] p-4 text-sm text-[var(--muted)]">
                  まだ監査ログはありません。接続テストや権限変更を行うとここに表示されます。
                </div>
              ) : (
                dashboardQuery.data?.recentAuditLogs.map((entry) => (
                  <article
                    className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4"
                    key={entry.id}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium">{entry.action}</p>
                      <Badge tone="muted">{formatDateTime(entry.createdAt)}</Badge>
                    </div>
                    <p className="mt-2 text-sm text-[var(--muted)]">
                      {entry.resourceType}
                      {entry.resourceId ? ` / ${entry.resourceId}` : ""}
                    </p>
                  </article>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
