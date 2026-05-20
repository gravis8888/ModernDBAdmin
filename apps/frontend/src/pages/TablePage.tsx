import { useDeferredValue, useEffect, useState } from "react";
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Bookmark,
  ClipboardCopy,
  Columns3,
  Database,
  Download,
  Eye,
  ExternalLink,
  FileCode2,
  Filter,
  KeyRound,
  Layers3,
  ListTree,
  PencilLine,
  Plus,
  RefreshCw,
  Search,
  Server,
  ShieldAlert,
  Sparkles,
  Table2,
  Trash2,
  Upload,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";
import type {
  AddColumnInput,
  ColumnInfo,
  CreateIndexInput,
  CreateTableInput,
  RowFilterInput,
  TableInfo,
} from "@modern-db-admin/shared";
import { toast } from "sonner";
import { Link, useSearchParams } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckboxField, Field, SelectInput, TextArea, TextInput } from "@/components/ui/field";
import { buildSelectionSearch, useSelection } from "@/hooks/use-selection";
import {
  connectionsApi,
  formatApiError,
  metadataApi,
  rowsApi,
  sqlBookmarksApi,
  workbenchApi,
} from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDateTime, formatNumber, stringifyCellValue } from "@/lib/format";
import { useRuntimeStore } from "@/stores/runtime-store";

type TableRow = Record<string, unknown>;
type SearchOperator = (typeof searchOperators)[number]["value"];
type SearchCriterion = {
  operator: SearchOperator;
  value: string;
};

const tableTabs = [
  { id: "browse", label: "表示", shortLabel: "表示", icon: Table2 },
  { id: "structure", label: "構造", shortLabel: "構造", icon: Columns3 },
  { id: "search", label: "検索", shortLabel: "検索", icon: Search },
  { id: "objects", label: "ルーチン/トリガ", shortLabel: "ルーチン", icon: Layers3 },
  { id: "export", label: "インポート/エクスポート", shortLabel: "入出力", icon: Upload },
  { id: "operations", label: "操作", shortLabel: "操作", icon: WandSparkles },
  { id: "sql", label: "SQL", shortLabel: "SQL", icon: FileCode2 },
  { id: "info", label: "情報", shortLabel: "情報", icon: Database },
] as const;

type TableTab = (typeof tableTabs)[number]["id"];
type TablePageAction = "create-database" | "create-table";

const searchOperators = [
  { value: "eq", label: "=" },
  { value: "not", label: "!=" },
  { value: "contains", label: "LIKE %...%" },
  { value: "starts", label: "LIKE ...%" },
  { value: "ends", label: "LIKE %..." },
  { value: "gt", label: ">" },
  { value: "gte", label: ">=" },
  { value: "lt", label: "<" },
  { value: "lte", label: "<=" },
  { value: "is-null", label: "IS NULL" },
  { value: "not-null", label: "IS NOT NULL" },
] as const;

function isTableTab(value: string | null): value is TableTab {
  return tableTabs.some((tab) => tab.id === value);
}

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

function toDraftValue(value: unknown) {
  if (value == null) {
    return "";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function parseDraftValue(raw: string, column: ColumnInfo) {
  const trimmed = raw.trim();
  if (!trimmed) {
    if (column.nullable) {
      return null;
    }
    if (column.autoIncrement) {
      return undefined;
    }
    return "";
  }

  if (/^(true|false)$/i.test(trimmed)) {
    return trimmed.toLowerCase() === "true";
  }
  if (
    /int|numeric|decimal|float|double|real|serial|bigint/i.test(column.type) &&
    /^-?\d+(\.\d+)?$/.test(trimmed)
  ) {
    return Number(trimmed);
  }
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return raw;
    }
  }
  return raw;
}

function buildSearchFilter(
  column: ColumnInfo,
  criterion: SearchCriterion | undefined,
): RowFilterInput | null {
  if (!criterion) {
    return null;
  }

  const value = criterion.value.trim();

  if (criterion.operator === "is-null") {
    return { column: column.name, operator: "is-null" };
  }
  if (criterion.operator === "not-null") {
    return { column: column.name, operator: "not-null" };
  }
  if (!value) {
    return null;
  }

  return { column: column.name, operator: criterion.operator, value };
}

function formatFilterValue(value: unknown) {
  if (value == null) {
    return "NULL";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function formatRowFilter(filter: RowFilterInput) {
  if (filter.operator === "is-null") {
    return `${filter.column} IS NULL`;
  }
  if (filter.operator === "not-null") {
    return `${filter.column} IS NOT NULL`;
  }

  const operatorLabels: Record<RowFilterInput["operator"], string> = {
    eq: "=",
    not: "!=",
    contains: "contains",
    starts: "starts with",
    ends: "ends with",
    gt: ">",
    gte: ">=",
    lt: "<",
    lte: "<=",
    "is-null": "IS NULL",
    "not-null": "IS NOT NULL",
  };
  return `${filter.column} ${operatorLabels[filter.operator]} ${formatFilterValue(filter.value)}`;
}

function formatBytes(value: number | undefined) {
  if (value == null || Number.isNaN(value)) {
    return "-";
  }
  if (value < 1024) {
    return `${formatNumber(value)} B`;
  }
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let next = value / 1024;
  let unitIndex = 0;
  while (next >= 1024 && unitIndex < units.length - 1) {
    next /= 1024;
    unitIndex++;
  }
  return `${next.toFixed(next >= 10 ? 1 : 2)} ${units[unitIndex]}`;
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

function MetricCard({
  hint,
  icon: Icon,
  label,
  value,
}: {
  hint?: string;
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] px-3 py-2.5 shadow-[0_6px_16px_var(--shadow-color)]">
      <div className="flex items-center gap-2">
        <Icon className="size-3.5 text-[var(--accent)]" />
        <p className="truncate text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">
          {label}
        </p>
      </div>
      <p className="mt-1 text-xl font-semibold tracking-[-0.03em] text-[var(--foreground)]">
        {value}
      </p>
      {hint ? <p className="truncate text-xs text-[var(--muted)]">{hint}</p> : null}
    </div>
  );
}

function ConnectionInfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--panel-soft)] px-3 py-2 text-sm">
      <span className="text-[var(--muted)]">{label}</span>
      <span className="truncate text-right font-medium text-[var(--foreground)]">{value}</span>
    </div>
  );
}

function EmptyPanel({ title, description }: { title: string; description: string }) {
  return (
    <section className="app-panel rounded-[28px] p-6">
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mt-2 text-sm text-[var(--muted)]">{description}</p>
    </section>
  );
}

