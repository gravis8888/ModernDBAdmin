import type {
  ColumnInfo,
  ConnectionSummary,
  DatabaseInfo,
  DatabaseObjectInfo,
  DatabasePrivilege,
  DatabaseUser,
  IndexInfo,
  MutationResult,
  QueryExecutionResult,
  QueryResult,
  RowFilterInput,
  SchemaInfo,
  ServerMetricInfo,
  ServerSessionInfo,
  ServerInfo,
  ServerVariableInfo,
  TableColumnDraft,
  TableInfo,
} from "@modern-db-admin/shared";

export type ResolvedConnectionConfig = Pick<
  ConnectionSummary,
  "id" | "name" | "dialect" | "host" | "port" | "readonly" | "useSsl"
> & {
  username: string;
  password: string;
  defaultDatabase: string | null;
};

export type SelectRowsParams = {
  database: string;
  schema: string;
  table: string;
  page: number;
  pageSize: number;
  orderBy?: string;
  orderDir: "asc" | "desc";
  search?: string;
  filters: RowFilterInput[];
};

export type RowMutationParams = {
  database: string;
  schema: string;
  table: string;
  values: Record<string, unknown>;
  criteria: Record<string, unknown>;
};

export type DatabaseUserMutationParams = {
  username?: string;
  host?: string;
  password?: string;
  canLogin?: boolean;
  isSuperuser?: boolean;
  canCreateDatabase?: boolean;
  canCreateUser?: boolean;
  canReplication?: boolean;
  canBypassRls?: boolean;
};

export type PrivilegeMutationParams = {
  userId: string;
  objectType: "global" | "database" | "schema" | "table" | "sequence" | "role_membership";
  database?: string;
  schema?: string;
  table?: string;
  sequence?: string;
  privileges: string[];
  sourceRole?: string;
};

export type CreateTableParams = {
  database: string;
  schema: string;
  name: string;
  columns: TableColumnDraft[];
};

export type RenameTableParams = {
  database: string;
  schema: string;
  table: string;
  nextName: string;
};

export type AddColumnParams = {
  database: string;
  schema: string;
  table: string;
  column: Omit<TableColumnDraft, "primaryKey">;
};

export type CreateIndexParams = {
  database: string;
  schema: string;
  table: string;
  name: string;
  columns: string[];
  unique: boolean;
};

export type ImportCsvParams = {
  database: string;
  schema: string;
  table: string;
  csv: string;
  delimiter: "," | ";" | "\t";
  truncateBeforeImport: boolean;
};

export interface DatabaseAdapter {
  testConnection(config: ResolvedConnectionConfig): Promise<ServerInfo>;
  getServerInfo(config: ResolvedConnectionConfig, databaseOverride?: string): Promise<ServerInfo>;
  listDatabases(config: ResolvedConnectionConfig): Promise<DatabaseInfo[]>;
  createDatabase(config: ResolvedConnectionConfig, database: string): Promise<MutationResult>;
  listSchemas(config: ResolvedConnectionConfig, database: string): Promise<SchemaInfo[]>;
  listTables(
    config: ResolvedConnectionConfig,
    database: string,
    schema: string,
  ): Promise<TableInfo[]>;
  getColumns(
    config: ResolvedConnectionConfig,
    database: string,
    schema: string,
    table: string,
  ): Promise<ColumnInfo[]>;
  getIndexes(
    config: ResolvedConnectionConfig,
    database: string,
    schema: string,
    table: string,
  ): Promise<IndexInfo[]>;
  listDatabaseObjects(
    config: ResolvedConnectionConfig,
    database: string,
    schema: string,
  ): Promise<DatabaseObjectInfo[]>;
  getTableCreateSql(
    config: ResolvedConnectionConfig,
    database: string,
    schema: string,
    table: string,
  ): Promise<string>;
  selectRows(config: ResolvedConnectionConfig, params: SelectRowsParams): Promise<QueryResult>;
  readTableData(
    config: ResolvedConnectionConfig,
    database: string,
    schema: string,
    table: string,
  ): Promise<QueryResult>;
  insertRow(config: ResolvedConnectionConfig, params: RowMutationParams): Promise<MutationResult>;
  updateRow(config: ResolvedConnectionConfig, params: RowMutationParams): Promise<MutationResult>;
  deleteRow(config: ResolvedConnectionConfig, params: RowMutationParams): Promise<MutationResult>;
  createTable(config: ResolvedConnectionConfig, params: CreateTableParams): Promise<MutationResult>;
  renameTable(config: ResolvedConnectionConfig, params: RenameTableParams): Promise<MutationResult>;
  dropTable(
    config: ResolvedConnectionConfig,
    database: string,
    schema: string,
    table: string,
  ): Promise<MutationResult>;
  truncateTable(
    config: ResolvedConnectionConfig,
    database: string,
    schema: string,
    table: string,
  ): Promise<MutationResult>;
  addColumn(config: ResolvedConnectionConfig, params: AddColumnParams): Promise<MutationResult>;
  dropColumn(
    config: ResolvedConnectionConfig,
    database: string,
    schema: string,
    table: string,
    column: string,
  ): Promise<MutationResult>;
  createIndex(config: ResolvedConnectionConfig, params: CreateIndexParams): Promise<MutationResult>;
  dropIndex(
    config: ResolvedConnectionConfig,
    database: string,
    schema: string,
    table: string,
    index: string,
  ): Promise<MutationResult>;
  importCsv(config: ResolvedConnectionConfig, params: ImportCsvParams): Promise<MutationResult>;
  listSessions(config: ResolvedConnectionConfig, database?: string): Promise<ServerSessionInfo[]>;
  listServerVariables(
    config: ResolvedConnectionConfig,
    database?: string,
  ): Promise<ServerVariableInfo[]>;
  listServerMetrics(
    config: ResolvedConnectionConfig,
    database?: string,
  ): Promise<ServerMetricInfo[]>;
  executeSql(config: ResolvedConnectionConfig, sql: string): Promise<QueryExecutionResult>;
  listDatabaseUsers(config: ResolvedConnectionConfig): Promise<DatabaseUser[]>;
  createDatabaseUser(
    config: ResolvedConnectionConfig,
    params: DatabaseUserMutationParams,
  ): Promise<MutationResult>;
  updateDatabaseUser(
    config: ResolvedConnectionConfig,
    userId: string,
    params: DatabaseUserMutationParams,
  ): Promise<MutationResult>;
  deleteDatabaseUser(config: ResolvedConnectionConfig, userId: string): Promise<MutationResult>;
  listDatabasePrivileges(
    config: ResolvedConnectionConfig,
    userId: string,
  ): Promise<DatabasePrivilege[]>;
  grantPrivileges(
    config: ResolvedConnectionConfig,
    params: PrivilegeMutationParams,
  ): Promise<MutationResult>;
  revokePrivileges(
    config: ResolvedConnectionConfig,
    params: PrivilegeMutationParams,
  ): Promise<MutationResult>;
  previewPrivilegeMutation(
    config: ResolvedConnectionConfig,
    action: "grant" | "revoke",
    params: PrivilegeMutationParams,
  ): string;
  closeConnection(connectionId: string): Promise<void>;
  closeAll(): Promise<void>;
}
