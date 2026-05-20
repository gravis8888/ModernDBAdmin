import type {
  AddColumnInput,
  CreateIndexInput,
  CreateTableInput,
  DatabasePrivilegeMutationInput,
  DatabaseUserCreateInput,
  DatabaseUserUpdateInput,
  ExecuteSqlInput,
  ImportCsvInput,
  ListRowsQueryInput,
  RowMutationInput,
  SessionUser,
  TableMetadata,
} from "@modern-db-admin/shared";

import { AdapterRegistry } from "../adapters";
import type { ResolvedConnectionConfig } from "../adapters/database-adapter";
import { serializeCsv } from "../utils/csv";
import { ApiError } from "../utils/api-error";
import { AuditLogService } from "./audit-log-service";
import { ConnectionService } from "./connection-service";
import { QuerySafetyService } from "./query-safety-service";

export class DatabaseService {
  constructor(
    private readonly connectionService: ConnectionService,
    private readonly adapters: AdapterRegistry,
    private readonly auditLogService: AuditLogService,
    private readonly querySafetyService: QuerySafetyService,
  ) {}

  private getAdapter(config: ResolvedConnectionConfig) {
    return this.adapters.getAdapter(config.dialect);
  }

  private assertWritable(config: ResolvedConnectionConfig) {
    if (config.readonly) {
      throw new ApiError(
        400,
        "READONLY_CONNECTION_REJECTED",
        "読み取り専用モードの接続ではこの操作を実行できません。",
      );
    }
  }