function ContextSummary({
  connectionName,
  database,
  dbUsersHref,
  dbUsersLabel,
  readonly,
  schema,
  tableName,
}: {
  connectionName?: string;
  database?: string;
  dbUsersHref?: string;
  dbUsersLabel?: string;
  readonly?: boolean;
  schema?: string;
  tableName?: string;
}) {
  const title = tableName ?? schema ?? database ?? connectionName ?? "Database Explorer";
  const contextItems = [connectionName ?? "未接続", database, schema, tableName].filter(
    (item): item is string => Boolean(item),
  );

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] px-4 py-3 shadow-[0_8px_20px_var(--shadow-color)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold tracking-[-0.03em] text-[var(--foreground)]">
            {title}
          </h2>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1 text-sm text-[var(--muted)]">
            {contextItems.map((item, index) => (
              <span className="inline-flex min-w-0 items-center gap-1" key={`${item}-${index}`}>
                {index > 0 ? <span className="text-[var(--border-strong)]">/</span> : null}
                <span className="truncate">{item}</span>
              </span>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="px-2.5 py-1 text-[11px]" tone={readonly ? "warning" : "success"}>
            {readonly ? "readonly" : "editable"}
          </Badge>
          {dbUsersHref && dbUsersLabel ? (
            <Link to={dbUsersHref}>
              <Button className="px-2.5 py-1.5 text-xs" variant="secondary">
                <KeyRound className="mr-2 size-4" />
                {dbUsersLabel}
              </Button>
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function SectionTitle({
  action,
  description,
  icon: Icon,
  title,
}: {
  action?: React.ReactNode;
  description?: string;
  icon: LucideIcon;
  title: string;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel-soft)] p-2 text-[var(--accent)]">
          <Icon className="size-4" />
        </div>
        <div>
          <h3 className="text-lg font-semibold tracking-[-0.02em]">{title}</h3>
          {description ? <p className="mt-1 text-sm text-[var(--muted)]">{description}</p> : null}
        </div>
      </div>
      {action}
    </div>
  );
}

function tableHref(
  connectionId: string | undefined,
  database: string,
  schema: string,
  table: string,
  tab?: TableTab,
) {
  const base = buildSelectionSearch({ connectionId, database, schema, table });
  const separator = base ? "&" : "?";
  return `/app/table${base}${tab ? `${separator}tab=${tab}` : ""}`;
}

function tableActionHref(
  action: TablePageAction,
  selection: Parameters<typeof buildSelectionSearch>[0],
) {
  const base = buildSelectionSearch(selection);
  const separator = base ? "&" : "?";
  return `/app/table${base}${separator}action=${action}`;
}

export function TablePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState<TableTab>(
    isTableTab(requestedTab) ? requestedTab : "browse",
  );
  const [globalFilter, setGlobalFilter] = useState("");
  const [rowFilters, setRowFilters] = useState<RowFilterInput[]>([]);
  const [pageSize, setPageSize] = useState(50);
  const [currentPage, setCurrentPage] = useState(1);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [showFilterStudio, setShowFilterStudio] = useState(false);
  const [selectedRow, setSelectedRow] = useState<TableRow | null>(null);
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});
  const [selectedObjectNames, setSelectedObjectNames] = useState<string[]>([]);
  const [isBulkDeleteConfirmOpen, setIsBulkDeleteConfirmOpen] = useState(false);
  const [databaseFilter, setDatabaseFilter] = useState("");
  const [createTableName, setCreateTableName] = useState("");
  const [createTableColumns, setCreateTableColumns] = useState<CreateTableInput["columns"]>([
    defaultCreateColumn(),
  ]);
  const [searchCriteria, setSearchCriteria] = useState<Record<string, SearchCriterion>>({});
  const [addColumnForm, setAddColumnForm] = useState<AddColumnInput>(defaultAddColumn());
  const [createIndexForm, setCreateIndexForm] = useState<CreateIndexInput>(defaultCreateIndex());
  const [renameTableName, setRenameTableName] = useState("");
  const [csvContent, setCsvContent] = useState("");
  const [csvDelimiter, setCsvDelimiter] = useState<"," | ";" | "\t">(",");
  const [truncateBeforeImport, setTruncateBeforeImport] = useState(false);
  const [bookmarkName, setBookmarkName] = useState("");
  const [bookmarkSql, setBookmarkSql] = useState("");
  const [createDatabaseName, setCreateDatabaseName] = useState("");
  const deferredFilter = useDeferredValue(globalFilter);
  const queryClient = useQueryClient();
  const { selection, setSelection } = useSelection();
  const setLastQuery = useRuntimeStore((state) => state.setLastQuery);
  const focusedSection = searchParams.get("section");
  const pageAction = searchParams.get("action");

  const connectionsQuery = useQuery({
    queryKey: ["connections"],
    queryFn: connectionsApi.list,
  });
  const activeConnection =
    connectionsQuery.data?.connections.find(
      (connection) => connection.id === selection.connectionId,
    ) ?? connectionsQuery.data?.connections[0];
  const targetConnectionId = activeConnection?.id;
  const database = selection.database;
  const isMySqlLike =
    activeConnection?.dialect === "mysql" || activeConnection?.dialect === "mariadb";
  const schema = selection.schema ?? (isMySqlLike ? database : undefined);
  const tableName = selection.table;
  const hasTableSelection = Boolean(targetConnectionId && database && schema && tableName);
  const dbUsersHref = activeConnection
    ? `/app/db-users${buildSelectionSearch({
        connectionId: activeConnection.id,
        database,
        schema: activeConnection.dialect === "postgresql" ? undefined : schema,
      })}`
    : undefined;
  const dbUsersLabel =
    activeConnection?.dialect === "postgresql"
      ? "この接続のロール・権限"
      : "この接続のDBユーザー・権限";

  const connectionServerInfoQuery = useQuery({
    queryKey: ["connection-server-info", targetConnectionId],
    queryFn: () => metadataApi.serverInfo(targetConnectionId!),
    enabled: Boolean(targetConnectionId && !database),
  });

  const connectionDatabasesQuery = useQuery({
    queryKey: ["connection-databases", targetConnectionId],
    queryFn: () => metadataApi.databases(targetConnectionId!),
    enabled: Boolean(targetConnectionId && !database),
  });

  const schemasQuery = useQuery({
    queryKey: ["database-schemas", targetConnectionId, database],
    queryFn: () => metadataApi.schemas(targetConnectionId!, database!),
    enabled: Boolean(targetConnectionId && database && !isMySqlLike),
  });

  const objectsQuery = useQuery({
    queryKey: ["database-objects", targetConnectionId, database, schema],
    queryFn: () => metadataApi.tables(targetConnectionId!, database!, schema!),
    enabled: Boolean(targetConnectionId && database && schema),
  });

  const schemaObjectsQuery = useQuery({
    queryKey: ["schema-objects", targetConnectionId, database, schema],
    queryFn: () => metadataApi.objects(targetConnectionId!, database!, schema!),
    enabled: Boolean(targetConnectionId && database && schema),
  });

  const tableMetadataQuery = useQuery({
    queryKey: ["table-metadata", targetConnectionId, database, schema, tableName],
    queryFn: () => metadataApi.tableMetadata(targetConnectionId!, database!, schema!, tableName!),
    enabled: hasTableSelection,
  });

  const rowsQuery = useQuery({
    queryKey: [
      "table-rows",
      targetConnectionId,
      database,
      schema,
      tableName,
      currentPage,
      pageSize,
      deferredFilter,
      rowFilters,
      sortColumn,
      sortDirection,
    ],
    queryFn: () =>
      rowsApi.list(targetConnectionId!, database!, schema!, tableName!, {
        page: currentPage,
        pageSize,
        orderBy: sortColumn ?? undefined,
        orderDir: sortDirection,
        search: deferredFilter || undefined,
        filters: rowFilters,
      }),
    enabled: hasTableSelection,
    placeholderData: (previousData) => previousData,
  });

  useEffect(() => {
    if (isTableTab(requestedTab)) {
      setActiveTab(requestedTab);
    }
  }, [requestedTab]);

  useEffect(() => {
    setSelectedRow(null);
    setDraftValues({});
    setCurrentPage(1);
    setGlobalFilter("");
    setRowFilters([]);
    setSortColumn(null);
    setSortDirection("asc");
    setShowFilterStudio(false);
    setSearchCriteria({});
    setRenameTableName(tableName ?? "");
    setBookmarkName(tableName ? `${tableName} definition` : "");
    setBookmarkSql("");
  }, [targetConnectionId, database, schema, tableName]);

  useEffect(() => {
    setSelectedObjectNames([]);
    setIsBulkDeleteConfirmOpen(false);
    setDatabaseFilter("");
  }, [targetConnectionId, database, schema]);

  useEffect(() => {
    setCreateDatabaseName("");
  }, [targetConnectionId]);

  useEffect(() => {
    setCurrentPage(1);
  }, [pageSize, deferredFilter, rowFilters, sortColumn, sortDirection]);

  useEffect(() => {
    const result = rowsQuery.data?.result;
    if (!result) {
      return;
    }
    setLastQuery({
      rowCount: result.rowCount,
      executionTimeMs: result.executionTimeMs,
      statementTypes: ["select"],
      updatedAt: new Date().toISOString(),
    });
  }, [rowsQuery.data?.result, setLastQuery]);

  useEffect(() => {
    if (!selectedRow || !tableMetadataQuery.data?.metadata.columns) {
      return;
    }
    const nextDraftValues: Record<string, string> = {};
    for (const column of tableMetadataQuery.data.metadata.columns) {
      nextDraftValues[column.name] = toDraftValue(selectedRow[column.name]);
    }
    setDraftValues(nextDraftValues);
  }, [tableMetadataQuery.data?.metadata.columns, selectedRow]);

  useEffect(() => {
    if (!bookmarkSql && tableMetadataQuery.data?.metadata.sql) {
      setBookmarkSql(tableMetadataQuery.data.metadata.sql);
    }
  }, [bookmarkSql, tableMetadataQuery.data?.metadata.sql]);

  function selectTab(tab: TableTab) {
    setActiveTab(tab);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("tab", tab);
    setSearchParams(nextParams, { replace: true });
  }

  async function invalidateObjectQueries() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["sidebar-tree"] }),
      queryClient.invalidateQueries({ queryKey: ["connection-databases", targetConnectionId] }),
      queryClient.invalidateQueries({
        queryKey: ["database-objects", targetConnectionId, database, schema],
      }),
      queryClient.invalidateQueries({
        queryKey: ["schema-objects", targetConnectionId, database, schema],
      }),
      queryClient.invalidateQueries({
        queryKey: ["table-metadata", targetConnectionId, database, schema, tableName],
      }),
      queryClient.invalidateQueries({
        queryKey: ["table-rows", targetConnectionId, database, schema, tableName],
      }),
    ]);
  }

  function replaceSelectionSearch(nextSelection: Parameters<typeof buildSelectionSearch>[0]) {
    setSearchParams(new URLSearchParams(buildSelectionSearch(nextSelection)), { replace: true });
  }

  const createDatabaseMutation = useMutation({
    mutationFn: async () => {
      if (!targetConnectionId) {
        throw new Error("database を作成する接続を選択してください。");
      }
      const databaseName = createDatabaseName.trim();
      return workbenchApi.createDatabase(targetConnectionId, { name: databaseName });
    },
    onSuccess: async () => {
      const databaseName = createDatabaseName.trim();
      toast.success("database を作成しました。");
      setCreateDatabaseName("");
      await invalidateObjectQueries();
      replaceSelectionSearch({
        connectionId: targetConnectionId,
        database: databaseName,
        schema: isMySqlLike ? databaseName : undefined,
      });
    },
    onError: (error) => toast.error(formatApiError(error)),
  });

  function toggleSort(columnName: string) {
    if (sortColumn !== columnName) {
      setSortColumn(columnName);
      setSortDirection("asc");
      return;
    }

    if (sortDirection === "asc") {
      setSortDirection("desc");
      return;
    }

    setSortColumn(null);
    setSortDirection("asc");
  }

  function clearBrowseControls() {
    setGlobalFilter("");
    setRowFilters([]);
    setSortColumn(null);
    setSortDirection("asc");
    setCurrentPage(1);
  }

  function applySelectedRowFilters() {
    if (!selectedRow || primaryKeyColumns.length === 0) {
      return;
    }

    const nextFilters = primaryKeyColumns.map((column) => {
      const rawValue = selectedRow[column.name];
      return rawValue == null
        ? { column: column.name, operator: "is-null" as const }
        : { column: column.name, operator: "eq" as const, value: rawValue };
    });

    setRowFilters(nextFilters);
    setShowFilterStudio(true);
    selectTab("browse");
    setCurrentPage(1);
    toast.success("選択行を基準にフィルタを設定しました。");
  }

  function isRowSelected(row: TableRow) {
    if (!selectedRow) {
      return false;
    }
    if (primaryKeyColumns.length === 0) {
      return selectedRow === row;
    }
    return primaryKeyColumns.every((column) => selectedRow[column.name] === row[column.name]);
  }

  function copyRowToDraft(row: TableRow) {
    const nextDraftValues: Record<string, string> = {};
    for (const column of tableMetadataQuery.data?.metadata.columns ?? []) {
      nextDraftValues[column.name] = toDraftValue(row[column.name]);
    }
    setSelectedRow(null);
    setDraftValues(nextDraftValues);
    toast.success("選択行を新規行フォームへコピーしました。");
  }

  function patchSearchCriterion(columnName: string, patch: Partial<SearchCriterion>) {
    setSearchCriteria((current) => ({
      ...current,
      [columnName]: {
        operator: current[columnName]?.operator ?? "contains",
        value: current[columnName]?.value ?? "",
        ...patch,
      },
    }));
  }

  function applySearchBuilder() {
    const filters = (tableMetadataQuery.data?.metadata.columns ?? [])
      .map((column) => buildSearchFilter(column, searchCriteria[column.name]))
      .filter((filter): filter is RowFilterInput => Boolean(filter));

    if (filters.length === 0) {
      toast.error("検索条件を1つ以上入力してください。");
      return;
    }

    setRowFilters(filters);
    setShowFilterStudio(true);
    selectTab("browse");
    toast.success("検索条件をフィルタとして適用しました。");
  }

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

  function toggleObjectName(name: string, checked: boolean) {
    setSelectedObjectNames((current) =>
      checked ? [...new Set([...current, name])] : current.filter((item) => item !== name),
    );
  }

  async function exportTable(format: "csv" | "json" | "insert_sql" | "table_sql") {
    if (!targetConnectionId || !database || !schema || !tableName) {
      return;
    }
    try {
      const response = await workbenchApi.exportTable(
        targetConnectionId,
        database,
        schema,
        tableName,
        format,
      );
      downloadTextFile(response.fileName, response.contentType, response.content);
      toast.success(`${response.fileName} を書き出しました。`);
    } catch (error) {
      toast.error(formatApiError(error));
    }
  }

  function exportCurrentRows() {
    const result = rowsQuery.data?.result;
    if (!result) {
      return;
    }
    const header = result.columns.map((column) => column.name).join(",");
    const body = result.rows.map((row) =>
      result.columns.map((column) => JSON.stringify(row[column.name] ?? null)).join(","),
    );
    downloadTextFile(
      `${tableName ?? "rows"}-page-${currentPage}.csv`,
      "text/csv;charset=utf-8",
      [header, ...body].join("\n"),
    );
  }

  function exportDatabaseDictionary(items: TableInfo[]) {
    const lines = [
      `Database: ${database ?? "-"}`,
      `Schema: ${schema ?? "-"}`,
      `Generated: ${new Date().toLocaleString("ja-JP")}`,
      "",
      ...items.map(
        (item) =>
          `${item.name}\t${item.type}\trows=${item.estimatedRows ?? "-"}\tsize=${formatBytes(item.sizeBytes)}\t${item.comment ?? ""}`,
      ),
    ];
    downloadTextFile(
      `${database ?? "database"}-dictionary.txt`,
      "text/plain;charset=utf-8",
      lines.join("\n"),
    );
  }

  const createTableMutation = useMutation({
    mutationFn: async () => {
      if (!targetConnectionId || !database || !schema) {
        throw new Error("接続 / database / schema を選択してください。");
      }
      return workbenchApi.createTable(targetConnectionId, database, schema, {
        name: createTableName,
        columns: createTableColumns,
      });
    },
    onSuccess: async () => {
      const tableToOpen = createTableName.trim();
      toast.success("テーブルを作成しました。");
      await invalidateObjectQueries();
      replaceSelectionSearch({
        connectionId: targetConnectionId,
        database,
        schema,
        table: tableToOpen,
      });
      setCreateTableName("");
      setCreateTableColumns([defaultCreateColumn()]);
    },
    onError: (error) => toast.error(formatApiError(error)),
  });

  const dropNamedTableMutation = useMutation({
    mutationFn: async (name: string) => {
      if (!targetConnectionId || !database || !schema) {
        throw new Error("接続 / database / schema を選択してください。");
      }
      return workbenchApi.dropTable(targetConnectionId, database, schema, name);
    },
    onSuccess: async (_, droppedName) => {
      toast.success(`${droppedName} を削除しました。`);
      if (droppedName === tableName) {
        setSelection({ table: "" }, { replace: true });
      }
      await invalidateObjectQueries();
    },
    onError: (error) => toast.error(formatApiError(error)),
  });

  const dropSelectedTablesMutation = useMutation({
    mutationFn: async (names: string[]) => {
      if (!targetConnectionId || !database || !schema) {
        throw new Error("接続 / database / schema を選択してください。");
      }
      for (const name of names) {
        await workbenchApi.dropTable(targetConnectionId, database, schema, name);
      }
      return names;
    },
    onSuccess: async (droppedNames) => {
      toast.success(`${droppedNames.length}件のテーブルを削除しました。`);
      setSelectedObjectNames([]);
      setIsBulkDeleteConfirmOpen(false);
      if (tableName && droppedNames.includes(tableName)) {
        setSelection({ table: "" }, { replace: true });
      }
      await invalidateObjectQueries();
    },
    onError: (error) => toast.error(formatApiError(error)),
  });

  const truncateTableMutation = useMutation({
    mutationFn: async () => {
      if (!targetConnectionId || !database || !schema || !tableName) {
        throw new Error("対象テーブルを選択してください。");
      }
      return workbenchApi.truncateTable(targetConnectionId, database, schema, tableName, {
        confirmDangerous: true,
      });
    },
    onSuccess: async () => {
      toast.success("テーブルを空にしました。");
      await invalidateObjectQueries();
    },
    onError: (error) => toast.error(formatApiError(error)),
  });

  const addColumnMutation = useMutation({
    mutationFn: async () => {
      if (!targetConnectionId || !database || !schema || !tableName) {
        throw new Error("対象テーブルを選択してください。");
      }
      return workbenchApi.addColumn(targetConnectionId, database, schema, tableName, addColumnForm);
    },
    onSuccess: async () => {
      toast.success("カラムを追加しました。");
      setAddColumnForm(defaultAddColumn());
      await invalidateObjectQueries();
    },
    onError: (error) => toast.error(formatApiError(error)),
  });

  const dropColumnMutation = useMutation({
    mutationFn: async (columnName: string) => {
      if (!targetConnectionId || !database || !schema || !tableName) {
        throw new Error("対象テーブルを選択してください。");
      }
      return workbenchApi.dropColumn(targetConnectionId, database, schema, tableName, columnName);
    },
    onSuccess: async () => {
      toast.success("カラムを削除しました。");
      await invalidateObjectQueries();
    },
    onError: (error) => toast.error(formatApiError(error)),
  });

  const createIndexMutation = useMutation({
    mutationFn: async () => {
      if (!targetConnectionId || !database || !schema || !tableName) {
        throw new Error("対象テーブルを選択してください。");
      }
      return workbenchApi.createIndex(
        targetConnectionId,
        database,
        schema,
        tableName,
        createIndexForm,
      );
    },
    onSuccess: async () => {
      toast.success("インデックスを作成しました。");
      setCreateIndexForm(defaultCreateIndex());
      await invalidateObjectQueries();
    },
    onError: (error) => toast.error(formatApiError(error)),
  });

  const dropIndexMutation = useMutation({
    mutationFn: async (indexName: string) => {
      if (!targetConnectionId || !database || !schema || !tableName) {
        throw new Error("対象テーブルを選択してください。");
      }
      return workbenchApi.dropIndex(targetConnectionId, database, schema, tableName, indexName);
    },
    onSuccess: async () => {
      toast.success("インデックスを削除しました。");
      await invalidateObjectQueries();
    },
    onError: (error) => toast.error(formatApiError(error)),
  });

  const renameTableMutation = useMutation({
    mutationFn: async () => {
      if (!targetConnectionId || !database || !schema || !tableName) {
        throw new Error("対象テーブルを選択してください。");
      }
      return workbenchApi.renameTable(targetConnectionId, database, schema, tableName, {
        nextName: renameTableName,
      });
    },
    onSuccess: async () => {
      toast.success("テーブル名を変更しました。");
      setSelection({ table: renameTableName }, { replace: true });
      await invalidateObjectQueries();
    },
    onError: (error) => toast.error(formatApiError(error)),
  });

  const importCsvMutation = useMutation({
    mutationFn: async () => {
      if (!targetConnectionId || !database || !schema || !tableName) {
        throw new Error("対象テーブルを選択してください。");
      }
      return workbenchApi.importCsv(targetConnectionId, database, schema, tableName, {
        csv: csvContent,
        delimiter: csvDelimiter,
        truncateBeforeImport,
      });
    },
    onSuccess: async (response) => {
      toast.success(response.result.message);
      setCsvContent("");
      await invalidateObjectQueries();
    },
    onError: (error) => toast.error(formatApiError(error)),
  });

  const saveBookmarkMutation = useMutation({
    mutationFn: async () =>
      sqlBookmarksApi.create({
        name: bookmarkName || `${tableName ?? "table"} definition`,
        sql: bookmarkSql || tableMetadataQuery.data?.metadata.sql || "",
        connectionId: targetConnectionId,
        database,
        schema,
      }),
    onSuccess: () => {
      toast.success("SQL ブックマークを保存しました。");
    },
    onError: (error) => toast.error(formatApiError(error)),
  });

  const insertMutation = useMutation({
    mutationFn: async () => {
      const values = Object.fromEntries(
        (tableMetadataQuery.data?.metadata.columns ?? [])
          .filter((column) => !column.autoIncrement)
          .map((column) => [column.name, parseDraftValue(draftValues[column.name] ?? "", column)])
          .filter((entry) => entry[1] !== undefined),
      );

      return rowsApi.insert(targetConnectionId!, database!, schema!, tableName!, {
        values,
        criteria: {},
      });
    },
    onSuccess: async () => {
      toast.success("行を追加しました。");
      setDraftValues({});
      await invalidateObjectQueries();
    },
    onError: (error) => toast.error(formatApiError(error)),
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!selectedRow) {
        throw new Error("更新対象の行を選択してください。");
      }

      const values = Object.fromEntries(
        (tableMetadataQuery.data?.metadata.columns ?? []).map((column) => [
          column.name,
          parseDraftValue(draftValues[column.name] ?? "", column),
        ]),
      );
      const criteria = Object.fromEntries(
        primaryKeyColumns.map((column) => [column.name, selectedRow[column.name]]),
      );

      return rowsApi.update(targetConnectionId!, database!, schema!, tableName!, {
        values,
        criteria,
      });
    },
    onSuccess: async () => {
      toast.success("行を更新しました。");
      await invalidateObjectQueries();
    },
    onError: (error) => toast.error(formatApiError(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!selectedRow) {
        throw new Error("削除対象の行を選択してください。");
      }
      const criteria = Object.fromEntries(
        primaryKeyColumns.map((column) => [column.name, selectedRow[column.name]]),
      );

      return rowsApi.remove(targetConnectionId!, database!, schema!, tableName!, {
        values: {},
        criteria,
      });
    },
    onSuccess: async () => {
      toast.success("行を削除しました。");
      setSelectedRow(null);
      await invalidateObjectQueries();
    },
    onError: (error) => toast.error(formatApiError(error)),
  });

  const columns: ColumnDef<TableRow>[] =
    rowsQuery.data?.result.columns.map((column) => ({
      accessorKey: column.name,
      header: () => {
        const isSorted = sortColumn === column.name;
        return (
          <button
            className="inline-flex max-w-[240px] items-center gap-1.5 rounded-lg px-1.5 py-1 text-left font-mono text-[11px] font-semibold text-[var(--muted-strong)] transition hover:bg-[var(--panel)] hover:text-[var(--foreground)]"
            onClick={() => toggleSort(column.name)}
            title={`Sort by ${column.name}`}
            type="button"
          >
            <span className="truncate">{column.name}</span>
            <span className="text-[11px] text-[var(--muted-strong)]">
              {isSorted ? (sortDirection === "asc" ? "↑" : "↓") : "↕"}
            </span>
          </button>
        );
      },
      cell: ({ row }) => {
        const value = row.original[column.name];
        if (value == null) {
          return <Badge tone="muted">NULL</Badge>;
        }
        const formatted = stringifyCellValue(value);
        return (
          <span
            className="block max-w-[440px] truncate font-mono text-[12px] text-[var(--foreground)]"
            title={formatted}
          >
            {formatted}
          </span>
        );
      },
    })) ?? [];

  const table = useReactTable({
    data: rowsQuery.data?.result.rows ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const primaryKeyColumns =
    tableMetadataQuery.data?.metadata.columns.filter((column) => column.primaryKey) ?? [];
  const allObjects = objectsQuery.data?.tables ?? [];
  const tables = allObjects.filter((object) => object.type === "table");
  const views = allObjects.filter((object) => object.type === "view");
  const filteredTables = tables.filter((item) =>
    item.name.toLowerCase().includes(databaseFilter.trim().toLowerCase()),
  );
  const filteredViews = views.filter((item) =>
    item.name.toLowerCase().includes(databaseFilter.trim().toLowerCase()),
  );
  const selectedTableRows = tables.filter((item) => selectedObjectNames.includes(item.name));
  const tableRowsTotal = tables.reduce((sum, item) => sum + (item.estimatedRows ?? 0), 0);
  const tableSizeTotal = tables.reduce((sum, item) => sum + (item.sizeBytes ?? 0), 0);
  const totalRows = rowsQuery.data?.result.rowCount ?? 0;
  const currentRows = rowsQuery.data?.result.rows.length ?? 0;
  const totalPages = Math.max(1, Math.ceil((totalRows || 0) / pageSize));
  const pageStart = totalRows === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const pageEnd = totalRows === 0 ? 0 : pageStart + currentRows - 1;
  const hasBrowseFilters = Boolean(globalFilter || rowFilters.length > 0 || sortColumn);
  const tableColumns = tableMetadataQuery.data?.metadata.columns ?? [];
  const tableIndexes = tableMetadataQuery.data?.metadata.indexes ?? [];
  const relatedObjects =
    schemaObjectsQuery.data?.objects.filter(
      (object) => object.relatedTable === tableName || object.name === tableName,
    ) ?? [];
  const canInsertRows = !activeConnection?.readonly;
  const canUpdateRows = !activeConnection?.readonly && primaryKeyColumns.length > 0;
  const canUseTable = Boolean(targetConnectionId && database && schema && tableName);
  const connectionDatabases = connectionDatabasesQuery.data?.databases ?? [];
  const connectionServerInfo = connectionServerInfoQuery.data?.serverInfo ?? null;
  const activeFilterSummary = rowFilters.map(formatRowFilter).join(" AND ");

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  if (!activeConnection) {
    return (
      <EmptyPanel
        title="接続がありません"
        description="接続一覧から DB 接続を作成すると、ここに database / schema / table の内容を表示します。"
      />
    );
  }

  if (pageAction === "create-database") {
    return (
      <div className="space-y-5">
        <ContextSummary
          connectionName={activeConnection.name}
          dbUsersHref={dbUsersHref}
          dbUsersLabel={dbUsersLabel}
          readonly={activeConnection.readonly}
        />

        <section className="app-panel rounded-[30px] p-5">
          <SectionTitle
            action={
              <Link
                to={`/app/table${buildSelectionSearch({
                  connectionId: targetConnectionId,
                })}`}
              >
                <Button variant="secondary">接続ページへ戻る</Button>
              </Link>
            }
            description="CREATE DATABASE を実行します。作成後は新しい database のページへ移動します。"
            icon={Plus}
            title="新しい database を作成"
          />
          <form
            className="mt-5 max-w-2xl space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void createDatabaseMutation.mutateAsync();
            }}
          >
            <Field
              hint={activeConnection.readonly ? "readonly 接続では作成できません。" : undefined}
              label="database 名"
            >
              <TextInput
                autoFocus
                disabled={activeConnection.readonly}
                onChange={(event) => setCreateDatabaseName(event.target.value)}
                placeholder="analytics"
                value={createDatabaseName}
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={
                  createDatabaseMutation.isPending ||
                  !createDatabaseName.trim() ||
                  activeConnection.readonly
                }
                type="submit"
              >
                {createDatabaseMutation.isPending ? "作成中..." : "database を作成"}
              </Button>
              <Link
                to={`/app/sql${buildSelectionSearch({
                  connectionId: targetConnectionId,
                })}`}
              >
                <Button variant="ghost">SQL エディタで作成</Button>
              </Link>
            </div>
          </form>
        </section>
      </div>
    );
  }

  if (pageAction === "create-table") {
    if (!database || !schema) {
      return (
        <EmptyPanel
          title="schema を選択してください"
          description="テーブルを作成するには、先に database と schema を選択してください。"
        />
      );
    }

    return (
      <div className="space-y-5">
        <ContextSummary
          connectionName={activeConnection.name}
          database={database}
          dbUsersHref={dbUsersHref}
          dbUsersLabel={dbUsersLabel}
          readonly={activeConnection.readonly}
          schema={schema}
        />

        <section className="app-panel rounded-[30px] p-5">
          <SectionTitle
            action={
              <Link
                to={`/app/table${buildSelectionSearch({
                  connectionId: targetConnectionId,
                  database,
                  schema,
                })}&section=tables`}
              >
                <Button variant="secondary">テーブル一覧へ戻る</Button>
              </Link>
            }
            description="最低1カラムから作成できます。作成後はそのテーブルへ移動します。"
            icon={Plus}
            title="新しいテーブルを作成"
          />
          <form
            className="mt-5 space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              void createTableMutation.mutateAsync();
            }}
          >
            <Field
              hint={activeConnection.readonly ? "readonly 接続では作成できません。" : undefined}
              label="テーブル名"
            >
              <TextInput
                autoFocus
                disabled={activeConnection.readonly}
                onChange={(event) => setCreateTableName(event.target.value)}
                value={createTableName}
              />
            </Field>
            <div className="grid gap-3 lg:grid-cols-2">
              {createTableColumns.map((column, index) => (
                <div
                  className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4"
                  key={index}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium">カラム {index + 1}</p>
                    {createTableColumns.length > 1 ? (
                      <Button
                        className="px-2 py-1 text-xs"
                        onClick={() =>
                          setCreateTableColumns((current) =>
                            current.filter((_, columnIndex) => columnIndex !== index),
                          )
                        }
                        variant="ghost"
                      >
                        削除
                      </Button>
                    ) : null}
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <Field label="名前">
                      <TextInput
                        disabled={activeConnection.readonly}
                        onChange={(event) =>
                          updateCreateTableColumn(index, { name: event.target.value })
                        }
                        placeholder="id"
                        value={column.name}
                      />
                    </Field>
                    <Field label="型">
                      <TextInput
                        disabled={activeConnection.readonly}
                        onChange={(event) =>
                          updateCreateTableColumn(index, { type: event.target.value })
                        }
                        placeholder="int"
                        value={column.type}
                      />
                    </Field>
                  </div>
                  <div className="mt-3 grid gap-2 md:grid-cols-3">
                    <CheckboxField
                      checked={column.primaryKey}
                      disabled={activeConnection.readonly}
                      label="PRIMARY"
                      onChange={(event) =>
                        updateCreateTableColumn(index, { primaryKey: event.target.checked })
                      }
                    />
                    <CheckboxField
                      checked={column.autoIncrement}
                      disabled={activeConnection.readonly}
                      label="AUTO"
                      onChange={(event) =>
                        updateCreateTableColumn(index, {
                          autoIncrement: event.target.checked,
                        })
                      }
                    />
                    <CheckboxField
                      checked={column.nullable}
                      disabled={activeConnection.readonly}
                      label="NULL"
                      onChange={(event) =>
                        updateCreateTableColumn(index, { nullable: event.target.checked })
                      }
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={activeConnection.readonly}
                onClick={() =>
                  setCreateTableColumns((current) => [...current, defaultCreateColumn()])
                }
                variant="secondary"
              >
                カラムを追加
              </Button>
              <Button
                disabled={
                  activeConnection.readonly ||
                  createTableMutation.isPending ||
                  !createTableName.trim()
                }
                type="submit"
              >
                {createTableMutation.isPending ? "作成中..." : "テーブルを作成"}
              </Button>
            </div>
          </form>
        </section>
      </div>
    );
  }

  if (!database) {
    return (
      <div className="space-y-5">
        <ContextSummary
          connectionName={activeConnection.name}
          dbUsersHref={dbUsersHref}
          dbUsersLabel={dbUsersLabel}
          readonly={activeConnection.readonly}
        />

        <section className="grid gap-5 xl:grid-cols-[0.86fr_1.14fr]">
          <div className="space-y-5">
            <section className="app-panel rounded-3xl p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-[var(--accent)]">
                    <Server className="size-4" />
                    <p className="text-xs font-medium uppercase tracking-[0.18em]">Connection</p>
                  </div>
                  <h3 className="mt-2 text-xl font-semibold tracking-[-0.03em]">
                    {activeConnection.name}
                  </h3>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    {activeConnection.host}:{activeConnection.port} / {activeConnection.username}
                  </p>
                </div>
                <Badge tone={activeConnection.readonly ? "outline" : "success"}>
                  {activeConnection.readonly ? "readonly" : "read-write"}
                </Badge>
              </div>
              <div className="mt-5 grid gap-3">
                <ConnectionInfoRow label="DB種別" value={activeConnection.dialect} />
                <ConnectionInfoRow label="初期 database" value={activeConnection.database || "-"} />
                <ConnectionInfoRow label="SSL" value={activeConnection.useSsl ? "有効" : "無効"} />
                <ConnectionInfoRow
                  label="最終接続"
                  value={formatDateTime(activeConnection.lastConnectedAt)}
                />
                <ConnectionInfoRow
                  label="現在ユーザー"
                  value={connectionServerInfo?.currentUser ?? "-"}
                />
                <ConnectionInfoRow
                  label="現在 schema"
                  value={connectionServerInfo?.schema ?? "-"}
                />
              </div>
              {connectionServerInfoQuery.isError ? (
                <p className="mt-4 rounded-2xl border border-[var(--danger-soft)] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">
                  {formatApiError(connectionServerInfoQuery.error)}
                </p>
              ) : null}
              {connectionServerInfo?.version ? (
                <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--panel-soft)] p-3">
                  <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">version</p>
                  <p className="mt-1 text-xs text-[var(--foreground)]">
                    {connectionServerInfo.version}
                  </p>
                </div>
              ) : null}
            </section>

            <section className="app-panel rounded-3xl p-5">
              <SectionTitle
                description="SQL実行やDBユーザー・権限は、この接続コンテキストを引き継いだ別ページで操作します。"
                icon={FileCode2}
                title="接続の操作"
              />
              <div className="mt-4 grid gap-3">
                <Link
                  className="group rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4 transition hover:border-[var(--accent)] hover:bg-[var(--panel-strong)]"
                  to={`/app/sql${buildSelectionSearch({
                    connectionId: targetConnectionId,
                    database: activeConnection.database || undefined,
                  })}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-[var(--foreground)]">SQL エディタ</p>
                      <p className="mt-1 text-sm text-[var(--muted)]">
                        クエリ実行、履歴、危険SQL確認を専用画面で行う
                      </p>
                    </div>
                    <ArrowRight className="size-4 text-[var(--muted)] transition group-hover:translate-x-1" />
                  </div>
                </Link>
                <Link
                  className="group rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4 transition hover:border-[var(--accent)] hover:bg-[var(--panel-strong)]"
                  to={dbUsersHref ?? "/app/db-users"}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-[var(--foreground)]">{dbUsersLabel}</p>
                      <p className="mt-1 text-sm text-[var(--muted)]">
                        DBユーザー、ロール、GRANT / REVOKE を別ページで管理する
                      </p>
                    </div>
                    <ArrowRight className="size-4 text-[var(--muted)] transition group-hover:translate-x-1" />
                  </div>
                </Link>
              </div>
            </section>
          </div>

          <section className="app-panel rounded-3xl p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-[var(--accent)]">
                  <ListTree className="size-4" />
                  <p className="text-xs font-medium uppercase tracking-[0.18em]">Databases</p>
                </div>
                <h3 className="mt-2 text-lg font-semibold">データベース一覧</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  to={tableActionHref("create-database", {
                    connectionId: targetConnectionId,
                  })}
                >
                  <Button disabled={activeConnection.readonly} variant="secondary">
                    <Plus className="mr-2 size-4" />
                    新しい database
                  </Button>
                </Link>
                <Button
                  disabled={connectionDatabasesQuery.isFetching}
                  onClick={() => void connectionDatabasesQuery.refetch()}
                  variant="ghost"
                >
                  <RefreshCw className="mr-2 size-4" />
                  再読込
                </Button>
              </div>
            </div>

            <div className="mt-4 overflow-hidden rounded-2xl border border-[var(--border)]">
              {connectionDatabasesQuery.isLoading ? (
                <p className="p-4 text-sm text-[var(--muted)]">
                  database 一覧を読み込んでいます...
                </p>
              ) : connectionDatabasesQuery.isError ? (
                <p className="p-4 text-sm text-[var(--danger)]">
                  {formatApiError(connectionDatabasesQuery.error)}
                </p>
              ) : connectionDatabases.length === 0 ? (
                <p className="p-4 text-sm text-[var(--muted)]">database が見つかりません。</p>
              ) : (
                connectionDatabases.map((item) => (
                  <div
                    className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] px-3 py-2 first:border-t-0"
                    key={item.name}
                  >
                    <span className="font-medium">{item.name}</span>
                    <div className="flex items-center gap-1">
                      <Link
                        to={`/app/table${buildSelectionSearch({
                          connectionId: targetConnectionId,
                          database: item.name,
                          schema: isMySqlLike ? item.name : undefined,
                        })}`}
                      >
                        <Button className="px-2.5 py-1.5 text-xs" variant="ghost">
                          <ExternalLink className="mr-1.5 size-3.5" />
                          開く
                        </Button>
                      </Link>
                      <Link
                        to={`/app/sql${buildSelectionSearch({
                          connectionId: targetConnectionId,
                          database: item.name,
                          schema: isMySqlLike ? item.name : undefined,
                        })}`}
                      >
                        <Button className="px-2.5 py-1.5 text-xs" variant="ghost">
                          SQL
                        </Button>
                      </Link>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </section>
      </div>
    );
  }

  if (!tableName) {
    return (
      <div className="space-y-5">
        <ContextSummary
          connectionName={activeConnection.name}
          database={database}
          dbUsersHref={dbUsersHref}
          dbUsersLabel={dbUsersLabel}
          readonly={activeConnection.readonly}
          schema={schema}
        />

        {!schema ? (
          <section className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
            <section className="app-panel rounded-[30px] p-5">
              <SectionTitle
                description="PostgreSQL では database の下に schema がぶら下がります。開きたい schema を選択してください。"
                icon={Layers3}
                title="Schemas"
              />
              {focusedSection === "schemas" ? (
                <Badge className="mt-3" tone="outline">
                  Current Focus
                </Badge>
              ) : null}
              {schemasQuery.isLoading ? (
                <p className="mt-4 text-sm text-[var(--muted)]">schema 一覧を読み込んでいます...</p>
              ) : schemasQuery.isError ? (
                <p className="mt-4 text-sm text-[var(--danger)]">
                  {formatApiError(schemasQuery.error)}
                </p>
              ) : schemasQuery.data?.schemas.length ? (
                <div className="mt-5 grid gap-3 md:grid-cols-2">
                  {schemasQuery.data.schemas.map((schemaItem) => (
                    <Link
                      className="group rounded-[24px] border border-[var(--border)] bg-[var(--panel)] p-4 transition hover:border-[var(--accent)] hover:bg-[var(--panel-strong)]"
                      key={schemaItem.name}
                      to={`/app/table${buildSelectionSearch({
                        connectionId: targetConnectionId,
                        database,
                        schema: schemaItem.name,
                      })}`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-base font-semibold text-[var(--foreground)]">
                            {schemaItem.name}
                          </p>
                          <p className="mt-1 text-sm text-[var(--muted)]">
                            schema 配下の tables / views を開く
                          </p>
                        </div>
                        <ArrowRight className="size-4 text-[var(--muted)] transition group-hover:translate-x-1" />
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="mt-5 rounded-2xl border border-dashed border-[var(--border)] bg-[var(--panel)] p-4 text-sm text-[var(--muted)]">
                  利用可能な schema が見つかりませんでした。
                </div>
              )}
            </section>

            <section className="app-panel rounded-[30px] p-5">
              <SectionTitle
                description="schema を選ぶと、テーブル一覧、データ辞書、新規テーブル作成が有効になります。"
                icon={Database}
                title="Database Context"
              />
              <div className="mt-5 grid gap-3">
                <MetricCard icon={Database} label="Dialect" value={activeConnection.dialect} />
                <MetricCard
                  icon={ShieldAlert}
                  label="Mode"
                  value={activeConnection.readonly ? "Readonly" : "Writable"}
                />
              </div>
              <Link
                className="mt-5 inline-flex items-center rounded-xl border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--panel-strong)]"
                to={`/app/sql${buildSelectionSearch({
                  connectionId: targetConnectionId,
                  database,
                })}`}
              >
                SQL エディタをこの database で開く
              </Link>
            </section>
          </section>
        ) : (
          <div className="space-y-5">
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard icon={Table2} label="Tables" value={formatNumber(tables.length)} />
              <MetricCard icon={Eye} label="Views" value={formatNumber(views.length)} />
              <MetricCard
                icon={Database}
                label="Estimated Rows"
                value={formatNumber(tableRowsTotal)}
              />
              <MetricCard icon={Download} label="Data Size" value={formatBytes(tableSizeTotal)} />
            </section>

            <section className="app-panel overflow-hidden rounded-[30px]">
              <div className="border-b border-[var(--border)] p-5">
                <SectionTitle
                  action={
                    <div className="flex flex-wrap gap-2">
                      <Button
                        disabled={allObjects.length === 0}
                        onClick={() => exportDatabaseDictionary(allObjects)}
                        variant="secondary"
                      >
                        <ClipboardCopy className="mr-2 size-4" />
                        データ辞書
                      </Button>
                      {activeConnection.readonly ? (
                        <Button disabled variant="secondary">
                          <Plus className="mr-2 size-4" />
                          新しいテーブル
                        </Button>
                      ) : (
                        <Link
                          to={tableActionHref("create-table", {
                            connectionId: targetConnectionId,
                            database,
                            schema,
                          })}
                        >
                          <Button variant="secondary">
                            <Plus className="mr-2 size-4" />
                            新しいテーブル
                          </Button>
                        </Link>
                      )}
                      <Link
                        to={`/app/sql${buildSelectionSearch({
                          connectionId: targetConnectionId,
                          database,
                          schema,
                        })}`}
                      >
                        <Button variant="ghost">SQL</Button>
                      </Link>
                    </div>
                  }
                  description="phpMyAdminのDBページ相当です。表示、構造、検索、エクスポート、削除へ直接進めます。"
                  icon={Table2}
                  title="Database Objects"
                />
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <div className="flex min-w-[260px] flex-1 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel-strong)] px-3 py-2 text-sm text-[var(--muted)]">
                    <Search className="size-4" />
                    <input
                      className="min-w-0 flex-1 bg-transparent outline-none"
                      onChange={(event) => setDatabaseFilter(event.target.value)}
                      placeholder="テーブル/ビューをフィルタ"
                      value={databaseFilter}
                    />
                  </div>
                  {selectedObjectNames.length > 0 ? (
                    <Badge tone="outline">選択中 {selectedObjectNames.length}</Badge>
                  ) : null}
                </div>
              </div>
              {objectsQuery.isLoading ? (
                <div className="p-5 text-sm text-[var(--muted)]">
                  object 一覧を読み込んでいます...
                </div>
              ) : objectsQuery.isError ? (
                <div className="p-5 text-sm text-[var(--danger)]">
                  {formatApiError(objectsQuery.error)}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-[var(--panel-soft)] text-[var(--muted)]">
                      <tr>
                        <th className="px-4 py-3">
                          <input
                            checked={
                              filteredTables.length > 0 &&
                              selectedObjectNames.length === filteredTables.length
                            }
                            className="size-4 accent-[var(--accent)]"
                            disabled={filteredTables.length === 0}
                            onChange={(event) =>
                              setSelectedObjectNames(
                                event.target.checked ? filteredTables.map((item) => item.name) : [],
                              )
                            }
                            type="checkbox"
                          />
                        </th>
                        <th className="px-4 py-3">テーブル</th>
                        <th className="px-4 py-3">種別</th>
                        <th className="px-4 py-3">行</th>
                        <th className="px-4 py-3">サイズ</th>
                        <th className="px-4 py-3">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...filteredTables, ...filteredViews].map((item) => (
                        <tr
                          className="border-t border-[var(--border)] hover:bg-[var(--panel-strong)]"
                          key={`${item.type}-${item.name}`}
                        >
                          <td className="px-4 py-3">
                            {item.type === "table" ? (
                              <input
                                checked={selectedObjectNames.includes(item.name)}
                                className="size-4 accent-[var(--accent)]"
                                onChange={(event) =>
                                  toggleObjectName(item.name, event.target.checked)
                                }
                                type="checkbox"
                              />
                            ) : (
                              <div className="size-4" title="view は一括削除の対象外です。" />
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <Link
                              className="font-medium text-[var(--foreground)] hover:text-[var(--accent)]"
                              to={tableHref(targetConnectionId, database, schema, item.name)}
                            >
                              {item.name}
                            </Link>
                            {item.comment ? (
                              <p className="mt-1 text-xs text-[var(--muted)]">{item.comment}</p>
                            ) : null}
                          </td>
                          <td className="px-4 py-3">
                            <Badge tone={item.type === "view" ? "outline" : "muted"}>
                              {item.type}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs">
                            {formatNumber(item.estimatedRows)}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs">
                            {formatBytes(item.sizeBytes)}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-2">
                              <Link
                                to={tableHref(
                                  targetConnectionId,
                                  database,
                                  schema,
                                  item.name,
                                  "browse",
                                )}
                              >
                                <Button className="px-2 py-1 text-xs" variant="ghost">
                                  表示
                                </Button>
                              </Link>
                              <Link
                                to={tableHref(
                                  targetConnectionId,
                                  database,
                                  schema,
                                  item.name,
                                  "structure",
                                )}
                              >
                                <Button className="px-2 py-1 text-xs" variant="ghost">
                                  構造
                                </Button>
                              </Link>
                              <Link
                                to={tableHref(
                                  targetConnectionId,
                                  database,
                                  schema,
                                  item.name,
                                  "search",
                                )}
                              >
                                <Button className="px-2 py-1 text-xs" variant="ghost">
                                  検索
                                </Button>
                              </Link>
                              {item.type === "table" ? (
                                <Button
                                  className="px-2 py-1 text-xs"
                                  disabled={
                                    activeConnection.readonly || dropNamedTableMutation.isPending
                                  }
                                  onClick={() => {
                                    if (!window.confirm(`${item.name} を削除しますか。`)) {
                                      return;
                                    }
                                    void dropNamedTableMutation.mutateAsync(item.name);
                                  }}
                                  variant="danger"
                                >
                                  削除
                                </Button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filteredTables.length === 0 && filteredViews.length === 0 ? (
                    <div className="p-5 text-sm text-[var(--muted)]">
                      条件に一致する object がありません。
                    </div>
                  ) : null}
                </div>
              )}
            </section>

            {selectedObjectNames.length > 0 ? (
              <div className="fixed inset-x-0 bottom-4 z-40 px-4">
                <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--border-strong)] bg-[var(--panel)] px-4 py-3 shadow-[0_18px_48px_var(--shadow-color)]">
                  <div>
                    <p className="text-sm font-semibold">
                      {selectedObjectNames.length}件のテーブルを選択中
                    </p>
                    <p className="text-xs text-[var(--muted)]">
                      {selectedObjectNames.slice(0, 3).join(", ")}
                      {selectedObjectNames.length > 3 ? " ほか" : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => setSelectedObjectNames([])} variant="secondary">
                      選択解除
                    </Button>
                    <Button
                      disabled={activeConnection.readonly || dropSelectedTablesMutation.isPending}
                      onClick={() => setIsBulkDeleteConfirmOpen(true)}
                      variant="danger"
                    >
                      <Trash2 className="mr-2 size-4" />
                      削除
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}

            {isBulkDeleteConfirmOpen ? (
              <div
                aria-modal="true"
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4"
                role="dialog"
              >
                <section className="w-full max-w-lg rounded-[28px] border border-[var(--border)] bg-[var(--panel)] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.28)]">
                  <div className="flex items-start gap-3">
                    <div className="rounded-2xl bg-[var(--danger-soft)] p-2 text-[var(--danger)]">
                      <ShieldAlert className="size-5" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold">選択したテーブルを削除しますか</h3>
                      <p className="mt-1 text-sm text-[var(--muted)]">
                        この操作は取り消せません。対象テーブルを確認してから削除してください。
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 max-h-48 space-y-2 overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--panel-soft)] p-3 text-sm">
                    {selectedTableRows.map((item) => (
                      <div className="flex justify-between gap-3" key={item.name}>
                        <span className="truncate font-medium">{item.name}</span>
                        <span className="shrink-0 font-mono text-xs text-[var(--muted)]">
                          {formatNumber(item.estimatedRows)} rows
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-5 flex flex-wrap justify-end gap-2">
                    <Button
                      disabled={dropSelectedTablesMutation.isPending}
                      onClick={() => setIsBulkDeleteConfirmOpen(false)}
                      variant="secondary"
                    >
                      キャンセル
                    </Button>
                    <Button
                      disabled={dropSelectedTablesMutation.isPending}
                      onClick={() =>
                        void dropSelectedTablesMutation.mutateAsync(selectedObjectNames)
                      }
                      variant="danger"
                    >
                      {dropSelectedTablesMutation.isPending ? "削除中..." : "削除する"}
                    </Button>
                  </div>
                </section>
              </div>
            ) : null}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ContextSummary
        connectionName={activeConnection.name}
        database={database}
        dbUsersHref={dbUsersHref}
        dbUsersLabel={dbUsersLabel}
        readonly={activeConnection.readonly}
        schema={schema}
        tableName={tableName}
      />

      <section className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <MetricCard
          icon={Database}
          label="Rows"
          value={formatNumber(totalRows)}
          hint={`${pageStart}-${pageEnd} 表示中`}
        />
        <MetricCard icon={Columns3} label="Columns" value={formatNumber(tableColumns.length)} />
        <MetricCard icon={KeyRound} label="Indexes" value={formatNumber(tableIndexes.length)} />
        <MetricCard
          icon={Sparkles}
          label="Query"
          value={`${formatNumber(rowsQuery.data?.result.executionTimeMs)}ms`}
        />
      </section>

      <div className="overflow-hidden rounded-[22px] border border-[var(--border)] bg-[var(--panel)] shadow-[0_8px_24px_var(--shadow-color)]">
        <div className="flex items-center gap-1 overflow-x-auto px-2 py-2">
          {tableTabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                aria-current={activeTab === tab.id ? "page" : undefined}
                className={cn(
                  "group relative inline-flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition",
                  activeTab === tab.id
                    ? "bg-[var(--panel-soft)] text-[var(--foreground)] shadow-[inset_0_-2px_0_var(--accent)]"
                    : "text-[var(--muted)] hover:bg-[var(--panel-soft)] hover:text-[var(--foreground)]",
                )}
                key={tab.id}
                onClick={() => selectTab(tab.id)}
                title={tab.label}
                type="button"
              >
                <Icon
                  className={cn(
                    "size-4",
                    activeTab === tab.id
                      ? "text-[var(--accent)]"
                      : "text-[var(--muted)] group-hover:text-[var(--foreground)]",
                  )}
                />
                {tab.shortLabel}
              </button>
            );
          })}
        </div>
      </div>

      {activeTab === "browse" ? (
        <section className="grid gap-5 xl:grid-cols-[1.18fr_0.82fr]">
          <section className="app-panel overflow-hidden rounded-[26px]">
            <div className="border-b border-[var(--border)] bg-[var(--panel)] px-4 py-3">
              <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <div className="flex h-10 min-w-[260px] flex-1 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel-soft)] px-3 text-sm text-[var(--muted)] transition focus-within:border-[var(--accent)] focus-within:bg-[var(--panel)]">
                    <Search className="size-4 shrink-0" />
                    <input
                      className="min-w-0 flex-1 bg-transparent outline-none"
                      onChange={(event) => setGlobalFilter(event.target.value)}
                      placeholder="このテーブルを検索"
                      value={globalFilter}
                    />
                  </div>
                  <Button
                    className="h-10 rounded-xl"
                    onClick={() => setShowFilterStudio((current) => !current)}
                    variant={showFilterStudio || rowFilters.length > 0 ? "primary" : "secondary"}
                  >
                    <Filter className="mr-2 size-4" />
                    Filters
                  </Button>
                  <label className="flex h-10 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel-soft)] px-3 text-sm text-[var(--muted)]">
                    <span className="text-[11px] uppercase tracking-[0.14em]">Rows</span>
                    <select
                      aria-label="表示件数"
                      className="bg-transparent font-medium text-[var(--foreground)] outline-none"
                      onChange={(event) => setPageSize(Number(event.target.value))}
                      value={pageSize}
                    >
                      <option value={25}>25</option>
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                      <option value={250}>250</option>
                    </select>
                  </label>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {selectedRow && primaryKeyColumns.length > 0 ? (
                    <Button
                      className="h-10 rounded-xl"
                      onClick={applySelectedRowFilters}
                      variant="secondary"
                    >
                      <Sparkles className="mr-2 size-4" />
                      選択行をフィルタに変換
                    </Button>
                  ) : null}
                  <Button
                    className="h-10 rounded-xl"
                    disabled={!rowsQuery.data?.result.rows.length}
                    onClick={exportCurrentRows}
                    variant="ghost"
                  >
                    <Download className="mr-2 size-4" />
                    CSV
                  </Button>
                </div>
              </div>
              {hasBrowseFilters || currentPage > 1 || rowsQuery.isFetching ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3">
                  <span className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--muted)]">
                    Active
                  </span>
                  {globalFilter ? <Badge tone="outline">search: {globalFilter}</Badge> : null}
                  {rowFilters.length > 0 ? (
                    <Badge tone="warning">filters: {rowFilters.length}</Badge>
                  ) : null}
                  {sortColumn ? (
                    <Badge tone="muted">
                      sort: {sortColumn} {sortDirection.toUpperCase()}
                    </Badge>
                  ) : null}
                  {rowsQuery.isFetching ? <Badge tone="outline">refreshing...</Badge> : null}
                  <Button
                    className="px-2 py-1 text-xs"
                    onClick={clearBrowseControls}
                    variant="ghost"
                  >
                    すべて解除
                  </Button>
                </div>
              ) : null}
            </div>

            {showFilterStudio ? (
              <div className="border-b border-[var(--border)] bg-[var(--panel-soft)] px-4 py-4">
                <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                  <section className="rounded-[24px] border border-[var(--border)] bg-[var(--panel)] p-4">
                    <SectionTitle
                      description="検索タブや選択行から作成した条件を構造化したままバックエンドへ送ります。"
                      icon={Filter}
                      title="Filter Studio"
                    />
                    <div className="mt-4 space-y-2">
                      {rowFilters.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-[var(--border)] p-4 text-sm text-[var(--muted)]">
                          有効なフィルタはありません。
                        </div>
                      ) : (
                        rowFilters.map((filter, index) => (
                          <div
                            className="rounded-2xl border border-[var(--border)] bg-[var(--panel-soft)] px-3 py-2 text-sm"
                            key={`${filter.column}-${filter.operator}-${index}`}
                          >
                            {formatRowFilter(filter)}
                          </div>
                        ))
                      )}
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button
                        onClick={() => {
                          setRowFilters([]);
                          setCurrentPage(1);
                        }}
                        variant="secondary"
                      >
                        フィルタを解除
                      </Button>
                    </div>
                  </section>
                  <section className="rounded-[24px] border border-[var(--border)] bg-[var(--panel)] p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
                      Sort & Summary
                    </p>
                    <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-1">
                      <Field label="ソート列">
                        <SelectInput
                          onChange={(event) =>
                            setSortColumn(event.target.value ? event.target.value : null)
                          }
                          value={sortColumn ?? ""}
                        >
                          <option value="">自動</option>
                          {(rowsQuery.data?.result.columns ?? []).map((column) => (
                            <option key={column.name} value={column.name}>
                              {column.name}
                            </option>
                          ))}
                        </SelectInput>
                      </Field>
                      <Field label="方向">
                        <SelectInput
                          onChange={(event) =>
                            setSortDirection(event.target.value as "asc" | "desc")
                          }
                          value={sortDirection}
                        >
                          <option value="asc">ASC</option>
                          <option value="desc">DESC</option>
                        </SelectInput>
                      </Field>
                    </div>
                  </section>
                </div>
              </div>
            ) : null}

            {rowsQuery.isLoading ? (
              <div className="px-4 py-8 text-sm text-[var(--muted)]">
                行データを読み込んでいます...
              </div>
            ) : rowsQuery.isError ? (
              <div className="px-4 py-8 text-sm text-[var(--danger)]">
                {formatApiError(rowsQuery.error)}
              </div>
            ) : table.getRowModel().rows.length === 0 ? (
              <div className="px-4 py-8 text-sm text-[var(--muted)]">
                {hasBrowseFilters
                  ? "条件に一致する行がありません。検索条件かフィルタを見直してください。"
                  : "この table に表示できる行がありません。"}
              </div>
            ) : (
              <>
                <div className="overflow-x-auto bg-[var(--panel)]">
                  <table className="min-w-full text-left text-[13px]">
                    <thead className="sticky top-0 z-10 bg-[var(--panel-soft)] text-[var(--muted)] shadow-[0_1px_0_var(--border)]">
                      {table.getHeaderGroups().map((headerGroup) => (
                        <tr key={headerGroup.id}>
                          <th className="w-[132px] border-b border-[var(--border)] px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--muted-strong)]">
                            操作
                          </th>
                          {headerGroup.headers.map((header) => (
                            <th
                              className="border-b border-[var(--border)] px-4 py-2.5 font-medium"
                              key={header.id}
                            >
                              {header.isPlaceholder
                                ? null
                                : flexRender(header.column.columnDef.header, header.getContext())}
                            </th>
                          ))}
                        </tr>
                      ))}
                    </thead>
                    <tbody>
                      {table.getRowModel().rows.map((row) => (
                        <tr
                          className={cn(
                            "cursor-pointer border-b border-[var(--border)] transition-colors",
                            isRowSelected(row.original)
                              ? "bg-[var(--accent-soft)] shadow-[inset_3px_0_0_var(--accent)]"
                              : "hover:bg-[var(--panel-soft)]",
                          )}
                          key={row.id}
                          onClick={() => setSelectedRow(row.original)}
                        >
                          <td className="whitespace-nowrap px-4 py-2.5 align-top">
                            <div className="flex items-center gap-1.5">
                              <button
                                className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-transparent px-2 text-[11px] font-medium text-[var(--muted-strong)] transition hover:border-[var(--border)] hover:bg-[var(--panel)] hover:text-[var(--foreground)]"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setSelectedRow(row.original);
                                }}
                                type="button"
                              >
                                <PencilLine className="size-3.5" />
                                編集
                              </button>
                              <button
                                className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-transparent px-2 text-[11px] font-medium text-[var(--muted-strong)] transition hover:border-[var(--border)] hover:bg-[var(--panel)] hover:text-[var(--foreground)]"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  copyRowToDraft(row.original);
                                }}
                                type="button"
                              >
                                <ClipboardCopy className="size-3.5" />
                                コピー
                              </button>
                            </div>
                          </td>
                          {row.getVisibleCells().map((cell) => (
                            <td className="px-4 py-2.5 align-top" key={cell.id}>
                              {cell.column.columnDef.cell
                                ? flexRender(cell.column.columnDef.cell, cell.getContext())
                                : String(cell.getValue() ?? "")}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-col gap-3 border-t border-[var(--border)] bg-[var(--panel-soft)] px-4 py-3 text-xs text-[var(--muted)] lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-mono font-medium text-[var(--foreground)]">
                      {pageStart}-{pageEnd}
                    </span>
                    <span>/ {formatNumber(totalRows)} rows</span>
                    <span className="hidden h-1 w-1 rounded-full bg-[var(--border-strong)] sm:block" />
                    <span>
                      PK: {primaryKeyColumns.map((column) => column.name).join(", ") || "なし"}
                    </span>
                    <span className="hidden h-1 w-1 rounded-full bg-[var(--border-strong)] sm:block" />
                    <span>
                      Sort: {sortColumn ? `${sortColumn} ${sortDirection.toUpperCase()}` : "自動"}
                    </span>
                    <span className="hidden h-1 w-1 rounded-full bg-[var(--border-strong)] sm:block" />
                    <span>Query: {rowsQuery.data?.result.executionTimeMs ?? "-"}ms</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      className="rounded-xl px-3 py-1.5 text-xs"
                      disabled={currentPage <= 1 || rowsQuery.isFetching}
                      onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                      variant="secondary"
                    >
                      前へ
                    </Button>
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">
                      Page {formatNumber(currentPage)} / {formatNumber(totalPages)}
                    </div>
                    <Button
                      className="rounded-xl px-3 py-1.5 text-xs"
                      disabled={currentPage >= totalPages || rowsQuery.isFetching}
                      onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                      variant="secondary"
                    >
                      次へ
                    </Button>
                  </div>
                </div>
              </>
            )}
          </section>

          <section className="app-panel rounded-[30px] p-5">
            <SectionTitle
              description={
                activeConnection.readonly
                  ? "readonly 接続のため変更できません。"
                  : primaryKeyColumns.length === 0
                    ? "主キーがないため更新・削除はできません。追加のみ可能です。"
                    : "主キーを基準に更新・削除します。"
              }
              icon={ClipboardCopy}
              title={selectedRow ? "選択行を編集" : "新規行を追加"}
            />
            {tableMetadataQuery.isLoading ? (
              <p className="mt-5 text-sm text-[var(--muted)]">column 定義を読み込んでいます...</p>
            ) : tableMetadataQuery.isError ? (
              <p className="mt-5 text-sm text-[var(--danger)]">
                {formatApiError(tableMetadataQuery.error)}
              </p>
            ) : (
              <>
                <div className="mt-5 max-h-[58vh] space-y-4 overflow-y-auto pr-1">
                  {tableColumns.map((column) => (
                    <Field
                      hint={`${column.type}${column.primaryKey ? " / PK" : ""}${column.nullable ? " / nullable" : ""}`}
                      key={column.name}
                      label={column.name}
                    >
                      <TextInput
                        disabled={activeConnection.readonly}
                        onChange={(event) =>
                          setDraftValues((current) => ({
                            ...current,
                            [column.name]: event.target.value,
                          }))
                        }
                        value={draftValues[column.name] ?? ""}
                      />
                    </Field>
                  ))}
                </div>
                <div className="mt-5 flex flex-wrap gap-2">
                  <Button
                    disabled={
                      activeConnection.readonly ||
                      insertMutation.isPending ||
                      updateMutation.isPending ||
                      deleteMutation.isPending ||
                      (Boolean(selectedRow) && !canUpdateRows)
                    }
                    onClick={() => {
                      if (selectedRow) {
                        void updateMutation.mutateAsync();
                        return;
                      }
                      void insertMutation.mutateAsync();
                    }}
                  >
                    {selectedRow ? "行を更新" : "行を追加"}
                  </Button>
                  <Button
                    disabled={!selectedRow || !canUpdateRows || deleteMutation.isPending}
                    onClick={() => {
                      if (!window.confirm("この行を削除しますか。")) {
                        return;
                      }
                      void deleteMutation.mutateAsync();
                    }}
                    variant="danger"
                  >
                    行を削除
                  </Button>
                  <Button
                    onClick={() => {
                      setSelectedRow(null);
                      setDraftValues({});
                    }}
                    variant="secondary"
                  >
                    選択解除
                  </Button>
                </div>
              </>
            )}
          </section>
        </section>
      ) : null}

      {activeTab === "search" ? (
        <section className="app-panel rounded-[30px] p-5">
          <SectionTitle
            description="phpMyAdminのテーブル検索相当です。各カラムの条件を構造化フィルタとして表示タブへ渡します。"
            icon={Search}
            title="テーブル検索"
          />
          <div className="mt-5 overflow-x-auto rounded-[24px] border border-[var(--border)]">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-[var(--panel-soft)] text-[var(--muted)]">
                <tr>
                  <th className="px-4 py-3">カラム</th>
                  <th className="px-4 py-3">タイプ</th>
                  <th className="px-4 py-3">演算子</th>
                  <th className="px-4 py-3">値</th>
                </tr>
              </thead>
              <tbody>
                {tableColumns.map((column) => {
                  const criterion = searchCriteria[column.name] ?? {
                    operator: "contains",
                    value: "",
                  };
                  return (
                    <tr className="border-t border-[var(--border)]" key={column.name}>
                      <td className="px-4 py-3 font-medium">{column.name}</td>
                      <td className="px-4 py-3 font-mono text-xs text-[var(--muted)]">
                        {column.type}
                      </td>
                      <td className="px-4 py-3">
                        <SelectInput
                          onChange={(event) =>
                            patchSearchCriterion(column.name, {
                              operator: event.target.value as SearchOperator,
                            })
                          }
                          value={criterion.operator}
                        >
                          {searchOperators.map((operator) => (
                            <option key={operator.value} value={operator.value}>
                              {operator.label}
                            </option>
                          ))}
                        </SelectInput>
                      </td>
                      <td className="px-4 py-3">
                        <TextInput
                          disabled={
                            criterion.operator === "is-null" || criterion.operator === "not-null"
                          }
                          onChange={(event) =>
                            patchSearchCriterion(column.name, { value: event.target.value })
                          }
                          placeholder={criterion.operator.includes("null") ? "値は不要" : "検索値"}
                          value={criterion.value}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button onClick={applySearchBuilder}>実行</Button>
            <Button
              onClick={() => {
                setSearchCriteria({});
                setRowFilters([]);
              }}
              variant="secondary"
            >
              検索条件をクリア
            </Button>
            <Button onClick={() => setShowFilterStudio(true)} variant="ghost">
              フィルタを確認
            </Button>
          </div>
        </section>
      ) : null}

      {activeTab === "structure" ? (
        <section className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
          <section className="app-panel overflow-hidden rounded-[30px]">
            <div className="border-b border-[var(--border)] p-5">
              <SectionTitle
                description="カラム、キー、NULL、デフォルト値、インデックス操作をまとめて確認します。"
                icon={Columns3}
                title="テーブルの構造"
              />
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-[var(--panel-soft)] text-[var(--muted)]">
                  <tr>
                    <th className="px-4 py-3">#</th>
                    <th className="px-4 py-3">名前</th>
                    <th className="px-4 py-3">タイプ</th>
                    <th className="px-4 py-3">Null</th>
                    <th className="px-4 py-3">デフォルト値</th>
                    <th className="px-4 py-3">その他</th>
                    <th className="px-4 py-3">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {tableColumns.map((column, index) => (
                    <tr className="border-t border-[var(--border)]" key={column.name}>
                      <td className="px-4 py-3 font-mono text-xs">{index + 1}</td>
                      <td className="px-4 py-3 font-semibold">
                        {column.name}
                        {column.primaryKey ? (
                          <Badge className="ml-2" tone="warning">
                            PK
                          </Badge>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{column.type}</td>
                      <td className="px-4 py-3">{column.nullable ? "はい" : "いいえ"}</td>
                      <td className="px-4 py-3">{column.defaultValue ?? "なし"}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          {column.autoIncrement ? <Badge tone="muted">AUTO_INCREMENT</Badge> : null}
                          {column.comment ? <Badge tone="outline">{column.comment}</Badge> : null}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <Button
                            className="px-2 py-1 text-xs"
                            onClick={() => selectTab("search")}
                            variant="ghost"
                          >
                            表示
                          </Button>
                          <Button
                            className="px-2 py-1 text-xs"
                            disabled={activeConnection.readonly || dropColumnMutation.isPending}
                            onClick={() => {
                              if (!window.confirm(`${column.name} カラムを削除しますか。`)) {
                                return;
                              }
                              void dropColumnMutation.mutateAsync(column.name);
                            }}
                            variant="danger"
                          >
                            削除
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <div className="space-y-5">
            <section className="app-panel rounded-[30px] p-5">
              <SectionTitle
                description="既存カラムの後ろへ追加します。型とNULLだけの最小編集に絞っています。"
                icon={Plus}
                title="カラムを追加"
              />
              <div className="mt-4 grid gap-4">
                <Field label="名前">
                  <TextInput
                    onChange={(event) =>
                      setAddColumnForm((current) => ({ ...current, name: event.target.value }))
                    }
                    value={addColumnForm.name}
                  />
                </Field>
                <Field label="型">
                  <TextInput
                    onChange={(event) =>
                      setAddColumnForm((current) => ({ ...current, type: event.target.value }))
                    }
                    value={addColumnForm.type}
                  />
                </Field>
                <Field label="デフォルト値">
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
                <CheckboxField
                  checked={addColumnForm.nullable}
                  label="NULLを許可"
                  onChange={(event) =>
                    setAddColumnForm((current) => ({ ...current, nullable: event.target.checked }))
                  }
                />
                <Button
                  disabled={activeConnection.readonly || addColumnMutation.isPending}
                  onClick={() => void addColumnMutation.mutateAsync()}
                >
                  カラムを追加
                </Button>
              </div>
            </section>

            <section className="app-panel rounded-[30px] p-5">
              <SectionTitle
                description="PRIMARY / UNIQUE / BTREE など、adapterが取得できる情報を表示します。"
                icon={KeyRound}
                title="インデックス"
              />
              <div className="mt-4 space-y-3">
                {tableIndexes.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-[var(--border)] p-4 text-sm text-[var(--muted)]">
                    インデックスはありません。
                  </div>
                ) : (
                  tableIndexes.map((index) => (
                    <div
                      className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-3"
                      key={index.name}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="font-medium">{index.name}</p>
                          <p className="mt-1 text-xs text-[var(--muted)]">
                            {index.columns.join(", ")}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {index.primary ? <Badge tone="warning">PRIMARY</Badge> : null}
                          {index.unique ? <Badge tone="success">UNIQUE</Badge> : null}
                          <Badge tone="muted">{index.type}</Badge>
                          {!index.primary ? (
                            <Button
                              className="px-2 py-1 text-xs"
                              disabled={activeConnection.readonly || dropIndexMutation.isPending}
                              onClick={() => {
                                if (!window.confirm(`${index.name} を削除しますか。`)) {
                                  return;
                                }
                                void dropIndexMutation.mutateAsync(index.name);
                              }}
                              variant="danger"
                            >
                              削除
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
              <div className="mt-5 space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4">
                <p className="text-sm font-medium">インデックスを作成</p>
                <Field label="名前">
                  <TextInput
                    onChange={(event) =>
                      setCreateIndexForm((current) => ({ ...current, name: event.target.value }))
                    }
                    value={createIndexForm.name}
                  />
                </Field>
                <Field hint="カンマ区切りで指定します。" label="カラム">
                  <TextInput
                    onChange={(event) =>
                      setCreateIndexForm((current) => ({
                        ...current,
                        columns: event.target.value
                          .split(",")
                          .map((item) => item.trim())
                          .filter(Boolean),
                      }))
                    }
                    value={createIndexForm.columns.join(", ")}
                  />
                </Field>
                <CheckboxField
                  checked={createIndexForm.unique}
                  label="UNIQUE"
                  onChange={(event) =>
                    setCreateIndexForm((current) => ({ ...current, unique: event.target.checked }))
                  }
                />
                <Button
                  disabled={activeConnection.readonly || createIndexMutation.isPending}
                  onClick={() => void createIndexMutation.mutateAsync()}
                >
                  作成
                </Button>
              </div>
            </section>
          </div>
        </section>
      ) : null}

      {activeTab === "objects" ? (
        <section className="app-panel rounded-[30px] p-5">
          <SectionTitle
            description="テーブルに関連するトリガ、ルーチン、イベント、ビューを表示します。編集はSQLエディタで行います。"
            icon={Layers3}
            title="ルーチン / イベント / トリガ"
          />
          <div className="mt-5 grid gap-3">
            {relatedObjects.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[var(--border)] p-4 text-sm text-[var(--muted)]">
                このテーブルに紐づく object は見つかりませんでした。
              </div>
            ) : (
              relatedObjects.map((object) => (
                <article
                  className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4"
                  key={object.id}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">{object.name}</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        {object.kind} / {object.relatedTable ?? "-"} / updated{" "}
                        {formatDateTime(object.updatedAt)}
                      </p>
                    </div>
                    <Badge tone="outline">{object.kind}</Badge>
                  </div>
                  {object.definition ? (
                    <pre className="mt-3 max-h-64 overflow-auto rounded-2xl border border-[var(--border)] bg-[var(--panel-soft)] p-3 text-xs">
                      {object.definition}
                    </pre>
                  ) : null}
                </article>
              ))
            )}
          </div>
        </section>
      ) : null}

      {activeTab === "export" ? (
        <section className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
          <section className="app-panel rounded-[30px] p-5">
            <SectionTitle
              description="現在ページだけでなく、バックエンド経由でテーブル全体も出力できます。"
              icon={Download}
              title="エクスポート"
            />
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <Button
                disabled={!rowsQuery.data?.result.rows.length}
                onClick={exportCurrentRows}
                variant="secondary"
              >
                現在ページ CSV
              </Button>
              {[
                ["csv", "全件 CSV"],
                ["json", "JSON"],
                ["insert_sql", "INSERT SQL"],
                ["table_sql", "CREATE SQL"],
              ].map(([format, label]) => (
                <Button
                  disabled={!canUseTable}
                  key={format}
                  onClick={() =>
                    void exportTable(format as "csv" | "json" | "insert_sql" | "table_sql")
                  }
                  variant="secondary"
                >
                  {label}
                </Button>
              ))}
            </div>
          </section>

          <section className="app-panel rounded-[30px] p-5">
            <SectionTitle
              description="1行目をヘッダーとして扱い、現在のテーブルへ一括取り込みします。"
              icon={Upload}
              title="CSV インポート"
            />
            <div className="mt-5 space-y-4">
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
                hint="取込前にテーブル内容を消します。危険な操作です。"
                label="既存データを truncate してから import"
                onChange={(event) => setTruncateBeforeImport(event.target.checked)}
              />
              <Field label="CSV content">
                <TextArea
                  className="min-h-[260px] font-mono text-xs"
                  onChange={(event) => setCsvContent(event.target.value)}
                  placeholder="id,name&#10;1,alpha&#10;2,beta"
                  value={csvContent}
                />
              </Field>
              <Button
                disabled={
                  activeConnection.readonly ||
                  importCsvMutation.isPending ||
                  !canUseTable ||
                  !csvContent.trim()
                }
                onClick={() => void importCsvMutation.mutateAsync()}
              >
                Import CSV
              </Button>
            </div>
          </section>
        </section>
      ) : null}

      {activeTab === "operations" ? (
        <section className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
          <section className="app-panel rounded-[30px] p-5">
            <SectionTitle
              description="名前変更、削除、空にするSQLの生成など、phpMyAdminの操作タブ相当です。"
              icon={WandSparkles}
              title="テーブル操作"
            />
            <div className="mt-5 space-y-4">
              <Field label="テーブル名を変更">
                <TextInput
                  onChange={(event) => setRenameTableName(event.target.value)}
                  value={renameTableName}
                />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={
                    activeConnection.readonly ||
                    renameTableMutation.isPending ||
                    !renameTableName.trim()
                  }
                  onClick={() => void renameTableMutation.mutateAsync()}
                >
                  名前を変更
                </Button>
                <Button
                  disabled={activeConnection.readonly || dropNamedTableMutation.isPending}
                  onClick={() => {
                    if (!window.confirm(`${tableName} を削除しますか。`)) {
                      return;
                    }
                    void dropNamedTableMutation.mutateAsync(tableName);
                  }}
                  variant="danger"
                >
                  <Trash2 className="mr-2 size-4" />
                  テーブルを削除
                </Button>
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel-soft)] p-4">
                <div className="flex items-center gap-2 text-[var(--danger)]">
                  <ShieldAlert className="size-4" />
                  <p className="text-sm font-medium text-[var(--foreground)]">テーブルを空にする</p>
                </div>
                <p className="mt-2 text-sm text-[var(--muted)]">
                  バックエンドの専用エンドポイントで実行します。操作前に確認ダイアログを表示します。
                </p>
                <Button
                  className="mt-3"
                  disabled={activeConnection.readonly || truncateTableMutation.isPending}
                  onClick={() => {
                    if (!window.confirm(`${tableName} の全行を削除しますか。`)) {
                      return;
                    }
                    void truncateTableMutation.mutateAsync();
                  }}
                  variant="danger"
                >
                  <ShieldAlert className="mr-2 size-4" />
                  {truncateTableMutation.isPending ? "実行中..." : "テーブルを空にする"}
                </Button>
              </div>
            </div>
          </section>

          <section className="app-panel rounded-[30px] p-5">
            <SectionTitle
              description="CREATE文を確認し、SQLブックマークとして保存できます。"
              icon={Bookmark}
              title="このSQLをブックマーク"
            />
            <div className="mt-5 space-y-4">
              <Field label="ラベル">
                <TextInput
                  onChange={(event) => setBookmarkName(event.target.value)}
                  value={bookmarkName}
                />
              </Field>
              <Field label="SQL">
                <TextArea
                  className="min-h-[300px] font-mono text-xs"
                  onChange={(event) => setBookmarkSql(event.target.value)}
                  value={bookmarkSql || tableMetadataQuery.data?.metadata.sql || ""}
                />
              </Field>
              <Button
                disabled={
                  saveBookmarkMutation.isPending ||
                  !(bookmarkSql || tableMetadataQuery.data?.metadata.sql)
                }
                onClick={() => void saveBookmarkMutation.mutateAsync()}
              >
                保存
              </Button>
            </div>
          </section>
        </section>
      ) : null}

      {activeTab === "sql" ? (
        <section className="app-panel rounded-[30px] p-5">
          <SectionTitle
            description="テーブル定義を確認できます。実行はSQLエディタへ移動して行います。"
            icon={FileCode2}
            title="SQL"
          />
          {tableMetadataQuery.isLoading ? (
            <p className="mt-4 text-sm text-[var(--muted)]">SQLを読み込んでいます...</p>
          ) : tableMetadataQuery.isError ? (
            <p className="mt-4 text-sm text-[var(--danger)]">
              {formatApiError(tableMetadataQuery.error)}
            </p>
          ) : (
            <pre className="mt-5 max-h-[60vh] overflow-auto rounded-[24px] border border-[var(--border)] bg-[var(--panel-soft)] p-4 text-xs">
              {tableMetadataQuery.data?.metadata.sql ?? "-- SQLがありません"}
            </pre>
          )}
          <Link
            className="mt-4 inline-flex"
            to={`/app/sql${buildSelectionSearch({
              connectionId: targetConnectionId,
              database,
              schema,
              table: tableName,
            })}`}
          >
            <Button variant="secondary">SQLエディタを開く</Button>
          </Link>
        </section>
      ) : null}

      {activeTab === "info" ? (
        <section className="grid gap-5 xl:grid-cols-3">
          <MetricCard
            icon={Database}
            label="Connection"
            value={activeConnection.name}
            hint={activeConnection.dialect}
          />
          <MetricCard
            icon={Table2}
            label="Table"
            value={tableName}
            hint={`${database}.${schema}`}
          />
          <MetricCard
            icon={ShieldAlert}
            label="Mutation"
            value={activeConnection.readonly ? "Blocked" : "Allowed"}
            hint={`insert ${canInsertRows ? "yes" : "no"} / update ${canUpdateRows ? "yes" : "no"}`}
          />
          <section className="app-panel rounded-[30px] p-5 xl:col-span-3">
            <SectionTitle
              description="パーティション、ディスク使用量、次の自動付番などはadapterの取得情報が増えたらここへ展開します。"
              icon={Database}
              title="テーブル情報"
            />
            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
                  Primary key
                </p>
                <p className="mt-2 text-sm font-medium">
                  {primaryKeyColumns.map((column) => column.name).join(", ") || "なし"}
                </p>
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Indexes</p>
                <p className="mt-2 text-sm font-medium">
                  {tableIndexes.map((index) => index.name).join(", ") || "なし"}
                </p>
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Filters</p>
                <p className="mt-2 text-sm font-medium">{activeFilterSummary || "なし"}</p>
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Partition</p>
                <p className="mt-2 text-sm font-medium">未定義または未取得</p>
              </div>
            </div>
          </section>
        </section>
      ) : null}
    </div>
  );
}
