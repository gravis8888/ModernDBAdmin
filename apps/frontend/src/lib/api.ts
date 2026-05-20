import type {
  AddColumnInput,
  AppPermission,
  AppRole,
  AppUser,
  AuditLogEntry,
  AuthLoginInput,
  AuthSetupInput,
  ColumnInfo,
  ConnectionFormInput,
  ConnectionSummary,
  CreateDatabaseInput,
  CreateIndexInput,
  CreateTableInput,
  DatabaseInfo,
  DatabaseObjectInfo,
  DatabasePrivilege,
  DatabasePrivilegeMutationInput,
  DatabaseUser,
  DatabaseUserCreateInput,
  DatabaseUserUpdateInput,
  ExecuteSqlInput,
  ImportCsvInput,
  IndexInfo,
  ListRowsQueryInput,
  MutationResult,
  QueryExecutionResult,
  QueryResult,
  RowMutationInput,
  SchemaInfo,
  ServerMetricInfo,
  ServerSessionInfo,
  ServerInfo,
  ServerVariableInfo,
  SessionUser,
  SqlBookmark,
  TableInfo,
  TableMetadata,
  TruncateTableInput,
} from "@modern-db-admin/shared";

type PrimitiveQueryValue = string | number | boolean | null | undefined;

type ApiRequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
  query?: Record<string, PrimitiveQueryValue>;
};

type ApiErrorPayload = {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
};

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();

export type DashboardResponse = {
  summary: {
    connectionCount: number;
    appUserCount: number;
    appRoleCount: number;
    activeConnectionCount: number;
  };
  recentAuditLogs: AuditLogEntry[];
};

export type AuthStatusResponse = {
  setupCompleted: boolean;
};

export type AuthMeResponse = {
  setupCompleted: boolean;
  user: SessionUser;
};

export type SqlExecutionResponse = {
  analysis: {
    statements: string[];
    statementTypes: string[];
    requiredPermission: AppPermission;
    dangerous: boolean;
  };
  result: QueryExecutionResult;
};

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

function buildUrl(path: string, query?: Record<string, PrimitiveQueryValue>) {
  const url = new URL(path, apiBaseUrl || window.location.origin);

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value == null || value === "") {
      continue;
    }
    url.searchParams.set(key, String(value));
  }

  return apiBaseUrl ? url.toString() : `${url.pathname}${url.search}`;
}

export async function apiFetch<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { body, query, ...requestOptions } = options;
  const headers = new Headers(requestOptions.headers);
  const requestInit: RequestInit = {
    ...requestOptions,
    credentials: "include",
    headers,
  };

  if (body !== undefined) {
    headers.set("Content-Type", "application/json");
    requestInit.body = JSON.stringify(body);
  }

  const response = await fetch(buildUrl(path, query), requestInit);
  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? ((await response.json()) as unknown)
    : null;

  if (!response.ok) {
    const apiError = payload as ApiErrorPayload | null;
    throw new ApiClientError(
      response.status,
      apiError?.error?.code ?? "HTTP_ERROR",
      apiError?.error?.message ?? "リクエストに失敗しました。",
      apiError?.error?.details,
    );
  }

  return payload as T;
}