  private quoteIdentifier(config: ResolvedConnectionConfig, value: string) {
    if (config.dialect === "postgresql") {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return `\`${value.replace(/`/g, "``")}\``;
  }

  private buildTableReference(
    config: ResolvedConnectionConfig,
    database: string,
    schema: string,
    table: string,
  ) {
    if (config.dialect === "postgresql") {
      return `${this.quoteIdentifier(config, schema)}.${this.quoteIdentifier(config, table)}`;
    }

    return `${this.quoteIdentifier(config, database)}.${this.quoteIdentifier(config, table)}`;
  }

  private toSqlLiteral(config: ResolvedConnectionConfig, value: unknown) {
    if (value == null) {
      return "NULL";
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
    if (typeof value === "boolean") {
      return config.dialect === "postgresql" ? (value ? "TRUE" : "FALSE") : value ? "1" : "0";
    }

    return `'${String(value).replace(/'/g, "''")}'`;
  }

  getServerInfo(connectionId: string) {
    const config = this.connectionService.resolveConnection(connectionId);
    return this.getAdapter(config).getServerInfo(config);
  }

  listDatabases(connectionId: string) {
    const config = this.connectionService.resolveConnection(connectionId);
    return this.getAdapter(config).listDatabases(config);
  }

  async createDatabase(connectionId: string, database: string, sessionUser: SessionUser) {
    const config = this.connectionService.resolveConnection(connectionId);
    this.assertWritable(config);
    const result = await this.getAdapter(config).createDatabase(config, database);
    this.auditLogService.record({
      actorUserId: sessionUser.id,
      action: "database.create",
      resourceType: "database",
      resourceId: database,
      details: { connectionId },
    });
    return result;
  }

  listSchemas(connectionId: string, database: string) {
    const config = this.connectionService.resolveConnection(connectionId);
    return this.getAdapter(config).listSchemas(config, database);
  }

  listTables(connectionId: string, database: string, schema: string) {
    const config = this.connectionService.resolveConnection(connectionId);
    return this.getAdapter(config).listTables(config, database, schema);
  }

  getColumns(connectionId: string, database: string, schema: string, table: string) {
    const config = this.connectionService.resolveConnection(connectionId);
    return this.getAdapter(config).getColumns(config, database, schema, table);
  }

  getIndexes(connectionId: string, database: string, schema: string, table: string) {
    const config = this.connectionService.resolveConnection(connectionId);
    return this.getAdapter(config).getIndexes(config, database, schema, table);
  }

  listDatabaseObjects(connectionId: string, database: string, schema: string) {
    const config = this.connectionService.resolveConnection(connectionId);
    return this.getAdapter(config).listDatabaseObjects(config, database, schema);
  }

  getTableCreateSql(connectionId: string, database: string, schema: string, table: string) {
    const config = this.connectionService.resolveConnection(connectionId);
    return this.getAdapter(config).getTableCreateSql(config, database, schema, table);
  }

  async getTableMetadata(
    connectionId: string,
    database: string,
    schema: string,
    table: string,
  ): Promise<TableMetadata> {
    const config = this.connectionService.resolveConnection(connectionId);
    const adapter = this.getAdapter(config);
    const [columns, indexes, sql] = await Promise.all([
      adapter.getColumns(config, database, schema, table),
      adapter.getIndexes(config, database, schema, table),
      adapter.getTableCreateSql(config, database, schema, table),
    ]);
    return { columns, indexes, sql };
  }

  selectRows(
    connectionId: string,
    database: string,
    schema: string,
    table: string,
    query: ListRowsQueryInput,
  ) {
    const config = this.connectionService.resolveConnection(connectionId);
    return this.getAdapter(config).selectRows(config, {
      database,
      schema,
      table,
      page: query.page,
      pageSize: query.pageSize,
      orderBy: query.orderBy,
      orderDir: query.orderDir,
      search: query.search,
      filters: query.filters,
    });
  }

  insertRow(
    connectionId: string,
    database: string,
    schema: string,
    table: string,
    input: RowMutationInput,
    sessionUser: SessionUser,
  ) {
    const config = this.connectionService.resolveConnection(connectionId);
    this.assertWritable(config);
    return this.getAdapter(config)
      .insertRow(config, { database, schema, table, values: input.values, criteria: {} })
      .then((result) => {
        this.auditLogService.record({
          actorUserId: sessionUser.id,
          action: "row.insert",
          resourceType: "table",
          resourceId: `${database}.${schema}.${table}`,
          details: { keys: Object.keys(input.values) },
        });
        return result;
      });
  }

  updateRow(
    connectionId: string,
    database: string,
    schema: string,
    table: string,
    input: RowMutationInput,
    sessionUser: SessionUser,
  ) {
    const config = this.connectionService.resolveConnection(connectionId);
    this.assertWritable(config);
    return this.getAdapter(config)
      .updateRow(config, {
        database,
        schema,
        table,
        values: input.values,
        criteria: input.criteria,
      })
      .then((result) => {
        this.auditLogService.record({
          actorUserId: sessionUser.id,
          action: "row.update",
          resourceType: "table",
          resourceId: `${database}.${schema}.${table}`,
          details: { keys: Object.keys(input.values), criteria: Object.keys(input.criteria) },
        });
        return result;
      });
  }

  deleteRow(
    connectionId: string,
    database: string,
    schema: string,
    table: string,
    input: RowMutationInput,
    sessionUser: SessionUser,
  ) {
    const config = this.connectionService.resolveConnection(connectionId);
    this.assertWritable(config);
    return this.getAdapter(config)
      .deleteRow(config, { database, schema, table, values: {}, criteria: input.criteria })
      .then((result) => {
        this.auditLogService.record({
          actorUserId: sessionUser.id,
          action: "row.delete",
          resourceType: "table",
          resourceId: `${database}.${schema}.${table}`,
          details: { criteria: Object.keys(input.criteria) },
        });
        return result;
      });
  }

  async exportTable(
    connectionId: string,
    database: string,
    schema: string,
    table: string,
    format: "csv" | "json" | "insert_sql" | "table_sql",
    sessionUser: SessionUser,
  ) {
    const config = this.connectionService.resolveConnection(connectionId);
    const fileBase = `${database}-${schema}-${table}`;
    let content: string;
    let contentType: string;
    let fileName: string;

    if (format === "table_sql") {
      content = await this.getAdapter(config).getTableCreateSql(config, database, schema, table);
      contentType = "application/sql; charset=utf-8";
      fileName = `${fileBase}.schema.sql`;
    } else {
      const result = await this.getAdapter(config).readTableData(config, database, schema, table);
      const columnNames = result.columns.map((column) => column.name);

      if (format === "csv") {
        content = serializeCsv(columnNames, result.rows);
        contentType = "text/csv; charset=utf-8";
        fileName = `${fileBase}.csv`;
      } else if (format === "json") {
        content = JSON.stringify(result.rows, null, 2);
        contentType = "application/json; charset=utf-8";
        fileName = `${fileBase}.json`;
      } else {
        const tableReference = this.buildTableReference(config, database, schema, table);
        const columnClause = columnNames
          .map((column) => this.quoteIdentifier(config, column))
          .join(", ");
        content = result.rows
          .map((row) => {
            const valueClause = columnNames
              .map((column) => this.toSqlLiteral(config, row[column]))
              .join(", ");
            return `INSERT INTO ${tableReference} (${columnClause}) VALUES (${valueClause});`;
          })
          .join("\n");
        contentType = "application/sql; charset=utf-8";
        fileName = `${fileBase}.data.sql`;
      }
    }

    this.auditLogService.record({
      actorUserId: sessionUser.id,
      action: "table.export",
      resourceType: "table",
      resourceId: `${database}.${schema}.${table}`,
      details: { connectionId, format },
    });

    return {
      content,
      contentType,
      fileName,
    };
  }

  async createTable(
    connectionId: string,
    database: string,
    schema: string,
    input: CreateTableInput,
    sessionUser: SessionUser,
  ) {
    const config = this.connectionService.resolveConnection(connectionId);
    this.assertWritable(config);
    const result = await this.getAdapter(config).createTable(config, {
      database,
      schema,
      name: input.name,
      columns: input.columns,
    });
    this.auditLogService.record({
      actorUserId: sessionUser.id,
      action: "table.create",
      resourceType: "table",
      resourceId: `${database}.${schema}.${input.name}`,
      details: { connectionId, columnCount: input.columns.length },
    });
    return result;
  }

  async renameTable(
    connectionId: string,
    database: string,
    schema: string,
    table: string,
    nextName: string,
    sessionUser: SessionUser,
  ) {
    const config = this.connectionService.resolveConnection(connectionId);
    this.assertWritable(config);
    const result = await this.getAdapter(config).renameTable(config, {
      database,
      schema,
      table,
      nextName,
    });
    this.auditLogService.record({
      actorUserId: sessionUser.id,
      action: "table.rename",
      resourceType: "table",
      resourceId: `${database}.${schema}.${table}`,
      details: { connectionId, nextName },
    });
    return result;
  }

  async dropTable(
    connectionId: string,
    database: string,
    schema: string,
    table: string,
    sessionUser: SessionUser,
  ) {
    const config = this.connectionService.resolveConnection(connectionId);
    this.assertWritable(config);
    const result = await this.getAdapter(config).dropTable(config, database, schema, table);
    this.auditLogService.record({
      actorUserId: sessionUser.id,
      action: "table.drop",
      resourceType: "table",
      resourceId: `${database}.${schema}.${table}`,
      details: { connectionId },
    });
    return result;
  }

  async truncateTable(
    connectionId: string,
    database: string,
    schema: string,
    table: string,
    confirmDangerous: boolean,
    sessionUser: SessionUser,
  ) {
    if (!confirmDangerous) {
      throw new ApiError(
        400,
        "TRUNCATE_CONFIRM_REQUIRED",
        "テーブルを空にするには confirmDangerous=true が必要です。",
      );
    }
    const config = this.connectionService.resolveConnection(connectionId);
    this.assertWritable(config);
    const result = await this.getAdapter(config).truncateTable(config, database, schema, table);
    this.auditLogService.record({
      actorUserId: sessionUser.id,
      action: "table.truncate",
      resourceType: "table",
      resourceId: `${database}.${schema}.${table}`,
      details: { connectionId },
    });
    return result;
  }

  async addColumn(
    connectionId: string,
    database: string,
    schema: string,
    table: string,
    input: AddColumnInput,
    sessionUser: SessionUser,
  ) {
    const config = this.connectionService.resolveConnection(connectionId);
    this.assertWritable(config);
    const result = await this.getAdapter(config).addColumn(config, {
      database,
      schema,
      table,
      column: input,
    });
    this.auditLogService.record({
      actorUserId: sessionUser.id,
      action: "column.add",
      resourceType: "table",
      resourceId: `${database}.${schema}.${table}`,
      details: { connectionId, column: input.name },
    });
    return result;
  }

  async dropColumn(
    connectionId: string,
    database: string,
    schema: string,
    table: string,
    column: string,
    sessionUser: SessionUser,
  ) {
    const config = this.connectionService.resolveConnection(connectionId);
    this.assertWritable(config);
    const result = await this.getAdapter(config).dropColumn(
      config,
      database,
      schema,
      table,
      column,
    );
    this.auditLogService.record({
      actorUserId: sessionUser.id,
      action: "column.drop",
      resourceType: "table",
      resourceId: `${database}.${schema}.${table}`,
      details: { connectionId, column },
    });
    return result;
  }

  async createIndex(
    connectionId: string,
    database: string,
    schema: string,
    table: string,
    input: CreateIndexInput,
    sessionUser: SessionUser,
  ) {
    const config = this.connectionService.resolveConnection(connectionId);
    this.assertWritable(config);
    const result = await this.getAdapter(config).createIndex(config, {
      database,
      schema,
      table,
      name: input.name,
      columns: input.columns,
      unique: input.unique,
    });
    this.auditLogService.record({
      actorUserId: sessionUser.id,
      action: "index.create",
      resourceType: "table",
      resourceId: `${database}.${schema}.${table}`,
      details: { connectionId, index: input.name, columns: input.columns, unique: input.unique },
    });
    return result;
  }

  async dropIndex(
    connectionId: string,
    database: string,
    schema: string,
    table: string,
    index: string,
    sessionUser: SessionUser,
  ) {
    const config = this.connectionService.resolveConnection(connectionId);
    this.assertWritable(config);
    const result = await this.getAdapter(config).dropIndex(config, database, schema, table, index);
    this.auditLogService.record({
      actorUserId: sessionUser.id,
      action: "index.drop",
      resourceType: "table",
      resourceId: `${database}.${schema}.${table}`,
      details: { connectionId, index },
    });
    return result;
  }

  async importCsv(
    connectionId: string,
    database: string,
    schema: string,
    table: string,
    input: ImportCsvInput,
    sessionUser: SessionUser,
  ) {
    const config = this.connectionService.resolveConnection(connectionId);
    this.assertWritable(config);
    const result = await this.getAdapter(config).importCsv(config, {
      database,
      schema,
      table,
      csv: input.csv,
      delimiter: input.delimiter,
      truncateBeforeImport: input.truncateBeforeImport,
    });
    this.auditLogService.record({
      actorUserId: sessionUser.id,
      action: "table.import_csv",
      resourceType: "table",
      resourceId: `${database}.${schema}.${table}`,
      details: {
        connectionId,
        truncateBeforeImport: input.truncateBeforeImport,
        delimiter: input.delimiter,
      },
    });
    return result;
  }

  listSessions(connectionId: string, database?: string) {
    const config = this.connectionService.resolveConnection(connectionId);
    return this.getAdapter(config).listSessions(config, database);
  }

  listServerVariables(connectionId: string, database?: string) {
    const config = this.connectionService.resolveConnection(connectionId);
    return this.getAdapter(config).listServerVariables(config, database);
  }

  listServerMetrics(connectionId: string, database?: string) {
    const config = this.connectionService.resolveConnection(connectionId);
    return this.getAdapter(config).listServerMetrics(config, database);
  }

  async executeSql(connectionId: string, input: ExecuteSqlInput, sessionUser: SessionUser) {
    const config = this.connectionService.resolveConnection(connectionId);
    const analysis = this.querySafetyService.assertExecutionAllowed({
      sql: input.sql,
      readonly: config.readonly,
      confirmDangerous: input.confirmDangerous,
    });
    const result = await this.getAdapter(config).executeSql(config, input.sql);
    this.auditLogService.record({
      actorUserId: sessionUser.id,
      action: "sql.execute",
      resourceType: "connection",
      resourceId: connectionId,
      details: {
        statementTypes: analysis.statementTypes,
        dangerous: analysis.dangerous,
      },
    });
    return { analysis, result };
  }

  listDatabaseUsers(connectionId: string) {
    const config = this.connectionService.resolveConnection(connectionId);
    return this.getAdapter(config).listDatabaseUsers(config);
  }

  createDatabaseUser(
    connectionId: string,
    input: DatabaseUserCreateInput,
    sessionUser: SessionUser,
  ) {
    const config = this.connectionService.resolveConnection(connectionId);
    this.assertWritable(config);
    return this.getAdapter(config)
      .createDatabaseUser(config, input)
      .then((result) => {
        this.auditLogService.record({
          actorUserId: sessionUser.id,
          action: "db-user.create",
          resourceType: "db-user",
          resourceId: input.username,
          details: { connectionId, canLogin: input.canLogin, host: input.host ?? null },
        });
        return result;
      });
  }

  updateDatabaseUser(
    connectionId: string,
    userId: string,
    input: DatabaseUserUpdateInput,
    sessionUser: SessionUser,
  ) {
    const config = this.connectionService.resolveConnection(connectionId);
    this.assertWritable(config);
    return this.getAdapter(config)
      .updateDatabaseUser(config, userId, input)
      .then((result) => {
        this.auditLogService.record({
          actorUserId: sessionUser.id,
          action: "db-user.update",
          resourceType: "db-user",
          resourceId: userId,
          details: { connectionId, canLogin: input.canLogin ?? null },
        });
        return result;
      });
  }

  deleteDatabaseUser(connectionId: string, userId: string, sessionUser: SessionUser) {
    const config = this.connectionService.resolveConnection(connectionId);
    this.assertWritable(config);
    return this.getAdapter(config)
      .deleteDatabaseUser(config, userId)
      .then((result) => {
        this.auditLogService.record({
          actorUserId: sessionUser.id,
          action: "db-user.delete",
          resourceType: "db-user",
          resourceId: userId,
          details: { connectionId },
        });
        return result;
      });
  }

  listDatabasePrivileges(connectionId: string, userId: string) {
    const config = this.connectionService.resolveConnection(connectionId);
    return this.getAdapter(config).listDatabasePrivileges(config, userId);
  }

  async mutatePrivileges(
    action: "grant" | "revoke",
    connectionId: string,
    userId: string,
    input: DatabasePrivilegeMutationInput,
    sessionUser: SessionUser,
  ) {
    const config = this.connectionService.resolveConnection(connectionId);
    this.assertWritable(config);
    const dangerous = input.privileges.some((privilege) =>
      /all privileges|grant option|superuser|createdb|createrole|replication|bypassrls/i.test(
        privilege,
      ),
    );
    if (dangerous && !input.confirmDangerous) {
      throw new ApiError(
        400,
        "DANGEROUS_PRIVILEGE_CONFIRM_REQUIRED",
        "危険な権限変更のため confirmDangerous=true が必要です。",
      );
    }

    const adapter = this.getAdapter(config);
    const result =
      action === "grant"
        ? await adapter.grantPrivileges(config, {
            userId,
            objectType: input.objectType,
            database: input.database,
            schema: input.schema,
            table: input.table,
            sequence: input.sequence,
            privileges: input.privileges,
            sourceRole: input.sourceRole,
          })
        : await adapter.revokePrivileges(config, {
            userId,
            objectType: input.objectType,
            database: input.database,
            schema: input.schema,
            table: input.table,
            sequence: input.sequence,
            privileges: input.privileges,
            sourceRole: input.sourceRole,
          });

    this.auditLogService.record({
      actorUserId: sessionUser.id,
      action: `db-privilege.${action}`,
      resourceType: "db-user",
      resourceId: userId,
      details: {
        connectionId,
        objectType: input.objectType,
        privileges: input.privileges,
        database: input.database ?? null,
        schema: input.schema ?? null,
        table: input.table ?? null,
        sourceRole: input.sourceRole ?? null,
      },
    });

    return result;
  }

  previewPrivilegeMutation(
    action: "grant" | "revoke",
    connectionId: string,
    userId: string,
    input: DatabasePrivilegeMutationInput,
  ) {
    const config = this.connectionService.resolveConnection(connectionId);
    const adapter = this.getAdapter(config);
    return adapter.previewPrivilegeMutation(config, action, {
      userId,
      objectType: input.objectType,
      database: input.database,
      schema: input.schema,
      table: input.table,
      sequence: input.sequence,
      privileges: input.privileges,
      sourceRole: input.sourceRole,
    });
  }
}
