import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Bookmark,
  Columns3,
  Database,
  Download,
  FileCode2,
  Hammer,
  Layers3,
  Play,
  Plus,
  RefreshCw,
  Search,
  Server,
  Table2,
  Trash2,
  Upload,
} from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import type { AddColumnInput, CreateIndexInput, CreateTableInput } from "@modern-db-admin/shared";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckboxField, Field, SelectInput, TextArea, TextInput } from "@/components/ui/field";
import { buildSelectionSearch, useSelection } from "@/hooks/use-selection";
import {
  connectionsApi,
  formatApiError,
  metadataApi,
  monitorApi,
  queryApi,
  sqlBookmarksApi,
  workbenchApi,
} from "@/lib/api";
import { cn } from "@/lib/cn";
import { dialectLabel, formatDateTime, formatNumber } from "@/lib/format";
import { useRuntimeStore } from "@/stores/runtime-store";

type WorkbenchTab = "structure" | "objects" | "io" | "monitor" | "bookmarks";

const tabs: Array<{ id: WorkbenchTab; label: string; icon: typeof Hammer }> = [
  { id: "structure", label: "Structure", icon: Hammer },
  { id: "objects", label: "Objects", icon: Layers3 },
  { id: "io", label: "Import / Export", icon: Download },
  { id: "monitor", label: "Monitor", icon: Activity },
  { id: "bookmarks", label: "Bookmarks", icon: Bookmark },
];

const objectKinds = [
  { value: "all", label: "all" },
  { value: "view", label: "view" },
  { value: "trigger", label: "trigger" },
  { value: "routine", label: "routine" },
  { value: "event", label: "event" },
  { value: "sequence", label: "sequence" },
] as const;

function defaultCreateColumn(): CreateTableInput["columns"][number] {
  return {
    name: "",
    type: "varchar(255)",
    nullable: false,
    defaultValue: "",
    primaryKey: false,
    autoIncrement: false,
  };
}

function defaultAddColumn(): AddColumnInput {
  return {
    name: "",
    type: "varchar(255)",
    nullable: true,
    defaultValue: "",
    autoIncrement: false,
  };
}

function defaultCreateIndex(): CreateIndexInput {
  return {
    name: "",
    columns: [],
    unique: false,
  };
}

function downloadTextFile(fileName: string, contentType: string, content: string) {
  const blob = new Blob([content], { type: contentType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function readFileAsText(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("ファイルを読み取れませんでした。"));
    reader.readAsText(file);
  });
}