export function formatApiError(error: unknown) {
  if (error instanceof ApiClientError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "不明なエラーが発生しました。";
}

export const authApi = {
  status: () => apiFetch<AuthStatusResponse>("/api/auth/status"),
  me: () => apiFetch<AuthMeResponse>("/api/auth/me"),
  login: (input: AuthLoginInput) =>
    apiFetch<{ user: SessionUser }>("/api/auth/login", {
      method: "POST",
      body: input,
    }),
  setup: (input: AuthSetupInput) =>
    apiFetch<{ setupCompleted: boolean; user: SessionUser }>("/api/auth/setup", {
      method: "POST",
      body: input,
    }),
  logout: () =>
    apiFetch<{ ok: boolean }>("/api/auth/logout", {
      method: "POST",
    }),
};

export const dashboardApi = {
  get: () => apiFetch<DashboardResponse>("/api/dashboard"),
};

export const connectionsApi = {
  list: () => apiFetch<{ connections: ConnectionSummary[] }>("/api/connections"),
  create: (input: ConnectionFormInput) =>
    apiFetch<{ connection: ConnectionSummary }>("/api/connections", {
      method: "POST",
      body: input,
    }),
  update: (connectionId: string, input: ConnectionFormInput) =>
    apiFetch<{ connection: ConnectionSummary }>(`/api/connections/${connectionId}`, {
      method: "PUT",
      body: input,
    }),
  remove: (connectionId: string) =>
    apiFetch<{ ok: boolean }>(`/api/connections/${connectionId}`, {
      method: "DELETE",
    }),
  test: (connectionId: string) =>
    apiFetch<{ serverInfo: ServerInfo }>(`/api/connections/${connectionId}/test`, {
      method: "POST",
    }),
};

export const metadataApi = {
  serverInfo: (connectionId: string) =>
    apiFetch<{ serverInfo: ServerInfo }>(`/api/connections/${connectionId}/server-info`),
  databases: (connectionId: string) =>
    apiFetch<{ databases: DatabaseInfo[] }>(`/api/connections/${connectionId}/databases`),
  schemas: (connectionId: string, database: string) =>
    apiFetch<{ schemas: SchemaInfo[] }>(
      `/api/connections/${connectionId}/databases/${encodeURIComponent(database)}/schemas`,
    ),
  tables: (connectionId: string, database: string, schema: string) =>
    apiFetch<{ tables: TableInfo[] }>(
      `/api/connections/${connectionId}/databases/${encodeURIComponent(database)}/schemas/${encodeURIComponent(schema)}/tables`,
    ),
  columns: (connectionId: string, database: string, schema: string, table: string) =>
    apiFetch<{ columns: ColumnInfo[] }>(
      `/api/connections/${connectionId}/databases/${encodeURIComponent(database)}/schemas/${encodeURIComponent(schema)}/tables/${encodeURIComponent(table)}/columns`,
    ),
  indexes: (connectionId: string, database: string, schema: string, table: string) =>
    apiFetch<{ indexes: IndexInfo[] }>(
      `/api/connections/${connectionId}/databases/${encodeURIComponent(database)}/schemas/${encodeURIComponent(schema)}/tables/${encodeURIComponent(table)}/indexes`,
    ),
  tableMetadata: (connectionId: string, database: string, schema: string, table: string) =>
    apiFetch<{ metadata: TableMetadata }>(
      `/api/connections/${connectionId}/databases/${encodeURIComponent(database)}/schemas/${encodeURIComponent(schema)}/tables/${encodeURIComponent(table)}/metadata`,
    ),
  objects: (connectionId: string, database: string, schema: string) =>
    apiFetch<{ objects: DatabaseObjectInfo[] }>(
      `/api/connections/${connectionId}/databases/${encodeURIComponent(database)}/schemas/${encodeURIComponent(schema)}/objects`,
    ),
  createSql: (connectionId: string, database: string, schema: string, table: string) =>
    apiFetch<{ sql: string }>(
      `/api/connections/${connectionId}/databases/${encodeURIComponent(database)}/schemas/${encodeURIComponent(schema)}/tables/${encodeURIComponent(table)}/create-sql`,
    ),
};

export const rowsApi = {
  list: (
    connectionId: string,
    database: string,
    schema: string,
    table: string,
    query: ListRowsQueryInput,
  ) => {
    const { filters, ...queryParams } = query;
    return apiFetch<{ result: QueryResult }>(
      `/api/connections/${connectionId}/databases/${encodeURIComponent(database)}/schemas/${encodeURIComponent(schema)}/tables/${encodeURIComponent(table)}/rows`,
      {
        query: {
          ...queryParams,
          filters: filters?.length ? JSON.stringify(filters) : undefined,
        },
      },
    );
  },
  insert: (
    connectionId: string,
    database: string,
    schema: string,
    table: string,
    input: RowMutationInput,
  ) =>
    apiFetch<{ result: MutationResult }>(
      `/api/connections/${connectionId}/databases/${encodeURIComponent(database)}/schemas/${encodeURIComponent(schema)}/tables/${encodeURIComponent(table)}/rows`,
      {
        method: "POST",
        body: input,
      },
    ),
  update: (
    connectionId: string,
    database: string,
    schema: string,
    table: string,
    input: RowMutationInput,
  ) =>
    apiFetch<{ result: MutationResult }>(
      `/api/connections/${connectionId}/databases/${encodeURIComponent(database)}/schemas/${encodeURIComponent(schema)}/tables/${encodeURIComponent(table)}/rows`,
      {
        method: "PUT",
        body: input,
      },
    ),
  remove: (
    connectionId: string,
    database: string,
    schema: string,
    table: string,
    input: RowMutationInput,
  ) =>
    apiFetch<{ result: MutationResult }>(
      `/api/connections/${connectionId}/databases/${encodeURIComponent(database)}/schemas/${encodeURIComponent(schema)}/tables/${encodeURIComponent(table)}/rows`,
      {
        method: "DELETE",
        body: input,
      },
    ),
};

export const queryApi = {
  execute: (connectionId: string, input: ExecuteSqlInput) =>
    apiFetch<SqlExecutionResponse>(`/api/connections/${connectionId}/query`, {
      method: "POST",
      body: input,
    }),
};

export const workbenchApi = {
  createDatabase: (connectionId: string, input: CreateDatabaseInput) =>
    apiFetch<{ result: MutationResult }>(`/api/connections/${connectionId}/databases`, {
      method: "POST",
      body: input,
    }),
  exportTable: (
    connectionId: string,
    database: string,
    schema: string,
    table: string,
    format: "csv" | "json" | "insert_sql" | "table_sql",
  ) =>
    apiFetch<{ content: string; contentType: string; fileName: string }>(
      `/api/connections/${connectionId}/databases/${encodeURIComponent(database)}/schemas/${encodeURIComponent(schema)}/tables/${encodeURIComponent(table)}/export`,
      {
        query: { format },
      },
    ),
  createTable: (connectionId: string, database: string, schema: string, input: CreateTableInput) =>
    apiFetch<{ result: MutationResult }>(
      `/api/connections/${connectionId}/databases/${encodeURIComponent(database)}/schemas/${encodeURIComponent(schema)}/structure/tables`,
      {
        method: "POST",
        body: input,
      },
    ),
  renameTable: (
    connectionId: string,
    database: string,
    schema: string,
    table: string,
    input: { nextName: string },
  ) =>
    apiFetch<{ result: MutationResult }>(
      `/api/connections/${connectionId}/databases/${encodeURIComponent(database)}/schemas/${encodeURIComponent(schema)}/tables/${encodeURIComponent(table)}/rename`,
      {
        method: "POST",
        body: input,
      },
    ),
  dropTable: (connectionId: string, database: string, schema: string, table: string) =>
    apiFetch<{ result: MutationResult }>(
      `/api/connections/${connectionId}/databases/${encodeURIComponent(database)}/schemas/${encodeURIComponent(schema)}/tables/${encodeURIComponent(table)}`,
      {
        method: "DELETE",
      },
    ),
  truncateTable: (
    connectionId: string,
    database: string,
    schema: string,
    table: string,
    input: TruncateTableInput,
  ) =>
    apiFetch<{ result: MutationResult }>(
      `/api/connections/${connectionId}/databases/${encodeURIComponent(database)}/schemas/${encodeURIComponent(schema)}/tables/${encodeURIComponent(table)}/truncate`,
      {
        method: "POST",
        body: input,
      },
    ),
  addColumn: (
    connectionId: string,
    database: string,
    schema: string,
    table: string,
    input: AddColumnInput,
  ) =>
    apiFetch<{ result: MutationResult }>(
      `/api/connections/${connectionId}/databases/${encodeURIComponent(database)}/schemas/${encodeURIComponent(schema)}/tables/${encodeURIComponent(table)}/columns`,
      {
        method: "POST",
        body: input,
      },
    ),
  dropColumn: (
    connectionId: string,
    database: string,
    schema: string,
    table: string,
    column: string,
  ) =>
    apiFetch<{ result: MutationResult }>(
      `/api/connections/${connectionId}/databases/${encodeURIComponent(database)}/schemas/${encodeURIComponent(schema)}/tables/${encodeURIComponent(table)}/columns/${encodeURIComponent(column)}`,
      {
        method: "DELETE",
      },
    ),
  createIndex: (
    connectionId: string,
    database: string,
    schema: string,
    table: string,
    input: CreateIndexInput,
  ) =>
    apiFetch<{ result: MutationResult }>(
      `/api/connections/${connectionId}/databases/${encodeURIComponent(database)}/schemas/${encodeURIComponent(schema)}/tables/${encodeURIComponent(table)}/indexes`,
      {
        method: "POST",
        body: input,
      },
    ),
  dropIndex: (
    connectionId: string,
    database: string,
    schema: string,
    table: string,
    index: string,
  ) =>
    apiFetch<{ result: MutationResult }>(
      `/api/connections/${connectionId}/databases/${encodeURIComponent(database)}/schemas/${encodeURIComponent(schema)}/tables/${encodeURIComponent(table)}/indexes/${encodeURIComponent(index)}`,
      {
        method: "DELETE",
      },
    ),
  importCsv: (
    connectionId: string,
    database: string,
    schema: string,
    table: string,
    input: ImportCsvInput,
  ) =>
    apiFetch<{ result: MutationResult }>(
      `/api/connections/${connectionId}/databases/${encodeURIComponent(database)}/schemas/${encodeURIComponent(schema)}/tables/${encodeURIComponent(table)}/import/csv`,
      {
        method: "POST",
        body: input,
      },
    ),
};

export const monitorApi = {
  sessions: (connectionId: string, database?: string) =>
    apiFetch<{ sessions: ServerSessionInfo[] }>(
      `/api/connections/${connectionId}/monitor/sessions`,
      {
        query: { database },
      },
    ),
  variables: (connectionId: string, database?: string) =>
    apiFetch<{ variables: ServerVariableInfo[] }>(
      `/api/connections/${connectionId}/monitor/variables`,
      {
        query: { database },
      },
    ),
  metrics: (connectionId: string, database?: string) =>
    apiFetch<{ metrics: ServerMetricInfo[] }>(`/api/connections/${connectionId}/monitor/metrics`, {
      query: { database },
    }),
};

export const sqlBookmarksApi = {
  list: (query?: { connectionId?: string; database?: string; schema?: string }) =>
    apiFetch<{ bookmarks: SqlBookmark[] }>("/api/sql-bookmarks", {
      query,
    }),
  create: (input: {
    name: string;
    sql: string;
    connectionId?: string;
    database?: string;
    schema?: string;
  }) =>
    apiFetch<{ bookmark: SqlBookmark | null }>("/api/sql-bookmarks", {
      method: "POST",
      body: input,
    }),
  update: (
    bookmarkId: string,
    input: {
      name?: string;
      sql?: string;
      connectionId?: string;
      database?: string;
      schema?: string;
    },
  ) =>
    apiFetch<{ bookmark: SqlBookmark | null }>(`/api/sql-bookmarks/${bookmarkId}`, {
      method: "PUT",
      body: input,
    }),
  remove: (bookmarkId: string) =>
    apiFetch<{ ok: boolean }>(`/api/sql-bookmarks/${bookmarkId}`, {
      method: "DELETE",
    }),
};

export const appUsersApi = {
  list: () => apiFetch<{ users: AppUser[] }>("/api/app-users"),
  create: (input: {
    username: string;
    email: string;
    password: string;
    roleIds: string[];
    enabled: boolean;
  }) =>
    apiFetch<{ user: AppUser }>("/api/app-users", {
      method: "POST",
      body: input,
    }),
  update: (
    userId: string,
    input: {
      username?: string;
      email?: string;
      password?: string;
      roleIds?: string[];
      enabled?: boolean;
    },
  ) =>
    apiFetch<{ user: AppUser | null }>(`/api/app-users/${userId}`, {
      method: "PUT",
      body: input,
    }),
  remove: (userId: string) =>
    apiFetch<{ ok: boolean }>(`/api/app-users/${userId}`, {
      method: "DELETE",
    }),
};

export const appRolesApi = {
  list: () =>
    apiFetch<{
      roles: AppRole[];
      permissions: Array<{ id: string; key: AppPermission; label: string; category: string }>;
    }>("/api/app-roles"),
  create: (input: { name: string; description: string; permissionKeys: AppPermission[] }) =>
    apiFetch<{ role: AppRole | null }>("/api/app-roles", {
      method: "POST",
      body: input,
    }),
  update: (
    roleId: string,
    input: { name?: string; description?: string; permissionKeys?: AppPermission[] },
  ) =>
    apiFetch<{ role: AppRole | null }>(`/api/app-roles/${roleId}`, {
      method: "PUT",
      body: input,
    }),
  remove: (roleId: string) =>
    apiFetch<{ ok: boolean }>(`/api/app-roles/${roleId}`, {
      method: "DELETE",
    }),
};

export const dbUsersApi = {
  list: (connectionId: string) =>
    apiFetch<{ users: DatabaseUser[] }>(`/api/connections/${connectionId}/db-users`),
  create: (connectionId: string, input: DatabaseUserCreateInput) =>
    apiFetch<{ result: MutationResult }>(`/api/connections/${connectionId}/db-users`, {
      method: "POST",
      body: input,
    }),
  update: (connectionId: string, dbUserId: string, input: DatabaseUserUpdateInput) =>
    apiFetch<{ result: MutationResult }>(
      `/api/connections/${connectionId}/db-users/${encodeURIComponent(dbUserId)}`,
      {
        method: "PUT",
        body: input,
      },
    ),
  remove: (connectionId: string, dbUserId: string) =>
    apiFetch<{ result: MutationResult }>(
      `/api/connections/${connectionId}/db-users/${encodeURIComponent(dbUserId)}`,
      {
        method: "DELETE",
      },
    ),
  privileges: (connectionId: string, dbUserId: string) =>
    apiFetch<{ privileges: DatabasePrivilege[] }>(
      `/api/connections/${connectionId}/db-users/${encodeURIComponent(dbUserId)}/privileges`,
    ),
  grant: (connectionId: string, dbUserId: string, input: DatabasePrivilegeMutationInput) =>
    apiFetch<{ result: MutationResult }>(
      `/api/connections/${connectionId}/db-users/${encodeURIComponent(dbUserId)}/privileges`,
      {
        method: "POST",
        body: input,
      },
    ),
  previewPrivilege: (
    connectionId: string,
    dbUserId: string,
    action: "grant" | "revoke",
    input: DatabasePrivilegeMutationInput,
  ) =>
    apiFetch<{ sql: string }>(
      `/api/connections/${connectionId}/db-users/${encodeURIComponent(dbUserId)}/privileges/preview`,
      {
        method: "POST",
        query: { action },
        body: input,
      },
    ),
  revoke: (connectionId: string, dbUserId: string, input: DatabasePrivilegeMutationInput) =>
    apiFetch<{ result: MutationResult }>(
      `/api/connections/${connectionId}/db-users/${encodeURIComponent(dbUserId)}/privileges`,
      {
        method: "DELETE",
        body: input,
      },
    ),
};
