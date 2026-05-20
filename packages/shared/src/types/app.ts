export const appPermissionValues = [
  "manage_app_users",
  "manage_app_roles",
  "manage_connections",
  "view_connections",
  "view_schema",
  "view_table_rows",
  "edit_table_rows",
  "execute_select_sql",
  "execute_mutation_sql",
  "execute_ddl_sql",
  "manage_db_users",
  "manage_db_privileges",
  "export_data",
  "view_audit_logs",
] as const;

export type AppPermission = (typeof appPermissionValues)[number];

export type DatabaseDialect = "mysql" | "mariadb" | "postgresql";

export type SystemRoleName = "Admin" | "Developer" | "Viewer";

export type ThemeMode = "light" | "dark" | "system";

export type AppRole = {
  id: string;
  name: string;
  description: string;
  permissionKeys: AppPermission[];
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AppUser = {
  id: string;
  username: string;
  email: string;
  roleIds: string[];
  roles: AppRole[];
  enabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SessionUser = {
  id: string;
  username: string;
  email: string;
  roleIds: string[];
  permissionKeys: AppPermission[];
  enabled: boolean;
  lastLoginAt: string | null;
};

export type ConnectionSummary = {
  id: string;
  name: string;
  dialect: DatabaseDialect;
  host: string;
  port: number;
  username: string;
  database: string;
  readonly: boolean;
  useSsl: boolean;
  lastConnectedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ServerInfo = {
  dialect: DatabaseDialect;
  version: string;
  currentUser: string;
  host: string;
  database: string | null;
  schema: string | null;
};

export type DatabaseInfo = {
  name: string;
};

export type SchemaInfo = {
  name: string;
};

export type TableInfo = {
  name: string;
  schema: string;
  type: "table" | "view";
  estimatedRows?: number;
  sizeBytes?: number;
  comment?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type ConnectionTreeSchema = {
  name: string;
  tables: TableInfo[];
};

export type ConnectionTreeDatabase = {
  name: string;
  schemas: ConnectionTreeSchema[];
};

export type ConnectionTree = {
  connection: ConnectionSummary;
  databases: ConnectionTreeDatabase[];
  error?: string;
};

export type ColumnInfo = {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
  defaultValue: string | null;
  autoIncrement: boolean;
  comment?: string;
};

export type IndexInfo = {
  name: string;
  columns: string[];
  unique: boolean;
  primary: boolean;
  type: string;
  definition?: string;
};

export type TableMetadata = {
  columns: ColumnInfo[];
  indexes: IndexInfo[];
  sql: string;
};

export type DatabaseObjectKind = "trigger" | "routine" | "event" | "sequence" | "view";

export type DatabaseObjectInfo = {
  id: string;
  kind: DatabaseObjectKind;
  database?: string;
  schema: string;
  name: string;
  relatedTable?: string;
  routineType?: string;
  timing?: string;
  event?: string;
  enabled?: boolean;
  definition?: string | null;
  updatedAt?: string;
};

export type ServerSessionInfo = {
  id: string;
  user: string;
  database: string | null;
  schema: string | null;
  host: string | null;
  state: string | null;
  command: string | null;
  query: string | null;
  durationSeconds: number | null;
};

export type ServerVariableInfo = {
  name: string;
  value: string;
  scope: "global" | "session" | "runtime";
};

export type ServerMetricInfo = {
  name: string;
  value: string;
  category: string;
};

export type QueryColumn = {
  name: string;
  dataType?: string;
};

export type QueryResult = {
  columns: QueryColumn[];
  rows: Record<string, unknown>[];
  rowCount: number;
  affectedRows?: number;
  executionTimeMs: number;
};

export type QueryStatementResult = {
  sql: string;
  statementType: string;
  result?: QueryResult;
  message?: string;
};

export type QueryExecutionResult = {
  statements: QueryStatementResult[];
};

export type MutationResult = {
  affectedRows: number;
  message: string;
};

export type TableColumnDraft = {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue?: string;
  primaryKey?: boolean;
  autoIncrement?: boolean;
};

export type SqlBookmark = {
  id: string;
  userId: string;
  name: string;
  sql: string;
  connectionId: string | null;
  database: string | null;
  schema: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DatabaseUser = {
  id: string;
  username: string;
  host?: string;
  type: "user" | "role";
  canLogin?: boolean;
  isSuperuser?: boolean;
  canCreateDatabase?: boolean;
  canCreateUser?: boolean;
  canReplication?: boolean;
  canBypassRls?: boolean;
  raw?: unknown;
};

export type DatabasePrivilege = {
  id: string;
  userId: string;
  objectType: "global" | "database" | "schema" | "table" | "sequence" | "role_membership";
  privilege: string;
  database?: string;
  schema?: string;
  table?: string;
  sequence?: string;
  grantable?: boolean;
  source: "direct" | "public" | "membership" | "raw";
  note?: string;
};

export type AuditLogEntry = {
  id: string;
  actorUserId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  details: Record<string, unknown>;
  createdAt: string;
};

export type TreeNode = {
  id: string;
  label: string;
  type: "connection" | "database" | "schema" | "folder" | "table" | "view" | "shortcut";
  href?: string;
  children?: TreeNode[];
};