function WorkbenchEmptyState() {
  return (
    <section className="app-panel rounded-[30px] p-6">
      <div className="flex items-start gap-4">
        <div className="rounded-3xl border border-[var(--border)] bg-[var(--panel-soft)] p-3 text-[var(--accent)]">
          <Database className="size-5" />
        </div>
        <div>
          <h2 className="text-xl font-semibold">接続を追加すると Workbench が有効になります</h2>
          <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
            構造編集、トリガーや routine の閲覧、CSV 取込、サーバ監視、SQL ブックマークを 1
            画面で扱えます。まずは接続一覧から対象 DB を登録してください。
          </p>
          <div className="mt-5">
            <Link to="/app/connections">
              <Button variant="secondary">接続一覧を開く</Button>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

export function WorkbenchPage() {
  const queryClient = useQueryClient();
  const { selection, setSelection } = useSelection();
  const pushSqlHistory = useRuntimeStore((state) => state.pushSqlHistory);
  const setLastQuery = useRuntimeStore((state) => state.setLastQuery);

  const [activeTab, setActiveTab] = useState<WorkbenchTab>("structure");
  const [objectFilter, setObjectFilter] = useState<(typeof objectKinds)[number]["value"]>("all");
  const [monitorSearch, setMonitorSearch] = useState("");
  const [sqlImportText, setSqlImportText] = useState("");
  const [confirmDangerousSql, setConfirmDangerousSql] = useState(false);
  const [createTableName, setCreateTableName] = useState("");
  const [createTableColumns, setCreateTableColumns] = useState<CreateTableInput["columns"]>([
    defaultCreateColumn(),
  ]);
  const [renameTableName, setRenameTableName] = useState("");
  const [addColumnForm, setAddColumnForm] = useState<AddColumnInput>(defaultAddColumn());
  const [createIndexForm, setCreateIndexForm] = useState<CreateIndexInput>(defaultCreateIndex());
  const [csvContent, setCsvContent] = useState("");
  const [csvDelimiter, setCsvDelimiter] = useState<"," | ";" | "\t">(",");
  const [truncateBeforeImport, setTruncateBeforeImport] = useState(false);
  const [bookmarkId, setBookmarkId] = useState<string | null>(null);
  const [bookmarkName, setBookmarkName] = useState("");
  const [bookmarkSql, setBookmarkSql] = useState("");

  const connectionsQuery = useQuery({
    queryKey: ["connections"],
    queryFn: connectionsApi.list,
  });
  const connections = connectionsQuery.data?.connections ?? [];
  const activeConnection =
    connections.find((connection) => connection.id === selection.connectionId) ?? connections[0];
  const activeDatabase = selection.database || activeConnection?.database || "";

  const databasesQuery = useQuery({
    queryKey: ["databases", activeConnection?.id],
    queryFn: () => metadataApi.databases(activeConnection!.id),
    enabled: Boolean(activeConnection?.id),
  });
  const databases = databasesQuery.data?.databases ?? [];
  const resolvedDatabase = activeDatabase || databases[0]?.name || "";

  const schemasQuery = useQuery({
    queryKey: ["schemas", activeConnection?.id, resolvedDatabase],
    queryFn: () => metadataApi.schemas(activeConnection!.id, resolvedDatabase),
    enabled: Boolean(
      activeConnection?.id && resolvedDatabase && activeConnection?.dialect === "postgresql",
    ),
  });
  const schemas = schemasQuery.data?.schemas ?? [];
  const resolvedSchema =
    selection.schema ||
    (activeConnection?.dialect === "postgresql" ? schemas[0]?.name || "" : resolvedDatabase);

  const tablesQuery = useQuery({
    queryKey: ["tables", activeConnection?.id, resolvedDatabase, resolvedSchema],
    queryFn: () => metadataApi.tables(activeConnection!.id, resolvedDatabase, resolvedSchema),
    enabled: Boolean(activeConnection?.id && resolvedDatabase && resolvedSchema),
  });
  const tables = tablesQuery.data?.tables ?? [];
  const resolvedTable = selection.table || tables[0]?.name || "";

  const serverInfoQuery = useQuery({
    queryKey: ["server-info", activeConnection?.id],
    queryFn: () => metadataApi.serverInfo(activeConnection!.id),
    enabled: Boolean(activeConnection?.id),
  });

  const tableMetadataQuery = useQuery({
    queryKey: [
      "workbench-table-metadata",
      activeConnection?.id,
      resolvedDatabase,
      resolvedSchema,
      resolvedTable,
    ],
    queryFn: () =>
      metadataApi.tableMetadata(
        activeConnection!.id,
        resolvedDatabase,
        resolvedSchema,
        resolvedTable,
      ),
    enabled: Boolean(activeConnection?.id && resolvedDatabase && resolvedSchema && resolvedTable),
  });
  const objectsQuery = useQuery({
    queryKey: ["objects", activeConnection?.id, resolvedDatabase, resolvedSchema],
    queryFn: () => metadataApi.objects(activeConnection!.id, resolvedDatabase, resolvedSchema),
    enabled: Boolean(activeConnection?.id && resolvedDatabase && resolvedSchema),
  });
  const sessionsQuery = useQuery({
    queryKey: ["monitor-sessions", activeConnection?.id, resolvedDatabase],
    queryFn: () => monitorApi.sessions(activeConnection!.id, resolvedDatabase),
    enabled: Boolean(activeConnection?.id),
  });
  const variablesQuery = useQuery({
    queryKey: ["monitor-variables", activeConnection?.id, resolvedDatabase],
    queryFn: () => monitorApi.variables(activeConnection!.id, resolvedDatabase),
    enabled: Boolean(activeConnection?.id),
  });
  const metricsQuery = useQuery({
    queryKey: ["monitor-metrics", activeConnection?.id, resolvedDatabase],
    queryFn: () => monitorApi.metrics(activeConnection!.id, resolvedDatabase),
    enabled: Boolean(activeConnection?.id),
  });
  const bookmarksQuery = useQuery({
    queryKey: ["sql-bookmarks", activeConnection?.id, resolvedDatabase, resolvedSchema],
    queryFn: () =>
      sqlBookmarksApi.list({
        connectionId: activeConnection?.id,
        database: resolvedDatabase || undefined,
        schema: resolvedSchema || undefined,
      }),
    enabled: Boolean(activeConnection?.id),
  });

  const filteredObjects = useMemo(() => {
    const objects = objectsQuery.data?.objects ?? [];
    if (objectFilter === "all") {
      return objects;
    }
    return objects.filter((object) => object.kind === objectFilter);
  }, [objectFilter, objectsQuery.data?.objects]);

  const filteredSessions = useMemo(() => {
    const rows = sessionsQuery.data?.sessions ?? [];
    const keyword = monitorSearch.trim().toLowerCase();
    if (!keyword) {
      return rows;
    }
    return rows.filter((row) =>
      [row.user, row.database, row.command, row.state, row.query, row.host]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword)),
    );
  }, [monitorSearch, sessionsQuery.data?.sessions]);

  const filteredVariables = useMemo(() => {
    const rows = variablesQuery.data?.variables ?? [];
    const keyword = monitorSearch.trim().toLowerCase();
    if (!keyword) {
      return rows;
    }
    return rows.filter(
      (row) =>
        row.name.toLowerCase().includes(keyword) || row.value.toLowerCase().includes(keyword),
    );
  }, [monitorSearch, variablesQuery.data?.variables]);

  const filteredMetrics = useMemo(() => {
    const rows = metricsQuery.data?.metrics ?? [];
    const keyword = monitorSearch.trim().toLowerCase();
    if (!keyword) {
      return rows;
    }
    return rows.filter(
      (row) =>
        row.name.toLowerCase().includes(keyword) ||
        row.value.toLowerCase().includes(keyword) ||
        row.category.toLowerCase().includes(keyword),
    );
  }, [monitorSearch, metricsQuery.data?.metrics]);

  async function invalidateWorkbenchQueries() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["sidebar-tree"] }),
      queryClient.invalidateQueries({
        queryKey: ["tables", activeConnection?.id, resolvedDatabase, resolvedSchema],
      }),
      queryClient.invalidateQueries({
        queryKey: [
          "columns",
          activeConnection?.id,
          resolvedDatabase,
          resolvedSchema,
          resolvedTable,
        ],
      }),
      queryClient.invalidateQueries({
        queryKey: [
          "indexes",
          activeConnection?.id,
          resolvedDatabase,
          resolvedSchema,
          resolvedTable,
        ],
      }),
      queryClient.invalidateQueries({
        queryKey: ["objects", activeConnection?.id, resolvedDatabase, resolvedSchema],
      }),
      queryClient.invalidateQueries({
        queryKey: [
          "create-sql",
          activeConnection?.id,
          resolvedDatabase,
          resolvedSchema,
          resolvedTable,
        ],
      }),
      queryClient.invalidateQueries({
        queryKey: ["monitor-sessions", activeConnection?.id, resolvedDatabase],
      }),
      queryClient.invalidateQueries({
        queryKey: ["monitor-metrics", activeConnection?.id, resolvedDatabase],
      }),
    ]);
  }

  const createTableMutation = useMutation({
    mutationFn: async () => {
      if (!activeConnection || !resolvedDatabase || !resolvedSchema) {
        throw new Error("接続 / database / schema を選択してください。");
      }
      return workbenchApi.createTable(activeConnection.id, resolvedDatabase, resolvedSchema, {
        name: createTableName,
        columns: createTableColumns,
      });
    },
    onSuccess: async () => {
      toast.success("テーブルを作成しました。");
      await invalidateWorkbenchQueries();
      setSelection(
        {
          connectionId: activeConnection?.id ?? "",
          database: resolvedDatabase,
          schema: resolvedSchema,
          table: createTableName,
        },
        { replace: true },
      );
      setCreateTableName("");
      setCreateTableColumns([defaultCreateColumn()]);
    },
    onError: (error) => toast.error(formatApiError(error)),
  });

  const renameTableMutation = useMutation({
    mutationFn: async () => {
      if (!activeConnection || !resolvedTable) {
        throw new Error("対象テーブルを選択してください。");
      }
      const nextName = renameTableName.trim();
      if (!nextName) {
        throw new Error("変更後のテーブル名を入力してください。");
      }
      return workbenchApi.renameTable(
        activeConnection.id,
        resolvedDatabase,
        resolvedSchema,
        resolvedTable,
        {
          nextName,
        },
      );
    },
    onSuccess: async () => {
      toast.success("テーブル名を変更しました。");
      await invalidateWorkbenchQueries();
      setSelection(
        {
          table: renameTableName.trim(),
        },
        { replace: true },
      );
      setRenameTableName("");
    },
    onError: (error) => toast.error(formatApiError(error)),
  });

  const dropTableMutation = useMutation({
    mutationFn: async () => {
      if (!activeConnection || !resolvedTable) {
        throw new Error("対象テーブルを選択してください。");
      }
      return workbenchApi.dropTable(
        activeConnection.id,
        resolvedDatabase,
        resolvedSchema,
        resolvedTable,
      );
    },
    onSuccess: async () => {
      toast.success("テーブルを削除しました。");
      setSelection({ table: "" }, { replace: true });
      await invalidateWorkbenchQueries();
    },
    onError: (error) => toast.error(formatApiError(error)),
  });

  const addColumnMutation = useMutation({
    mutationFn: async () => {
      if (!activeConnection || !resolvedTable) {
        throw new Error("対象テーブルを選択してください。");
      }
      return workbenchApi.addColumn(
        activeConnection.id,
        resolvedDatabase,
        resolvedSchema,
        resolvedTable,
        addColumnForm,
      );
    },
    onSuccess: async () => {
      toast.success("カラムを追加しました。");
      setAddColumnForm(defaultAddColumn());
      await invalidateWorkbenchQueries();
    },
    onError: (error) => toast.error(formatApiError(error)),
  });

  const createIndexMutation = useMutation({
    mutationFn: async () => {
      if (!activeConnection || !resolvedTable) {
        throw new Error("対象テーブルを選択してください。");
      }
      return workbenchApi.createIndex(
        activeConnection.id,
        resolvedDatabase,
        resolvedSchema,
        resolvedTable,
        createIndexForm,
      );
    },
    onSuccess: async () => {
      toast.success("インデックスを作成しました。");
      setCreateIndexForm(defaultCreateIndex());
      await invalidateWorkbenchQueries();
    },
    onError: (error) => toast.error(formatApiError(error)),
  });

  const importCsvMutation = useMutation({
    mutationFn: async () => {
      if (!activeConnection || !resolvedTable) {
        throw new Error("対象テーブルを選択してください。");
      }
      return workbenchApi.importCsv(
        activeConnection.id,
        resolvedDatabase,
        resolvedSchema,
        resolvedTable,
        {
          csv: csvContent,
          delimiter: csvDelimiter,
          truncateBeforeImport,
        },
      );
    },
    onSuccess: async (response) => {
      toast.success(response.result.message);
      await invalidateWorkbenchQueries();
    },
    onError: (error) => toast.error(formatApiError(error)),
  });

  const executeSqlImportMutation = useMutation({
    mutationFn: async () => {
      if (!activeConnection) {
        throw new Error("接続を選択してください。");
      }
      return queryApi.execute(activeConnection.id, {
        sql: sqlImportText,
        confirmDangerous: confirmDangerousSql,
      });
    },
    onSuccess: async (response) => {
      pushSqlHistory(sqlImportText);
      const firstResult = response.result.statements.find((statement) => statement.result)?.result;
      setLastQuery({
        rowCount: firstResult?.rowCount,
        executionTimeMs: firstResult?.executionTimeMs,
        statementTypes: response.analysis.statementTypes,
        updatedAt: new Date().toISOString(),
      });
      toast.success("SQL import を実行しました。");
      await invalidateWorkbenchQueries();
    },
    onError: (error) => toast.error(formatApiError(error)),
  });

  const saveBookmarkMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: bookmarkName,
        sql: bookmarkSql,
        connectionId: activeConnection?.id,
        database: resolvedDatabase || undefined,
        schema: resolvedSchema || undefined,
      };
      if (bookmarkId) {
        return sqlBookmarksApi.update(bookmarkId, payload);
      }
      return sqlBookmarksApi.create(payload);
    },
    onSuccess: async (response) => {
      toast.success(bookmarkId ? "ブックマークを更新しました。" : "ブックマークを保存しました。");
      const nextId = response.bookmark?.id ?? null;
      setBookmarkId(nextId);
      await queryClient.invalidateQueries({
        queryKey: ["sql-bookmarks", activeConnection?.id, resolvedDatabase, resolvedSchema],
      });
    },
    onError: (error) => toast.error(formatApiError(error)),
  });

  const deleteBookmarkMutation = useMutation({
    mutationFn: (id: string) => sqlBookmarksApi.remove(id),
    onSuccess: async () => {
      toast.success("ブックマークを削除しました。");
      setBookmarkId(null);
      setBookmarkName("");
      setBookmarkSql("");
      await queryClient.invalidateQueries({
        queryKey: ["sql-bookmarks", activeConnection?.id, resolvedDatabase, resolvedSchema],
      });
    },
    onError: (error) => toast.error(formatApiError(error)),
  });

  if (connectionsQuery.isError) {
    return (
      <section className="app-panel rounded-[30px] p-6 text-sm text-[var(--danger)]">
        {formatApiError(connectionsQuery.error)}
      </section>
    );
  }

  if (!activeConnection) {
    return <WorkbenchEmptyState />;
  }

  const tableColumns = tableMetadataQuery.data?.metadata.columns ?? [];
  const tableIndexes = tableMetadataQuery.data?.metadata.indexes ?? [];
  const activeObjects = objectsQuery.data?.objects ?? [];
  const bookmarks = bookmarksQuery.data?.bookmarks ?? [];
  const columnOptions = tableColumns.map((column) => column.name);
  const canUseTable = Boolean(resolvedDatabase && resolvedSchema && resolvedTable);

  function updateCreateTableColumn(
    index: number,
    patch: Partial<CreateTableInput["columns"][number]>,
  ) {
    setCreateTableColumns((current) =>
      current.map((column, columnIndex) =>
        columnIndex === index ? { ...column, ...patch } : column,
      ),
    );
  }

  function loadBookmark(bookmark: { id: string; name: string; sql: string }) {
    setBookmarkId(bookmark.id);
    setBookmarkName(bookmark.name);
    setBookmarkSql(bookmark.sql);
    setSqlImportText(bookmark.sql);
    setActiveTab("bookmarks");
  }

  return (
    <div className="space-y-6">
      <section className="app-panel overflow-hidden rounded-[34px]">
        <div className="bg-[linear-gradient(135deg,var(--panel)_0%,var(--panel-soft)_100%)] px-6 py-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.3em] text-[var(--muted)]">
                Workbench
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-[var(--foreground)]">
                Structure, Objects, Monitor, Import / Export
              </h2>
              <p className="mt-2 max-w-3xl text-sm text-[var(--muted)]">
                phpMyAdmin で不足していた GUI 操作を、接続コンテキストを失わずにまとめています。
                テーブル構造の変更、定義確認、CSV / SQL 取込、サーバ監視、SQL
                ブックマークまでここで扱えます。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge>{dialectLabel(activeConnection.dialect)}</Badge>
              <Badge tone={activeConnection.readonly ? "warning" : "success"}>
                {activeConnection.readonly ? "readonly" : "writable"}
              </Badge>
              <Badge tone="outline">
                {serverInfoQuery.data?.serverInfo.currentUser ?? activeConnection.username}
              </Badge>
            </div>
          </div>
          <div className="mt-6 grid gap-3 xl:grid-cols-4 md:grid-cols-2">
            <Field label="接続">
              <SelectInput
                onChange={(event) =>
                  setSelection(
                    {
                      connectionId: event.target.value,
                      database: "",
                      schema: "",
                      table: "",
                    },
                    { replace: true },
                  )
                }
                value={activeConnection.id}
              >
                {connections.map((connection) => (
                  <option key={connection.id} value={connection.id}>
                    {connection.name}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field label="database">
              <SelectInput
                onChange={(event) =>
                  setSelection(
                    { database: event.target.value, schema: "", table: "" },
                    { replace: true },
                  )
                }
                value={resolvedDatabase}
              >
                {databases.map((database) => (
                  <option key={database.name} value={database.name}>
                    {database.name}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field label="schema">
              <SelectInput
                onChange={(event) =>
                  setSelection({ schema: event.target.value, table: "" }, { replace: true })
                }
                value={resolvedSchema}
              >
                {(activeConnection.dialect === "postgresql"
                  ? schemas
                  : [{ name: resolvedDatabase }]
                ).map((schema) => (
                  <option key={schema.name} value={schema.name}>
                    {schema.name}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field label="table">
              <SelectInput
                onChange={(event) => setSelection({ table: event.target.value }, { replace: true })}
                value={resolvedTable}
              >
                {tables.map((table) => (
                  <option key={table.name} value={table.name}>
                    {table.name} ({table.type})
                  </option>
                ))}
              </SelectInput>
            </Field>
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              to={`/app/sql${buildSelectionSearch({
                connectionId: activeConnection.id,
                database: resolvedDatabase,
                schema: resolvedSchema,
                table: resolvedTable || undefined,
              })}`}
            >
              <Button variant="secondary">
                <FileCode2 className="mr-2 size-4" />
                SQL Editor へ
              </Button>
            </Link>
            <Link
              to={`/app/table${buildSelectionSearch({
                connectionId: activeConnection.id,
                database: resolvedDatabase,
                schema: resolvedSchema,
                table: resolvedTable || undefined,
              })}`}
            >
              <Button variant="secondary">
                <Table2 className="mr-2 size-4" />
                Browse へ
              </Button>
            </Link>
            <Button
              onClick={() => {
                void Promise.all([
                  connectionsQuery.refetch(),
                  databasesQuery.refetch(),
                  schemasQuery.refetch(),
                  tablesQuery.refetch(),
                  serverInfoQuery.refetch(),
                  tableMetadataQuery.refetch(),
                  objectsQuery.refetch(),
                  sessionsQuery.refetch(),
                  variablesQuery.refetch(),
                  metricsQuery.refetch(),
                  bookmarksQuery.refetch(),
                ]);
              }}
              variant="ghost"
            >
              <RefreshCw className="mr-2 size-4" />
              Refresh Everything
            </Button>
          </div>
        </div>
        <div className="grid gap-px border-t border-[var(--border)] bg-[var(--border)] xl:grid-cols-4 md:grid-cols-2">
          <div className="bg-[var(--panel)] px-5 py-4">
            <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">objects</p>
            <p className="mt-2 text-lg font-semibold">{formatNumber(activeObjects.length)}</p>
          </div>
          <div className="bg-[var(--panel)] px-5 py-4">
            <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">columns</p>
            <p className="mt-2 text-lg font-semibold">{formatNumber(tableColumns.length)}</p>
          </div>
          <div className="bg-[var(--panel)] px-5 py-4">
            <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">indexes</p>
            <p className="mt-2 text-lg font-semibold">{formatNumber(tableIndexes.length)}</p>
          </div>
          <div className="bg-[var(--panel)] px-5 py-4">
            <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">bookmarks</p>
            <p className="mt-2 text-lg font-semibold">{formatNumber(bookmarks.length)}</p>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = tab.id === activeTab;
          return (
            <button
              className={cn(
                "inline-flex items-center gap-2 rounded-2xl border px-4 py-2 text-sm font-medium transition",
                isActive
                  ? "border-[var(--border-strong)] bg-[var(--panel)] text-[var(--foreground)] shadow-[0_10px_24px_var(--shadow-color)]"
                  : "border-transparent bg-[var(--panel-soft)] text-[var(--muted)] hover:border-[var(--border)] hover:text-[var(--foreground)]",
              )}
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              type="button"
            >
              <Icon className="size-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "structure" ? (
        <div className="space-y-5">
          <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
            <section className="app-panel rounded-[30px] p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold">Structure Snapshot</h3>
                  <p className="mt-2 text-sm text-[var(--muted)]">
                    現在選択中のテーブル定義をそのまま確認できます。DDL 変更後の確認にも使えます。
                  </p>
                </div>
                <Badge tone="outline">{resolvedTable || "no table"}</Badge>
              </div>
              {canUseTable ? (
                <div className="mt-4 space-y-4">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      disabled={!canUseTable}
                      onClick={async () => {
                        try {
                          const response = await workbenchApi.exportTable(
                            activeConnection.id,
                            resolvedDatabase,
                            resolvedSchema,
                            resolvedTable,
                            "table_sql",
                          );
                          downloadTextFile(
                            response.fileName,
                            response.contentType,
                            response.content,
                          );
                          toast.success("CREATE TABLE を書き出しました。");
                        } catch (error) {
                          toast.error(formatApiError(error));
                        }
                      }}
                      variant="secondary"
                    >
                      <Download className="mr-2 size-4" />
                      Structure Export
                    </Button>
                  </div>
                  <pre className="max-h-[520px] overflow-auto rounded-3xl border border-[var(--border)] bg-[var(--panel-soft)] p-4 text-xs text-[var(--foreground)]">
                    {tableMetadataQuery.data?.metadata.sql ??
                      "テーブルを選択すると CREATE SQL を表示します。"}
                  </pre>
                </div>
              ) : (
                <div className="mt-4 rounded-3xl border border-dashed border-[var(--border)] bg-[var(--panel-soft)] p-5 text-sm text-[var(--muted)]">
                  database / schema / table を選ぶと構造スナップショットが表示されます。
                </div>
              )}
            </section>

            <section className="app-panel rounded-[30px] p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold">Create Table</h3>
                  <p className="mt-2 text-sm text-[var(--muted)]">
                    GUI からテーブルを新規作成します。型と default は raw SQL として扱います。
                  </p>
                </div>
                <Button
                  onClick={() =>
                    setCreateTableColumns((current) => [...current, defaultCreateColumn()])
                  }
                  variant="ghost"
                >
                  <Plus className="mr-2 size-4" />
                  Column
                </Button>
              </div>
              <div className="mt-4 space-y-4">
                <Field label="テーブル名">
                  <TextInput
                    onChange={(event) => setCreateTableName(event.target.value)}
                    placeholder="orders_archive"
                    value={createTableName}
                  />
                </Field>
                <div className="space-y-3">
                  {createTableColumns.map((column, index) => (
                    <div
                      className="rounded-3xl border border-[var(--border)] bg-[var(--panel-soft)] p-4"
                      key={`create-column-${index}`}
                    >
                      <div className="grid gap-3 xl:grid-cols-2">
                        <Field label="column">
                          <TextInput
                            onChange={(event) =>
                              updateCreateTableColumn(index, { name: event.target.value })
                            }
                            placeholder="id"
                            value={column.name}
                          />
                        </Field>
                        <Field label="type">
                          <TextInput
                            onChange={(event) =>
                              updateCreateTableColumn(index, { type: event.target.value })
                            }
                            placeholder="bigint"
                            value={column.type}
                          />
                        </Field>
                        <Field label="default (raw SQL)">
                          <TextInput
                            onChange={(event) =>
                              updateCreateTableColumn(index, { defaultValue: event.target.value })
                            }
                            placeholder="CURRENT_TIMESTAMP"
                            value={column.defaultValue ?? ""}
                          />
                        </Field>
                        <div className="grid gap-3 md:grid-cols-3">
                          <CheckboxField
                            checked={column.nullable}
                            label="nullable"
                            onChange={(event) =>
                              updateCreateTableColumn(index, { nullable: event.target.checked })
                            }
                          />
                          <CheckboxField
                            checked={Boolean(column.primaryKey)}
                            label="primary key"
                            onChange={(event) =>
                              updateCreateTableColumn(index, { primaryKey: event.target.checked })
                            }
                          />
                          <CheckboxField
                            checked={Boolean(column.autoIncrement)}
                            label="auto increment"
                            onChange={(event) =>
                              updateCreateTableColumn(index, {
                                autoIncrement: event.target.checked,
                              })
                            }
                          />
                        </div>
                      </div>
                      {createTableColumns.length > 1 ? (
                        <div className="mt-3 flex justify-end">
                          <Button
                            onClick={() =>
                              setCreateTableColumns((current) =>
                                current.filter((_, columnIndex) => columnIndex !== index),
                              )
                            }
                            variant="ghost"
                          >
                            <Trash2 className="mr-2 size-4" />
                            Remove
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
                <Button
                  disabled={createTableMutation.isPending || !createTableName.trim()}
                  onClick={() => {
                    void createTableMutation.mutateAsync();
                  }}
                >
                  <Hammer className="mr-2 size-4" />
                  {createTableMutation.isPending ? "Creating..." : "Create Table"}
                </Button>
              </div>
            </section>
          </div>

          <div className="grid gap-5 xl:grid-cols-3">
            <section className="app-panel rounded-[30px] p-5">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel-soft)] p-2 text-[var(--accent)]">
                  <Table2 className="size-4" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold">Table Actions</h3>
                  <p className="text-sm text-[var(--muted)]">
                    rename / drop を GUI から操作します。
                  </p>
                </div>
              </div>
              <div className="mt-4 space-y-4">
                <Field label="新しいテーブル名">
                  <TextInput
                    disabled={!canUseTable}
                    onChange={(event) => setRenameTableName(event.target.value)}
                    value={renameTableName}
                  />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={
                      renameTableMutation.isPending || !canUseTable || !renameTableName.trim()
                    }
                    onClick={() => {
                      void renameTableMutation.mutateAsync();
                    }}
                    variant="secondary"
                  >
                    {renameTableMutation.isPending ? "Renaming..." : "Rename Table"}
                  </Button>
                  <Button
                    disabled={dropTableMutation.isPending || !canUseTable}
                    onClick={() => {
                      if (
                        !resolvedTable ||
                        !window.confirm(`${resolvedTable} を削除します。元に戻せません。`)
                      ) {
                        return;
                      }
                      void dropTableMutation.mutateAsync();
                    }}
                    variant="danger"
                  >
                    {dropTableMutation.isPending ? "Dropping..." : "Drop Table"}
                  </Button>
                </div>
              </div>
            </section>

            <section className="app-panel rounded-[30px] p-5">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel-soft)] p-2 text-[var(--accent)]">
                  <Columns3 className="size-4" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold">Column Studio</h3>
                  <p className="text-sm text-[var(--muted)]">追加と削除をここで行います。</p>
                </div>
              </div>
              <div className="mt-4 space-y-3">
                <div className="rounded-3xl border border-[var(--border)] bg-[var(--panel-soft)] p-4">
                  <div className="grid gap-3">
                    <Field label="column">
                      <TextInput
                        onChange={(event) =>
                          setAddColumnForm((current) => ({ ...current, name: event.target.value }))
                        }
                        value={addColumnForm.name}
                      />
                    </Field>
                    <Field label="type">
                      <TextInput
                        onChange={(event) =>
                          setAddColumnForm((current) => ({ ...current, type: event.target.value }))
                        }
                        value={addColumnForm.type}
                      />
                    </Field>
                    <Field label="default (raw SQL)">
                      <TextInput
                        onChange={(event) =>
                          setAddColumnForm((current) => ({
                            ...current,
                            defaultValue: event.target.value,
                          }))
                        }
                        value={addColumnForm.defaultValue ?? ""}
                      />
                    </Field>
                    <div className="grid gap-3 md:grid-cols-2">
                      <CheckboxField
                        checked={addColumnForm.nullable}
                        label="nullable"
                        onChange={(event) =>
                          setAddColumnForm((current) => ({
                            ...current,
                            nullable: event.target.checked,
                          }))
                        }
                      />
                      <CheckboxField
                        checked={Boolean(addColumnForm.autoIncrement)}
                        label="auto increment"
                        onChange={(event) =>
                          setAddColumnForm((current) => ({
                            ...current,
                            autoIncrement: event.target.checked,
                          }))
                        }
                      />
                    </div>
                    <Button
                      disabled={
                        addColumnMutation.isPending || !canUseTable || !addColumnForm.name.trim()
                      }
                      onClick={() => {
                        void addColumnMutation.mutateAsync();
                      }}
                      variant="secondary"
                    >
                      {addColumnMutation.isPending ? "Adding..." : "Add Column"}
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  {tableColumns.map((column) => (
                    <div
                      className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--panel)] px-4 py-3"
                      key={column.name}
                    >
                      <div>
                        <p className="font-medium">{column.name}</p>
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          {column.type} / {column.nullable ? "nullable" : "required"}
                          {column.primaryKey ? " / primary key" : ""}
                        </p>
                      </div>
                      <Button
                        disabled={!canUseTable}
                        onClick={async () => {
                          if (!window.confirm(`${column.name} を削除します。`)) {
                            return;
                          }
                          try {
                            await workbenchApi.dropColumn(
                              activeConnection.id,
                              resolvedDatabase,
                              resolvedSchema,
                              resolvedTable,
                              column.name,
                            );
                            toast.success("カラムを削除しました。");
                            await invalidateWorkbenchQueries();
                          } catch (error) {
                            toast.error(formatApiError(error));
                          }
                        }}
                        variant="ghost"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="app-panel rounded-[30px] p-5">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel-soft)] p-2 text-[var(--accent)]">
                  <Layers3 className="size-4" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold">Index Studio</h3>
                  <p className="text-sm text-[var(--muted)]">
                    複数列 index の作成と削除に対応しています。
                  </p>
                </div>
              </div>
              <div className="mt-4 space-y-3">
                <Field label="index name">
                  <TextInput
                    onChange={(event) =>
                      setCreateIndexForm((current) => ({ ...current, name: event.target.value }))
                    }
                    value={createIndexForm.name}
                  />
                </Field>
                <Field label="columns">
                  <SelectInput
                    multiple
                    onChange={(event) =>
                      setCreateIndexForm((current) => ({
                        ...current,
                        columns: Array.from(event.target.selectedOptions, (option) => option.value),
                      }))
                    }
                    size={Math.min(Math.max(columnOptions.length, 3), 8)}
                    value={createIndexForm.columns}
                  >
                    {columnOptions.map((column) => (
                      <option key={column} value={column}>
                        {column}
                      </option>
                    ))}
                  </SelectInput>
                </Field>
                <CheckboxField
                  checked={createIndexForm.unique}
                  label="unique index"
                  onChange={(event) =>
                    setCreateIndexForm((current) => ({ ...current, unique: event.target.checked }))
                  }
                />
                <Button
                  disabled={
                    createIndexMutation.isPending ||
                    !canUseTable ||
                    !createIndexForm.name.trim() ||
                    createIndexForm.columns.length === 0
                  }
                  onClick={() => {
                    void createIndexMutation.mutateAsync();
                  }}
                  variant="secondary"
                >
                  {createIndexMutation.isPending ? "Creating..." : "Create Index"}
                </Button>
                <div className="space-y-2">
                  {tableIndexes.map((index) => (
                    <div
                      className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--panel)] px-4 py-3"
                      key={index.name}
                    >
                      <div>
                        <p className="font-medium">{index.name}</p>
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          {index.columns.join(", ")} / {index.unique ? "unique" : "non-unique"}
                        </p>
                      </div>
                      {!index.primary ? (
                        <Button
                          disabled={!canUseTable}
                          onClick={async () => {
                            if (!window.confirm(`${index.name} を削除します。`)) {
                              return;
                            }
                            try {
                              await workbenchApi.dropIndex(
                                activeConnection.id,
                                resolvedDatabase,
                                resolvedSchema,
                                resolvedTable,
                                index.name,
                              );
                              toast.success("インデックスを削除しました。");
                              await invalidateWorkbenchQueries();
                            } catch (error) {
                              toast.error(formatApiError(error));
                            }
                          }}
                          variant="ghost"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      ) : (
                        <Badge tone="outline">primary</Badge>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>
        </div>
      ) : null}

      {activeTab === "objects" ? (
        <div className="grid gap-5 xl:grid-cols-[0.28fr_0.72fr]">
          <section className="app-panel rounded-[30px] p-5">
            <h3 className="text-lg font-semibold">Object Filter</h3>
            <p className="mt-2 text-sm text-[var(--muted)]">
              view, trigger, routine, event, sequence を横断で確認します。
            </p>
            <div className="mt-4 space-y-2">
              {objectKinds.map((kind) => (
                <button
                  className={cn(
                    "flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left text-sm transition",
                    objectFilter === kind.value
                      ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--foreground)]"
                      : "border-[var(--border)] bg-[var(--panel)] text-[var(--muted)] hover:text-[var(--foreground)]",
                  )}
                  key={kind.value}
                  onClick={() => setObjectFilter(kind.value)}
                  type="button"
                >
                  <span>{kind.label}</span>
                  <Badge tone="outline">
                    {formatNumber(
                      (objectsQuery.data?.objects ?? []).filter((object) =>
                        kind.value === "all" ? true : object.kind === kind.value,
                      ).length,
                    )}
                  </Badge>
                </button>
              ))}
            </div>
          </section>
          <section className="space-y-4">
            {filteredObjects.length === 0 ? (
              <div className="app-panel rounded-[30px] p-6 text-sm text-[var(--muted)]">
                該当する DB object はありません。
              </div>
            ) : (
              filteredObjects.map((object) => (
                <article className="app-panel rounded-[30px] p-5" key={object.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-semibold">{object.name}</h3>
                        <Badge tone="outline">{object.kind}</Badge>
                        {object.routineType ? (
                          <Badge tone="muted">{object.routineType}</Badge>
                        ) : null}
                        {object.enabled != null ? (
                          <Badge tone={object.enabled ? "success" : "warning"}>
                            {object.enabled ? "enabled" : "disabled"}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-2 text-sm text-[var(--muted)]">
                        schema: {object.schema}
                        {object.relatedTable ? ` / table: ${object.relatedTable}` : ""}
                        {object.timing ? ` / ${object.timing}` : ""}
                        {object.event ? ` / ${object.event}` : ""}
                      </p>
                    </div>
                    <Badge tone="muted">{formatDateTime(object.updatedAt)}</Badge>
                  </div>
                  <pre className="mt-4 max-h-72 overflow-auto rounded-3xl border border-[var(--border)] bg-[var(--panel-soft)] p-4 text-xs text-[var(--foreground)]">
                    {object.definition ?? "definition は取得できませんでした。"}
                  </pre>
                </article>
              ))
            )}
          </section>
        </div>
      ) : null}

      {activeTab === "io" ? (
        <div className="space-y-5">
          <div className="grid gap-5 xl:grid-cols-2">
            <section className="app-panel rounded-[30px] p-5">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel-soft)] p-2 text-[var(--accent)]">
                  <Download className="size-4" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold">Export Deck</h3>
                  <p className="text-sm text-[var(--muted)]">
                    現在のテーブルを CSV / JSON / INSERT SQL / CREATE SQL で書き出します。
                  </p>
                </div>
              </div>
              <div className="mt-5 grid gap-3 md:grid-cols-2">
                {[
                  ["csv", "CSV"],
                  ["json", "JSON"],
                  ["insert_sql", "INSERT SQL"],
                  ["table_sql", "CREATE SQL"],
                ].map(([format, label]) => (
                  <Button
                    disabled={!canUseTable}
                    key={format}
                    onClick={async () => {
                      try {
                        const response = await workbenchApi.exportTable(
                          activeConnection.id,
                          resolvedDatabase,
                          resolvedSchema,
                          resolvedTable,
                          format as "csv" | "json" | "insert_sql" | "table_sql",
                        );
                        downloadTextFile(response.fileName, response.contentType, response.content);
                        toast.success(`${label} を書き出しました。`);
                      } catch (error) {
                        toast.error(formatApiError(error));
                      }
                    }}
                    variant="secondary"
                  >
                    <Download className="mr-2 size-4" />
                    {label}
                  </Button>
                ))}
              </div>
            </section>

            <section className="app-panel rounded-[30px] p-5">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel-soft)] p-2 text-[var(--accent)]">
                  <Upload className="size-4" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold">CSV Import</h3>
                  <p className="text-sm text-[var(--muted)]">
                    1 行目をヘッダーとして扱い、現在のテーブルへ一括取り込みします。
                  </p>
                </div>
              </div>
              <div className="mt-4 space-y-4">
                <div className="flex flex-wrap gap-2">
                  <label className="inline-flex cursor-pointer items-center rounded-2xl border border-[var(--border)] bg-[var(--panel)] px-4 py-2 text-sm text-[var(--foreground)] transition hover:bg-[var(--panel-soft)]">
                    <Upload className="mr-2 size-4" />
                    CSV ファイルを読み込む
                    <input
                      className="hidden"
                      onChange={async (event) => {
                        const file = event.target.files?.[0];
                        if (!file) {
                          return;
                        }
                        try {
                          setCsvContent(await readFileAsText(file));
                          toast.success("CSV を読み込みました。");
                        } catch (error) {
                          toast.error(formatApiError(error));
                        } finally {
                          event.target.value = "";
                        }
                      }}
                      type="file"
                    />
                  </label>
                </div>
                <Field label="delimiter">
                  <SelectInput
                    onChange={(event) => setCsvDelimiter(event.target.value as "," | ";" | "\t")}
                    value={csvDelimiter}
                  >
                    <option value=",">comma (,)</option>
                    <option value=";">semicolon (;)</option>
                    <option value="	">tab</option>
                  </SelectInput>
                </Field>
                <CheckboxField
                  checked={truncateBeforeImport}
                  hint="取込前にテーブル内容を消します。"
                  label="既存データを truncate してから import"
                  onChange={(event) => setTruncateBeforeImport(event.target.checked)}
                />
                <Field label="CSV content">
                  <TextArea
                    onChange={(event) => setCsvContent(event.target.value)}
                    placeholder="id,name&#10;1,alpha&#10;2,beta"
                    value={csvContent}
                  />
                </Field>
                <Button
                  disabled={importCsvMutation.isPending || !canUseTable || !csvContent.trim()}
                  onClick={() => {
                    void importCsvMutation.mutateAsync();
                  }}
                >
                  <Upload className="mr-2 size-4" />
                  {importCsvMutation.isPending ? "Importing..." : "Import CSV"}
                </Button>
              </div>
            </section>
          </div>

          <section className="app-panel rounded-[30px] p-5">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel-soft)] p-2 text-[var(--accent)]">
                <FileCode2 className="size-4" />
              </div>
              <div>
                <h3 className="text-lg font-semibold">SQL Import</h3>
                <p className="text-sm text-[var(--muted)]">
                  `.sql` を貼り付けるか読み込み、そのまま実行します。schema 変更や data load
                  に使えます。
                </p>
              </div>
            </div>
            <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_0.32fr]">
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <label className="inline-flex cursor-pointer items-center rounded-2xl border border-[var(--border)] bg-[var(--panel)] px-4 py-2 text-sm text-[var(--foreground)] transition hover:bg-[var(--panel-soft)]">
                    <Upload className="mr-2 size-4" />
                    SQL ファイルを読み込む
                    <input
                      className="hidden"
                      onChange={async (event) => {
                        const file = event.target.files?.[0];
                        if (!file) {
                          return;
                        }
                        try {
                          setSqlImportText(await readFileAsText(file));
                          toast.success("SQL を読み込みました。");
                        } catch (error) {
                          toast.error(formatApiError(error));
                        } finally {
                          event.target.value = "";
                        }
                      }}
                      type="file"
                    />
                  </label>
                  <Button
                    onClick={() => {
                      setBookmarkSql(sqlImportText);
                      if (!bookmarkName) {
                        setBookmarkName(`${resolvedTable || "workspace"} import`);
                      }
                      setActiveTab("bookmarks");
                    }}
                    variant="ghost"
                  >
                    <Bookmark className="mr-2 size-4" />
                    ブックマークへ送る
                  </Button>
                </div>
                <Field label="SQL">
                  <TextArea
                    className="min-h-[340px] font-mono text-xs"
                    onChange={(event) => setSqlImportText(event.target.value)}
                    placeholder="CREATE TABLE ...; INSERT INTO ...;"
                    value={sqlImportText}
                  />
                </Field>
              </div>
              <div className="space-y-4">
                <CheckboxField
                  checked={confirmDangerousSql}
                  hint="DDL / DELETE / DROP を実行する場合に必要です。"
                  label="危険な SQL を確認済み"
                  onChange={(event) => setConfirmDangerousSql(event.target.checked)}
                />
                <Button
                  disabled={executeSqlImportMutation.isPending || !sqlImportText.trim()}
                  onClick={() => {
                    void executeSqlImportMutation.mutateAsync();
                  }}
                  variant="secondary"
                >
                  <Play className="mr-2 size-4" />
                  {executeSqlImportMutation.isPending ? "Running..." : "Run Import SQL"}
                </Button>
                <div className="rounded-3xl border border-[var(--border)] bg-[var(--panel-soft)] p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">tips</p>
                  <ul className="mt-3 space-y-2 text-sm text-[var(--muted)]">
                    <li>CSV は現在のテーブルへ、SQL は現在の接続へ流れます。</li>
                    <li>readonly 接続では import / DDL は拒否されます。</li>
                    <li>実行後は objects / structure / rows を自動 refresh します。</li>
                  </ul>
                </div>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {activeTab === "monitor" ? (
        <div className="space-y-5">
          <section className="app-panel rounded-[30px] p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold">Server Monitor</h3>
                <p className="mt-2 text-sm text-[var(--muted)]">
                  processlist / pg_stat_activity、variables、主要 metrics をまとめて見ます。
                </p>
              </div>
              <div className="w-full max-w-sm">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]" />
                  <TextInput
                    className="pl-9"
                    onChange={(event) => setMonitorSearch(event.target.value)}
                    placeholder="session / variable / metric を検索"
                    value={monitorSearch}
                  />
                </div>
              </div>
            </div>
          </section>

          <div className="grid gap-5 xl:grid-cols-4 md:grid-cols-2">
            {filteredMetrics.slice(0, 8).map((metric) => (
              <section
                className="app-panel-muted rounded-[26px] p-5"
                key={`${metric.category}-${metric.name}`}
              >
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
                  {metric.category}
                </p>
                <p className="mt-3 text-sm text-[var(--muted)]">{metric.name}</p>
                <p className="mt-2 text-xl font-semibold text-[var(--foreground)]">
                  {metric.value}
                </p>
              </section>
            ))}
          </div>

          <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
            <section className="app-panel rounded-[30px] p-5">
              <div className="flex items-center gap-3">
                <Server className="size-4 text-[var(--accent)]" />
                <h3 className="text-lg font-semibold">Sessions</h3>
              </div>
              <div className="mt-4 space-y-3">
                {filteredSessions.length === 0 ? (
                  <div className="rounded-3xl border border-dashed border-[var(--border)] bg-[var(--panel-soft)] p-4 text-sm text-[var(--muted)]">
                    該当する session はありません。
                  </div>
                ) : (
                  filteredSessions.map((session) => (
                    <article
                      className="rounded-3xl border border-[var(--border)] bg-[var(--panel)] p-4"
                      key={session.id}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Badge tone="outline">{session.user}</Badge>
                          <Badge tone="muted">{session.command ?? "-"}</Badge>
                          <Badge tone="muted">{session.state ?? "-"}</Badge>
                        </div>
                        <span className="text-xs text-[var(--muted)]">
                          {session.durationSeconds == null ? "-" : `${session.durationSeconds}s`}
                        </span>
                      </div>
                      <p className="mt-3 text-sm text-[var(--muted)]">
                        {session.database ?? "-"} / {session.host ?? "-"}
                      </p>
                      <pre className="mt-3 max-h-40 overflow-auto rounded-2xl border border-[var(--border)] bg-[var(--panel-soft)] p-3 text-xs text-[var(--foreground)]">
                        {session.query ?? "query なし"}
                      </pre>
                    </article>
                  ))
                )}
              </div>
            </section>

            <div className="space-y-5">
              <section className="app-panel rounded-[30px] p-5">
                <div className="flex items-center gap-3">
                  <Database className="size-4 text-[var(--accent)]" />
                  <h3 className="text-lg font-semibold">Metrics</h3>
                </div>
                <div className="mt-4 overflow-x-auto rounded-3xl border border-[var(--border)]">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-[var(--panel-soft)] text-[var(--muted)]">
                      <tr>
                        <th className="px-4 py-3 font-medium">category</th>
                        <th className="px-4 py-3 font-medium">name</th>
                        <th className="px-4 py-3 font-medium">value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredMetrics.map((metric) => (
                        <tr
                          className="border-t border-[var(--border)]"
                          key={`${metric.category}-${metric.name}`}
                        >
                          <td className="px-4 py-3">{metric.category}</td>
                          <td className="px-4 py-3">{metric.name}</td>
                          <td className="px-4 py-3 font-mono">{metric.value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
              <section className="app-panel rounded-[30px] p-5">
                <div className="flex items-center gap-3">
                  <Layers3 className="size-4 text-[var(--accent)]" />
                  <h3 className="text-lg font-semibold">Variables</h3>
                </div>
                <div className="mt-4 overflow-x-auto rounded-3xl border border-[var(--border)]">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-[var(--panel-soft)] text-[var(--muted)]">
                      <tr>
                        <th className="px-4 py-3 font-medium">name</th>
                        <th className="px-4 py-3 font-medium">value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredVariables.slice(0, 120).map((variable) => (
                        <tr className="border-t border-[var(--border)]" key={variable.name}>
                          <td className="px-4 py-3">{variable.name}</td>
                          <td className="px-4 py-3 font-mono text-xs">{variable.value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === "bookmarks" ? (
        <div className="grid gap-5 xl:grid-cols-[0.92fr_1.08fr]">
          <section className="app-panel rounded-[30px] p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold">Save SQL Bookmark</h3>
                <p className="mt-2 text-sm text-[var(--muted)]">
                  connection / database / schema 文脈付きで保存します。WorkBench と SQL Editor
                  の往復に使えます。
                </p>
              </div>
              {bookmarkId ? <Badge tone="outline">editing</Badge> : <Badge>new</Badge>}
            </div>
            <div className="mt-4 space-y-4">
              <Field label="名前">
                <TextInput
                  onChange={(event) => setBookmarkName(event.target.value)}
                  placeholder="weekly cleanup"
                  value={bookmarkName}
                />
              </Field>
              <Field label="SQL">
                <TextArea
                  className="min-h-[320px] font-mono text-xs"
                  onChange={(event) => setBookmarkSql(event.target.value)}
                  placeholder="SELECT * FROM ..."
                  value={bookmarkSql}
                />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={
                    saveBookmarkMutation.isPending || !bookmarkName.trim() || !bookmarkSql.trim()
                  }
                  onClick={() => {
                    void saveBookmarkMutation.mutateAsync();
                  }}
                >
                  {saveBookmarkMutation.isPending
                    ? "Saving..."
                    : bookmarkId
                      ? "Update Bookmark"
                      : "Save Bookmark"}
                </Button>
                <Button
                  onClick={() => {
                    setBookmarkId(null);
                    setBookmarkName("");
                    setBookmarkSql(sqlImportText);
                  }}
                  variant="secondary"
                >
                  現在の SQL をコピー
                </Button>
                {bookmarkId ? (
                  <Button
                    onClick={() => {
                      void deleteBookmarkMutation.mutateAsync(bookmarkId);
                    }}
                    variant="danger"
                  >
                    Delete Bookmark
                  </Button>
                ) : null}
              </div>
            </div>
          </section>

          <section className="space-y-4">
            {bookmarks.length === 0 ? (
              <div className="app-panel rounded-[30px] p-6 text-sm text-[var(--muted)]">
                まだブックマークはありません。Import / Export タブの SQL から送ることもできます。
              </div>
            ) : (
              bookmarks.map((bookmark) => (
                <article className="app-panel rounded-[30px] p-5" key={bookmark.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-semibold">{bookmark.name}</h3>
                        <Badge tone="outline">{bookmark.connectionId ? "scoped" : "global"}</Badge>
                      </div>
                      <p className="mt-2 text-sm text-[var(--muted)]">
                        {bookmark.database ?? "-"} / {bookmark.schema ?? "-"} / updated{" "}
                        {formatDateTime(bookmark.updatedAt)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={() => loadBookmark(bookmark)} variant="secondary">
                        Load
                      </Button>
                      <Link
                        to={`/app/sql${buildSelectionSearch({
                          connectionId: bookmark.connectionId ?? activeConnection.id,
                          database: bookmark.database ?? resolvedDatabase,
                          schema: bookmark.schema ?? resolvedSchema,
                        })}`}
                      >
                        <Button variant="ghost">Open SQL</Button>
                      </Link>
                    </div>
                  </div>
                  <pre className="mt-4 max-h-64 overflow-auto rounded-3xl border border-[var(--border)] bg-[var(--panel-soft)] p-4 text-xs text-[var(--foreground)]">
                    {bookmark.sql}
                  </pre>
                </article>
              ))
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
