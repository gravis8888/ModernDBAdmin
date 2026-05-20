import { useState } from "react";
import Editor from "@monaco-editor/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Play } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckboxField, Field, SelectInput } from "@/components/ui/field";
import { useSelection } from "@/hooks/use-selection";
import { connectionsApi, formatApiError, metadataApi, queryApi } from "@/lib/api";
import { dialectLabel, stringifyCellValue } from "@/lib/format";
import { resolveTheme, useThemeStore } from "@/stores/theme-store";
import { useRuntimeStore } from "@/stores/runtime-store";

const starterSql = `SELECT *
FROM public.users
WHERE status = 'active'
ORDER BY updated_at DESC
LIMIT 50;`;

export function SqlEditorPage() {
  const { selection, setSelection } = useSelection();
  const sqlHistory = useRuntimeStore((state) => state.sqlHistory);
  const pushSqlHistory = useRuntimeStore((state) => state.pushSqlHistory);
  const setLastQuery = useRuntimeStore((state) => state.setLastQuery);
  const [sql, setSql] = useState(starterSql);
  const [confirmDangerous, setConfirmDangerous] = useState(false);
  const currentTheme = resolveTheme(useThemeStore((state) => state.mode));

  const connectionsQuery = useQuery({
    queryKey: ["connections"],
    queryFn: connectionsApi.list,
  });
  const connections = connectionsQuery.data?.connections ?? [];
  const activeConnection =
    connections.find((connection) => connection.id === selection.connectionId) ?? connections[0];

  const serverInfoQuery = useQuery({
    queryKey: ["server-info", activeConnection?.id],
    queryFn: () => metadataApi.serverInfo(activeConnection!.id),
    enabled: Boolean(activeConnection?.id),
  });

  const executeMutation = useMutation({
    mutationFn: () =>
      queryApi.execute(activeConnection!.id, {
        sql,
        confirmDangerous,
      }),
    onSuccess: (response) => {
      pushSqlHistory(sql);
      const firstResult = response.result.statements.find((statement) => statement.result)?.result;
      setLastQuery({
        rowCount: firstResult?.rowCount,
        executionTimeMs: firstResult?.executionTimeMs,
        statementTypes: response.analysis.statementTypes,
        updatedAt: new Date().toISOString(),
      });
      toast.success("SQL を実行しました。");
    },
    onError: (error) => {
      toast.error(formatApiError(error));
    },
  });

  return (
    <div className="grid gap-5 xl:grid-cols-[1.3fr_0.7fr]">
      <section className="app-panel overflow-hidden rounded-[28px]">
        <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--panel)] px-4 py-3">
          <div>
            <h3 className="text-lg font-semibold">SQL Editor</h3>
            <p className="text-sm text-[var(--muted)]">
              {activeConnection?.name ?? "No Connection"} /{" "}
              {selection.database ?? activeConnection?.database ?? "-"} /{" "}
              {selection.schema ?? serverInfoQuery.data?.serverInfo.schema ?? "-"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone="warning">更新系は確認あり</Badge>
            <Button
              disabled={executeMutation.isPending || !activeConnection}
              onClick={() => {
                void executeMutation.mutateAsync();
              }}
              variant="secondary"
            >
              <Play className="mr-2 size-4" />
              {executeMutation.isPending ? "Running..." : "Run SQL"}
            </Button>
          </div>
        </div>
        <div className="grid gap-3 border-b border-[var(--border)] bg-[var(--panel)] px-4 py-3 lg:grid-cols-[0.55fr_0.45fr]">
          <Field label="接続">
            <SelectInput
              onChange={(event) =>
                setSelection(
                  {
                    connectionId: event.target.value,
                    database:
                      connections.find((connection) => connection.id === event.target.value)
                        ?.database ?? "",
                    schema: "",
                    table: "",
                  },
                  { replace: true },
                )
              }
              value={activeConnection?.id ?? ""}
            >
              {connections.map((connection) => (
                <option key={connection.id} value={connection.id}>
                  {connection.name} ({dialectLabel(connection.dialect)})
                </option>
              ))}
            </SelectInput>
          </Field>
          <CheckboxField
            checked={confirmDangerous}
            hint="DROP / DELETE / GRANT などを実行するときに使います。"
            label="危険な SQL を確認済み"
            onChange={(event) => setConfirmDangerous(event.target.checked)}
          />
        </div>
        <Editor
          defaultLanguage="sql"
          height="420px"
          onChange={(value) => setSql(value ?? "")}
          options={{
            minimap: { enabled: false },
            fontSize: 14,
            lineNumbersMinChars: 3,
            scrollBeyondLastLine: false,
          }}
          theme={currentTheme === "dark" ? "vs-dark" : "vs"}
          value={sql}
        />
        <div className="grid gap-px border-t border-[var(--border)] bg-[var(--border)] lg:grid-cols-3">
          <div className="bg-[var(--panel)] p-4">
            <h4 className="text-sm font-semibold">Results</h4>
            {executeMutation.data?.result.statements.some((statement) => statement.result) ? (
              <div className="mt-3 space-y-3">
                {executeMutation.data.result.statements.map((statement, index) => (
                  <article key={`${statement.statementType}-${index}`}>
                    <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
                      {statement.statementType}
                    </p>
                    {statement.result ? (
                      <div className="mt-2 overflow-x-auto rounded-xl border border-[var(--border)]">
                        <table className="min-w-full text-left text-xs">
                          <thead className="bg-[var(--panel-strong)] text-[var(--muted)]">
                            <tr>
                              {statement.result.columns.map((column) => (
                                <th className="px-3 py-2 font-medium" key={column.name}>
                                  {column.name}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {statement.result.rows.slice(0, 10).map((row, rowIndex) => (
                              <tr
                                className="border-t border-[var(--border)]"
                                key={`row-${rowIndex}`}
                              >
                                {statement.result?.columns.map((column) => (
                                  <td className="px-3 py-2 align-top" key={column.name}>
                                    {stringifyCellValue(row[column.name])}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="mt-2 text-sm text-[var(--muted)]">
                        {statement.message ?? "No rows"}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm text-[var(--muted)]">
                まだ結果はありません。SQL を実行するとここに表示されます。
              </p>
            )}
          </div>
          <div className="bg-[var(--panel)] p-4">
            <h4 className="text-sm font-semibold">Messages</h4>
            {executeMutation.data ? (
              <div className="mt-2 space-y-2 text-sm text-[var(--muted)]">
                <p>statements: {executeMutation.data.analysis.statementTypes.join(", ")}</p>
                <p>required permission: {executeMutation.data.analysis.requiredPermission}</p>
                <p>dangerous: {executeMutation.data.analysis.dangerous ? "yes" : "no"}</p>
              </div>
            ) : (
              <p className="mt-2 text-sm text-[var(--muted)]">未実行です。</p>
            )}
          </div>
          <div className="bg-[var(--panel)] p-4">
            <h4 className="text-sm font-semibold">History</h4>
            <p className="mt-2 text-sm text-[var(--muted)]">
              この画面で実行した SQL: {sqlHistory.length} 件
            </p>
          </div>
        </div>
      </section>
      <section className="app-panel rounded-[28px] p-5">
        <div className="flex items-center gap-2 text-[var(--warning)]">
          <AlertTriangle className="size-4" />
          <h3 className="text-lg font-semibold text-[var(--foreground)]">安全実行ポリシー</h3>
        </div>
        <ul className="mt-4 space-y-3 text-sm text-[var(--muted)]">
          <li>DROP / TRUNCATE / DELETE / GRANT / REVOKE は確認必須</li>
          <li>readonly 接続では変更系を拒否</li>
          <li>実行前に connection / database / schema を常時表示</li>
        </ul>
        <div className="mt-6 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4">
          <h4 className="text-sm font-semibold">接続コンテキスト</h4>
          <div className="mt-3 space-y-2 text-sm text-[var(--muted)]">
            <p>dialect: {activeConnection ? dialectLabel(activeConnection.dialect) : "-"}</p>
            <p>readonly: {activeConnection?.readonly ? "yes" : "no"}</p>
            <p>schema: {serverInfoQuery.data?.serverInfo.schema ?? "-"}</p>
          </div>
        </div>
        <div className="mt-6 space-y-2">
          {sqlHistory.map((query) => (
            <pre
              className="overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-3 text-xs"
              key={query}
            >
              {query}
            </pre>
          ))}
          {sqlHistory.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--panel)] p-3 text-xs text-[var(--muted)]">
              まだ履歴がありません。
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
