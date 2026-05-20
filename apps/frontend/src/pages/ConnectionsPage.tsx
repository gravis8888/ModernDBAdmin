import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Database, Plus, PlugZap, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { type ConnectionFormInput, type ConnectionSummary } from "@modern-db-admin/shared";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckboxField, Field, SelectInput, TextInput } from "@/components/ui/field";
import { buildSelectionSearch, useSelection } from "@/hooks/use-selection";
import { connectionsApi, formatApiError } from "@/lib/api";
import { dialectLabel, formatDateTime } from "@/lib/format";

const emptyForm: ConnectionFormInput = {
  name: "",
  dialect: "postgresql",
  host: "127.0.0.1",
  port: 5432,
  username: "",
  password: "",
  defaultDatabase: "",
  useSsl: false,
  readonly: false,
};

export function ConnectionsPage() {
  const queryClient = useQueryClient();
  const { setSelection } = useSelection();
  const [editingConnectionId, setEditingConnectionId] = useState<string | null>(null);
  const [form, setForm] = useState<ConnectionFormInput>(emptyForm);
  const [testedServerInfo, setTestedServerInfo] = useState<{
    version: string;
    currentUser: string;
    database: string | null;
    schema: string | null;
  } | null>(null);

  const connectionsQuery = useQuery({
    queryKey: ["connections"],
    queryFn: connectionsApi.list,
  });

  const saveMutation = useMutation({
    mutationFn: async (input: ConnectionFormInput) =>
      editingConnectionId
        ? connectionsApi.update(editingConnectionId, input)
        : connectionsApi.create(input),
    onSuccess: (response) => {
      toast.success(editingConnectionId ? "接続を更新しました。" : "接続を作成しました。");
      setEditingConnectionId(response.connection.id);
      setSelection(
        {
          connectionId: response.connection.id,
          database: response.connection.database,
          schema: "",
          table: "",
        },
        { replace: true },
      );
      void queryClient.invalidateQueries({ queryKey: ["connections"] });
      void queryClient.invalidateQueries({ queryKey: ["sidebar-tree"] });
    },
    onError: (error) => {
      toast.error(formatApiError(error));
    },
  });

  const testMutation = useMutation({
    mutationFn: (connectionId: string) => connectionsApi.test(connectionId),
    onSuccess: (response) => {
      setTestedServerInfo(response.serverInfo);
      toast.success("接続テストに成功しました。");
      void queryClient.invalidateQueries({ queryKey: ["connections"] });
    },
    onError: (error) => {
      toast.error(formatApiError(error));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (connectionId: string) => connectionsApi.remove(connectionId),
    onSuccess: () => {
      toast.success("接続を削除しました。");
      setEditingConnectionId(null);
      setForm(emptyForm);
      setTestedServerInfo(null);
      void queryClient.invalidateQueries({ queryKey: ["connections"] });
      void queryClient.invalidateQueries({ queryKey: ["sidebar-tree"] });
    },
    onError: (error) => {
      toast.error(formatApiError(error));
    },
  });

  function resetForm() {
    setEditingConnectionId(null);
    setForm(emptyForm);
    setTestedServerInfo(null);
  }

  function handleSelectConnection(connection: ConnectionSummary) {
    setEditingConnectionId(connection.id);
    setTestedServerInfo(null);
    setForm({
      name: connection.name,
      dialect: connection.dialect,
      host: connection.host,
      port: connection.port,
      username: connection.username,
      password: "",
      defaultDatabase: connection.database,
      useSsl: connection.useSsl,
      readonly: connection.readonly,
    });
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void saveMutation.mutateAsync(form);
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
      <section className="app-panel overflow-hidden rounded-3xl">
        <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--panel)] px-4 py-3">
          <div>
            <h3 className="text-lg font-semibold">接続一覧</h3>
            <p className="text-sm text-[var(--muted)]">
              接続の登録、テスト、readonly制御をここで行います。
            </p>
          </div>
          <Button onClick={resetForm}>
            <Plus className="mr-2 size-4" />
            新規接続
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-[var(--panel)] text-[var(--muted)]">
              <tr>
                <th className="px-4 py-3 font-medium">接続名</th>
                <th className="px-4 py-3 font-medium">DB種別</th>
                <th className="px-4 py-3 font-medium">ユーザー</th>
                <th className="px-4 py-3 font-medium">ホスト</th>
                <th className="px-4 py-3 font-medium">最終接続</th>
                <th className="px-4 py-3 font-medium">状態</th>
                <th className="px-4 py-3 font-medium text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {(connectionsQuery.data?.connections ?? []).map((connection) => (
                <tr
                  key={connection.id}
                  className="border-t border-[var(--border)] hover:bg-[var(--panel-strong)]"
                >
                  <td className="px-4 py-4 font-medium">{connection.name}</td>
                  <td className="px-4 py-4">{dialectLabel(connection.dialect)}</td>
                  <td className="px-4 py-4">{connection.username}</td>
                  <td className="px-4 py-4">
                    {connection.host}:{connection.port}
                  </td>
                  <td className="px-4 py-4 text-[var(--muted)]">
                    {formatDateTime(connection.lastConnectedAt)}
                  </td>
                  <td className="px-4 py-4">
                    <Badge tone={connection.readonly ? "outline" : "success"}>
                      {connection.readonly ? "readonly" : "read-write"}
                    </Badge>
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="secondary"
                        onClick={() => {
                          handleSelectConnection(connection);
                          void testMutation.mutateAsync(connection.id);
                        }}
                      >
                        <PlugZap className="mr-2 size-4" />
                        Test
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          handleSelectConnection(connection);
                        }}
                      >
                        Edit
                      </Button>
                      <Link
                        to={`/app/sql${buildSelectionSearch({
                          connectionId: connection.id,
                          database: connection.database,
                        })}`}
                      >
                        <Button variant="ghost">SQL</Button>
                      </Link>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          if (!window.confirm(`接続 ${connection.name} を削除しますか。`)) {
                            return;
                          }
                          void deleteMutation.mutateAsync(connection.id);
                        }}
                      >
                        <Trash2 className="size-4 text-[var(--danger)]" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {connectionsQuery.isLoading ? (
          <div className="px-4 py-5 text-sm text-[var(--muted)]">接続を読み込んでいます...</div>
        ) : null}
      </section>

      <section className="app-panel rounded-3xl p-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">
              {editingConnectionId ? "接続を編集" : "新しい接続を作成"}
            </h3>
            <p className="text-sm text-[var(--muted)]">
              サーバーへ接続するための情報を登録します。
            </p>
          </div>
          {editingConnectionId ? (
            <Button onClick={resetForm} variant="secondary">
              新規に戻す
            </Button>
          ) : null}
        </div>

        <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="接続名">
              <TextInput
                onChange={(event) =>
                  setForm((current) => ({ ...current, name: event.target.value }))
                }
                placeholder="Production PostgreSQL"
                value={form.name}
              />
            </Field>
            <Field label="DB種別">
              <SelectInput
                onChange={(event) => {
                  const nextDialect = event.target.value as ConnectionFormInput["dialect"];
                  setForm((current) => ({
                    ...current,
                    dialect: nextDialect,
                    port:
                      nextDialect === "postgresql"
                        ? 5432
                        : current.port === 5432
                          ? 3306
                          : current.port,
                  }));
                }}
                value={form.dialect}
              >
                <option value="postgresql">PostgreSQL</option>
                <option value="mysql">MySQL</option>
                <option value="mariadb">MariaDB</option>
              </SelectInput>
            </Field>
            <Field label="ホスト">
              <TextInput
                onChange={(event) =>
                  setForm((current) => ({ ...current, host: event.target.value }))
                }
                value={form.host}
              />
            </Field>
            <Field label="ポート">
              <TextInput
                onChange={(event) =>
                  setForm((current) => ({ ...current, port: Number(event.target.value || 0) }))
                }
                type="number"
                value={String(form.port)}
              />
            </Field>
            <Field label="接続ユーザー">
              <TextInput
                onChange={(event) =>
                  setForm((current) => ({ ...current, username: event.target.value }))
                }
                value={form.username}
              />
            </Field>
            <Field
              label="初期 database（任意）"
              hint="空のままでも接続できます。接続後に一覧から選べます。"
            >
              <TextInput
                onChange={(event) =>
                  setForm((current) => ({ ...current, defaultDatabase: event.target.value }))
                }
                value={form.defaultDatabase}
              />
            </Field>
            <div className="md:col-span-2">
              <Field label="パスワード">
                <TextInput
                  onChange={(event) =>
                    setForm((current) => ({ ...current, password: event.target.value }))
                  }
                  placeholder={editingConnectionId ? "再入力すると更新されます" : "接続パスワード"}
                  type="password"
                  value={form.password}
                />
              </Field>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <CheckboxField
              checked={form.useSsl}
              hint="SSL/TLS 接続を有効化します。"
              label="SSL を使用"
              onChange={(event) =>
                setForm((current) => ({ ...current, useSsl: event.target.checked }))
              }
            />
            <CheckboxField
              checked={form.readonly}
              hint="変更系 SQL と行更新を拒否します。"
              label="読み取り専用にする"
              onChange={(event) =>
                setForm((current) => ({ ...current, readonly: event.target.checked }))
              }
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button disabled={saveMutation.isPending} type="submit">
              <Database className="mr-2 size-4" />
              {saveMutation.isPending
                ? "保存中..."
                : editingConnectionId
                  ? "接続を更新"
                  : "接続を作成"}
            </Button>
            {editingConnectionId ? (
              <Button
                disabled={testMutation.isPending}
                onClick={() => {
                  void testMutation.mutateAsync(editingConnectionId);
                }}
                variant="secondary"
              >
                <PlugZap className="mr-2 size-4" />
                {testMutation.isPending ? "テスト中..." : "この接続をテスト"}
              </Button>
            ) : null}
          </div>
        </form>

        {testedServerInfo ? (
          <div className="mt-6 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4">
            <div className="flex items-center justify-between">
              <p className="font-medium">接続テスト結果</p>
              <Badge tone="success">OK</Badge>
            </div>
            <dl className="mt-3 grid gap-2 text-sm text-[var(--muted)]">
              <div className="flex justify-between gap-3">
                <dt>現在ユーザー</dt>
                <dd>{testedServerInfo.currentUser}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>database</dt>
                <dd>{testedServerInfo.database ?? "-"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>schema</dt>
                <dd>{testedServerInfo.schema ?? "-"}</dd>
              </div>
              <div className="space-y-1">
                <dt>version</dt>
                <dd className="rounded-xl bg-[var(--panel-strong)] px-3 py-2 text-xs text-[var(--foreground)]">
                  {testedServerInfo.version}
                </dd>
              </div>
            </dl>
          </div>
        ) : null}
      </section>
    </div>
  );
}
