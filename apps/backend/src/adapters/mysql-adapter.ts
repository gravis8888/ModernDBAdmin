import mysql from "mysql2/promise";
import type {
  ColumnInfo,
  DatabaseObjectInfo,
  DatabasePrivilege,
  DatabaseUser,
  IndexInfo,
  MutationResult,
  QueryExecutionResult,
  QueryResult,
  ServerMetricInfo,
  ServerSessionInfo,
  ServerInfo,
  ServerVariableInfo,
  TableInfo,
} from "@modern-db-admin/shared";

import { parseCsvContent } from "../utils/csv";
import { ApiError } from "../utils/api-error";
import { splitSqlStatements } from "../utils/sql";
import type {
  AddColumnParams,
  CreateIndexParams,
  CreateTableParams,
  DatabaseAdapter,
  DatabaseUserMutationParams,
  ImportCsvParams,
  PrivilegeMutationParams,
  RenameTableParams,
  ResolvedConnectionConfig,
  RowMutationParams,
  SelectRowsParams,
} from "./database-adapter";

type MySqlRow = mysql.RowDataPacket & Record<string, unknown>;
type MySqlStringRow = mysql.RowDataPacket & Record<string, string>;

const mysqlOperationTimeoutMs = 30_000;

export class MySqlAdapter implements DatabaseAdapter {
  private readonly pools = new Map<string, mysql.Pool>();

  private async withConnection<T>(
    config: ResolvedConnectionConfig,
    databaseOverride: string | null,
    callback: (connection: mysql.PoolConnection) => Promise<T>,
  ) {
    const pool = this.getPool(config, databaseOverride);
    const connection = await pool.getConnection();
    let timedOut = false;
    const operationPromise = callback(connection);
    let timerId: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timerId = setTimeout(() => {
        timedOut = true;
        connection.destroy();
        reject(
          new ApiError(
            408,
            "MYSQL_QUERY_TIMEOUT",
            "MySQL の応答がタイムアウトしました。処理を見直して再実行してください。",
          ),
        );
      }, mysqlOperationTimeoutMs);
    });

    try {
      return await Promise.race([operationPromise, timeoutPromise]);
    } catch (error) {
      throw this.wrapError(error);
    } finally {
      if (timerId) {
        clearTimeout(timerId);
      }
      if (!timedOut) {
        connection.release();
      }
    }
  }

  private getPool(config: ResolvedConnectionConfig, databaseOverride: string | null) {
    const poolKey = [
      config.id,
      config.dialect,
      config.host,
      config.port,
      config.username,
      config.password,
      databaseOverride ?? config.defaultDatabase ?? "",
      config.useSsl ? "ssl" : "plain",
    ].join("\u001f");
    const currentPool = this.pools.get(poolKey);
    if (currentPool) {
      return currentPool;
    }

    const pool = mysql.createPool({
      host: config.host,
      port: config.port,
      user: config.username,
      password: config.password,
      database: databaseOverride ?? config.defaultDatabase ?? undefined,
      ssl: config.useSsl ? { minVersion: "TLSv1.2" } : undefined,
      connectTimeout: 3000,
      connectionLimit: 10,
      enableKeepAlive: true,
      waitForConnections: true,
      queueLimit: 100,
    });
    this.pools.set(poolKey, pool);
    return pool;
  }

  async testConnection(config: ResolvedConnectionConfig) {
    return this.getServerInfo(config);
  }

  async getServerInfo(config: ResolvedConnectionConfig): Promise<ServerInfo> {
    return this.withConnection(config, config.defaultDatabase, async (connection) => {
      const [rows] = await connection.query<MySqlRow[]>(
        "SELECT VERSION() AS version, CURRENT_USER() AS currentUser, DATABASE() AS databaseName",
      );
      const row = (rows[0] ?? {}) as MySqlRow;
      return {
        dialect: config.dialect,
        version: String(row.version ?? "unknown"),
        currentUser: String(row.currentUser ?? config.username),
        host: config.host,
        database: row.databaseName ? String(row.databaseName) : null,
        schema: row.databaseName ? String(row.databaseName) : null,
      };
    });
  }

  async listDatabases(config: ResolvedConnectionConfig) {
    return this.withConnection(config, null, async (connection) => {
      const [rows] = await connection.query<Array<mysql.RowDataPacket & { name: string }>>(
        "SELECT SCHEMA_NAME AS name FROM information_schema.SCHEMATA ORDER BY SCHEMA_NAME",
      );
      return rows.map((row) => ({ name: row.name }));
    });
  }

  async createDatabase(
    config: ResolvedConnectionConfig,
    database: string,
  ): Promise<MutationResult> {
    return this.withConnection(config, null, async (connection) => {
      await connection.query(`CREATE DATABASE ${this.quoteIdentifier(database)}`);
      return {
        affectedRows: 1,
        message: "database を作成しました。",
      };
    });
  }

  async listSchemas(_config: ResolvedConnectionConfig, database: string) {
    return [{ name: database }];
  }

  async listTables(
    config: ResolvedConnectionConfig,
    database: string,
    _schema: string,
  ): Promise<TableInfo[]> {
    void _schema;
    return this.withConnection(config, database, async (connection) => {
      const [rows] = await connection.execute<MySqlRow[]>(
        `SELECT
           TABLE_NAME AS name,
           TABLE_SCHEMA AS schemaName,
           TABLE_TYPE AS tableType,
           TABLE_ROWS AS estimatedRows,
           (DATA_LENGTH + INDEX_LENGTH) AS sizeBytes,
           TABLE_COMMENT AS comment,
           CREATE_TIME AS createdAt,
           UPDATE_TIME AS updatedAt
         FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = ?
         ORDER BY TABLE_NAME`,
        [database],
      );

      return rows.map((row) => ({
        name: String(row.name),
        schema: String(row.schemaName),
        type: row.tableType === "VIEW" ? "view" : "table",
        estimatedRows: row.estimatedRows == null ? undefined : Number(row.estimatedRows),
        sizeBytes: row.sizeBytes == null ? undefined : Number(row.sizeBytes),
        comment: row.comment ? String(row.comment) : undefined,
        createdAt: row.createdAt ? new Date(String(row.createdAt)).toISOString() : undefined,
        updatedAt: row.updatedAt ? new Date(String(row.updatedAt)).toISOString() : undefined,
      }));
    });
  }

  async getColumns(
    config: ResolvedConnectionConfig,
    database: string,
    _schema: string,
    table: string,
  ): Promise<ColumnInfo[]> {
    return this.withConnection(config, database, async (connection) => {
      const [rows] = await connection.execute<MySqlRow[]>(
        `SELECT
           COLUMN_NAME AS name,
           COLUMN_TYPE AS columnType,
           IS_NULLABLE AS isNullable,
           COLUMN_KEY AS columnKey,
           COLUMN_DEFAULT AS defaultValue,
           EXTRA AS extraValue,
           COLUMN_COMMENT AS comment
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ?
           AND TABLE_NAME = ?
         ORDER BY ORDINAL_POSITION`,
        [database, table],
      );

      return rows.map((row) => ({
        name: String(row.name),
        type: String(row.columnType),
        nullable: row.isNullable === "YES",
        primaryKey: row.columnKey === "PRI",
        defaultValue: row.defaultValue == null ? null : String(row.defaultValue),
        autoIncrement: String(row.extraValue ?? "").includes("auto_increment"),
        comment: row.comment ? String(row.comment) : undefined,
      }));
    });
  }

  async getIndexes(
    config: ResolvedConnectionConfig,
    database: string,
    _schema: string,
    table: string,
  ): Promise<IndexInfo[]> {
    return this.withConnection(config, database, async (connection) => {
      const [rows] = await connection.execute<MySqlRow[]>(
        `SELECT
           INDEX_NAME AS indexName,
           COLUMN_NAME AS columnName,
           NON_UNIQUE AS nonUnique,
           INDEX_TYPE AS indexType,
           SEQ_IN_INDEX AS sequenceInIndex
         FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = ?
           AND TABLE_NAME = ?
         ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
        [database, table],
      );

      const grouped = new Map<string, IndexInfo>();
      for (const row of rows) {
        const name = String(row.indexName);
        const existing = grouped.get(name) ?? {
          name,
          columns: [],
          unique: Number(row.nonUnique) === 0,
          primary: name === "PRIMARY",
          type: String(row.indexType ?? "BTREE"),
        };
        existing.columns.push(String(row.columnName));
        grouped.set(name, existing);
      }

      return [...grouped.values()];
    });
  }

  async listDatabaseObjects(
    config: ResolvedConnectionConfig,
    database: string,
    schema: string,
  ): Promise<DatabaseObjectInfo[]> {
    void schema;
    return this.withConnection(config, database, async (connection) => {
      const objects: DatabaseObjectInfo[] = [];

      const [viewRows] = await connection.execute<MySqlRow[]>(
        `SELECT TABLE_NAME AS name, VIEW_DEFINITION AS definition
         FROM information_schema.VIEWS
         WHERE TABLE_SCHEMA = ?
         ORDER BY TABLE_NAME`,
        [database],
      );
      objects.push(
        ...viewRows.map((row) => ({
          id: `${database}:${database}:view:${String(row.name)}`,
          kind: "view" as const,
          database,
          schema: database,
          name: String(row.name),
          definition: row.definition == null ? null : String(row.definition),
        })),
      );

      const [triggerRows] = await connection.execute<MySqlRow[]>(
        `SELECT
           TRIGGER_NAME AS name,
           EVENT_OBJECT_TABLE AS relatedTable,
           ACTION_TIMING AS timing,
           EVENT_MANIPULATION AS eventName,
           ACTION_STATEMENT AS definition,
           CREATED AS updatedAt
         FROM information_schema.TRIGGERS
         WHERE TRIGGER_SCHEMA = ?
         ORDER BY TRIGGER_NAME`,
        [database],
      );
      objects.push(
        ...triggerRows.map((row) => ({
          id: `${database}:${database}:trigger:${String(row.name)}`,
          kind: "trigger" as const,
          database,
          schema: database,
          name: String(row.name),
          relatedTable: row.relatedTable == null ? undefined : String(row.relatedTable),
          timing: row.timing == null ? undefined : String(row.timing),
          event: row.eventName == null ? undefined : String(row.eventName),
          definition: row.definition == null ? null : String(row.definition),
          updatedAt: row.updatedAt ? new Date(String(row.updatedAt)).toISOString() : undefined,
        })),
      );

      const [routineRows] = await connection.execute<MySqlRow[]>(
        `SELECT
           ROUTINE_NAME AS name,
           ROUTINE_TYPE AS routineType,
           ROUTINE_DEFINITION AS definition,
           LAST_ALTERED AS updatedAt
         FROM information_schema.ROUTINES
         WHERE ROUTINE_SCHEMA = ?
         ORDER BY ROUTINE_TYPE, ROUTINE_NAME`,
        [database],
      );
      objects.push(
        ...routineRows.map((row) => ({
          id: `${database}:${database}:routine:${String(row.routineType)}:${String(row.name)}`,
          kind: "routine" as const,
          database,
          schema: database,
          name: String(row.name),
          routineType: row.routineType == null ? undefined : String(row.routineType),
          definition: row.definition == null ? null : String(row.definition),
          updatedAt: row.updatedAt ? new Date(String(row.updatedAt)).toISOString() : undefined,
        })),
      );

      const [eventRows] = await connection.execute<MySqlRow[]>(
        `SELECT
           EVENT_NAME AS name,
           STATUS AS statusValue,
           EVENT_DEFINITION AS definition,
           LAST_ALTERED AS updatedAt
         FROM information_schema.EVENTS
         WHERE EVENT_SCHEMA = ?
         ORDER BY EVENT_NAME`,
        [database],
      );
      objects.push(
        ...eventRows.map((row) => ({
          id: `${database}:${database}:event:${String(row.name)}`,
          kind: "event" as const,
          database,
          schema: database,
          name: String(row.name),
          enabled: String(row.statusValue ?? "").toUpperCase() === "ENABLED",
          definition: row.definition == null ? null : String(row.definition),
          updatedAt: row.updatedAt ? new Date(String(row.updatedAt)).toISOString() : undefined,
        })),
      );

      return objects;
    });
  }

  async getTableCreateSql(
    config: ResolvedConnectionConfig,
    database: string,
    _schema: string,
    table: string,
  ): Promise<string> {
    return this.withConnection(config, database, async (connection) => {
      const [rows] = await connection.query<MySqlRow[]>(
        `SHOW CREATE TABLE ${this.quoteIdentifier(database)}.${this.quoteIdentifier(table)}`,
      );
      const row = rows[0];
      if (!row) {
        throw new ApiError(404, "TABLE_NOT_FOUND", "テーブル定義を取得できませんでした。");
      }

      const createSqlKey = Object.keys(row).find((key) => /Create Table/i.test(key));
      if (!createSqlKey) {
        throw new ApiError(
          500,
          "CREATE_SQL_NOT_FOUND",
          "CREATE TABLE 定義を取得できませんでした。",
        );
      }

      return String(row[createSqlKey]);
    });
  }

  async selectRows(
    config: ResolvedConnectionConfig,
    params: SelectRowsParams,
  ): Promise<QueryResult> {
    return this.withConnection(config, params.database, async (connection) => {
      const columns = await this.getColumns(config, params.database, params.schema, params.table);
      const columnNames = new Set(columns.map((column) => column.name));
      const quotedTable = `${this.quoteIdentifier(params.database)}.${this.quoteIdentifier(params.table)}`;
      const whereParts: string[] = [];
      const values: unknown[] = [];

      for (const filter of params.filters) {
        const condition = this.buildFilterCondition(filter, columnNames, (value) => {
          values.push(value);
          return "?";
        });
        whereParts.push(condition);
      }

      if (params.search) {
        const searchableColumns = columns.map((column) => this.quoteIdentifier(column.name));
        if (searchableColumns.length > 0) {
          whereParts.push(
            `(${searchableColumns.map((column) => `CAST(${column} AS CHAR) LIKE ?`).join(" OR ")})`,
          );
          for (let index = 0; index < searchableColumns.length; index += 1) {
            values.push(`%${params.search}%`);
          }
        }
      }

      const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";
      const fallbackOrderColumn =
        columns.find((column) => column.primaryKey)?.name ?? columns[0]?.name;
      if (params.orderBy && !columnNames.has(params.orderBy)) {
        throw new ApiError(
          400,
          "ORDER_BY_INVALID",
          `指定されたソート列 ${params.orderBy} は存在しません。`,
        );
      }
      const orderColumn = params.orderBy ?? fallbackOrderColumn;
      if (!orderColumn) {
        throw new ApiError(400, "TABLE_COLUMNS_NOT_FOUND", "テーブル列を取得できませんでした。");
      }
      const orderBy = this.quoteIdentifier(orderColumn);
      const offset = (params.page - 1) * params.pageSize;
      const startedAt = Date.now();
      const [countRows] = await connection.query<Array<MySqlRow & { totalCount: number }>>(
        `SELECT COUNT(*) AS totalCount FROM ${quotedTable} ${whereClause}`,
        values as mysql.QueryValues,
      );
      const sql = `SELECT * FROM ${quotedTable} ${whereClause} ORDER BY ${orderBy} ${params.orderDir.toUpperCase()} LIMIT ? OFFSET ?`;
      const [rows, fields] = await connection.query<MySqlRow[]>(sql, [
        ...values,
        params.pageSize,
        offset,
      ] as mysql.QueryValues);
      const executionTimeMs = Date.now() - startedAt;
      const totalCount = Number(countRows[0]?.totalCount ?? rows.length);

      return {
        columns: fields.map((field) => ({
          name: field.name,
          dataType: String(field.columnType),
        })),
        rows,
        rowCount: totalCount,
        executionTimeMs,
      };
    });
  }

  async readTableData(
    config: ResolvedConnectionConfig,
    database: string,
    _schema: string,
    table: string,
  ): Promise<QueryResult> {
    return this.withConnection(config, database, async (connection) => {
      const startedAt = Date.now();
      const sql = `SELECT * FROM ${this.quoteIdentifier(database)}.${this.quoteIdentifier(table)}`;
      const [rows, fields] = await connection.query<MySqlRow[]>(sql);
      return {
        columns: fields.map((field) => ({
          name: field.name,
          dataType: String(field.columnType),
        })),
        rows,
        rowCount: rows.length,
        executionTimeMs: Date.now() - startedAt,
      };
    });
  }

  async insertRow(
    config: ResolvedConnectionConfig,
    params: RowMutationParams,
  ): Promise<MutationResult> {
    return this.withConnection(config, params.database, async (connection) => {
      const entries = Object.entries(params.values);
      if (entries.length === 0) {
        throw new ApiError(400, "ROW_VALUES_REQUIRED", "追加する値が必要です。");
      }

      const columns = entries.map(([key]) => this.quoteIdentifier(key)).join(", ");
      const placeholders = entries.map(() => "?").join(", ");
      const [result] = await connection.execute<mysql.ResultSetHeader>(
        `INSERT INTO ${this.quoteIdentifier(params.database)}.${this.quoteIdentifier(params.table)} (${columns}) VALUES (${placeholders})`,
        entries.map(([, value]) => value as mysql.ExecuteValues) as mysql.ExecuteValues[],
      );

      return {
        affectedRows: result.affectedRows,
        message: "行を追加しました。",
      };
    });
  }

  async updateRow(
    config: ResolvedConnectionConfig,
    params: RowMutationParams,
  ): Promise<MutationResult> {
    return this.withConnection(config, params.database, async (connection) => {
      const valueEntries = Object.entries(params.values);
      const criteriaEntries = Object.entries(params.criteria);
      if (valueEntries.length === 0 || criteriaEntries.length === 0) {
        throw new ApiError(400, "ROW_UPDATE_INVALID", "更新値と検索条件の両方が必要です。");
      }

      const setClause = valueEntries.map(([key]) => `${this.quoteIdentifier(key)} = ?`).join(", ");
      const whereClause = criteriaEntries
        .map(([key]) => `${this.quoteIdentifier(key)} = ?`)
        .join(" AND ");

      const [result] = await connection.execute<mysql.ResultSetHeader>(
        `UPDATE ${this.quoteIdentifier(params.database)}.${this.quoteIdentifier(params.table)}
         SET ${setClause}
         WHERE ${whereClause}`,
        [
          ...valueEntries.map(([, value]) => value as mysql.ExecuteValues),
          ...criteriaEntries.map(([, value]) => value as mysql.ExecuteValues),
        ] as mysql.ExecuteValues[],
      );

      return {
        affectedRows: result.affectedRows,
        message: "行を更新しました。",
      };
    });
  }

  async deleteRow(
    config: ResolvedConnectionConfig,
    params: RowMutationParams,
  ): Promise<MutationResult> {
    return this.withConnection(config, params.database, async (connection) => {
      const criteriaEntries = Object.entries(params.criteria);
      if (criteriaEntries.length === 0) {
        throw new ApiError(400, "ROW_DELETE_CRITERIA_REQUIRED", "削除条件が必要です。");
      }

      const whereClause = criteriaEntries
        .map(([key]) => `${this.quoteIdentifier(key)} = ?`)
        .join(" AND ");

      const [result] = await connection.execute<mysql.ResultSetHeader>(
        `DELETE FROM ${this.quoteIdentifier(params.database)}.${this.quoteIdentifier(params.table)}
         WHERE ${whereClause}`,
        criteriaEntries.map(([, value]) => value as mysql.ExecuteValues) as mysql.ExecuteValues[],
      );

      return {
        affectedRows: result.affectedRows,
        message: "行を削除しました。",
      };
    });
  }

  async createTable(
    config: ResolvedConnectionConfig,
    params: CreateTableParams,
  ): Promise<MutationResult> {
    return this.withConnection(config, params.database, async (connection) => {
      const primaryKeys = params.columns
        .filter((column) => column.primaryKey)
        .map((column) => this.quoteIdentifier(column.name));
      const columnDefinitions = params.columns.map((column) => this.buildColumnDefinition(column));
      if (primaryKeys.length > 0) {
        columnDefinitions.push(`PRIMARY KEY (${primaryKeys.join(", ")})`);
      }

      await connection.query(
        `CREATE TABLE ${this.quoteIdentifier(params.database)}.${this.quoteIdentifier(params.name)} (${columnDefinitions.join(", ")})`,
      );
      return {
        affectedRows: 1,
        message: "テーブルを作成しました。",
      };
    });
  }

  async renameTable(
    config: ResolvedConnectionConfig,
    params: RenameTableParams,
  ): Promise<MutationResult> {
    return this.withConnection(config, params.database, async (connection) => {
      await connection.query(
        `RENAME TABLE ${this.quoteIdentifier(params.database)}.${this.quoteIdentifier(params.table)}
         TO ${this.quoteIdentifier(params.database)}.${this.quoteIdentifier(params.nextName)}`,
      );
      return {
        affectedRows: 1,
        message: "テーブル名を変更しました。",
      };
    });
  }

  async dropTable(
    config: ResolvedConnectionConfig,
    database: string,
    _schema: string,
    table: string,
  ): Promise<MutationResult> {
    return this.withConnection(config, database, async (connection) => {
      await connection.query(
        `DROP TABLE ${this.quoteIdentifier(database)}.${this.quoteIdentifier(table)}`,
      );
      return {
        affectedRows: 1,
        message: "テーブルを削除しました。",
      };
    });
  }

  async truncateTable(
    config: ResolvedConnectionConfig,
    database: string,
    _schema: string,
    table: string,
  ): Promise<MutationResult> {
    return this.withConnection(config, database, async (connection) => {
      await connection.query(
        `TRUNCATE TABLE ${this.quoteIdentifier(database)}.${this.quoteIdentifier(table)}`,
      );
      return {
        affectedRows: 1,
        message: "テーブルを空にしました。",
      };
    });
  }

  async addColumn(
    config: ResolvedConnectionConfig,
    params: AddColumnParams,
  ): Promise<MutationResult> {
    return this.withConnection(config, params.database, async (connection) => {
      await connection.query(
        `ALTER TABLE ${this.quoteIdentifier(params.database)}.${this.quoteIdentifier(params.table)}
         ADD COLUMN ${this.buildColumnDefinition(params.column)}`,
      );
      return {
        affectedRows: 1,
        message: "カラムを追加しました。",
      };
    });
  }

  async dropColumn(
    config: ResolvedConnectionConfig,
    database: string,
    _schema: string,
    table: string,
    column: string,
  ): Promise<MutationResult> {
    return this.withConnection(config, database, async (connection) => {
      await connection.query(
        `ALTER TABLE ${this.quoteIdentifier(database)}.${this.quoteIdentifier(table)}
         DROP COLUMN ${this.quoteIdentifier(column)}`,
      );
      return {
        affectedRows: 1,
        message: "カラムを削除しました。",
      };
    });
  }

  async createIndex(
    config: ResolvedConnectionConfig,
    params: CreateIndexParams,
  ): Promise<MutationResult> {
    return this.withConnection(config, params.database, async (connection) => {
      await connection.query(
        `CREATE ${params.unique ? "UNIQUE " : ""}INDEX ${this.quoteIdentifier(params.name)}
         ON ${this.quoteIdentifier(params.database)}.${this.quoteIdentifier(params.table)}
         (${params.columns.map((column) => this.quoteIdentifier(column)).join(", ")})`,
      );
      return {
        affectedRows: 1,
        message: "インデックスを作成しました。",
      };
    });
  }

  async dropIndex(
    config: ResolvedConnectionConfig,
    database: string,
    _schema: string,
    table: string,
    index: string,
  ): Promise<MutationResult> {
    return this.withConnection(config, database, async (connection) => {
      await connection.query(
        `DROP INDEX ${this.quoteIdentifier(index)} ON ${this.quoteIdentifier(database)}.${this.quoteIdentifier(table)}`,
      );
      return {
        affectedRows: 1,
        message: "インデックスを削除しました。",
      };
    });
  }

  async importCsv(
    config: ResolvedConnectionConfig,
    params: ImportCsvParams,
  ): Promise<MutationResult> {
    return this.withConnection(config, params.database, async (connection) => {
      const { headers, records } = parseCsvContent(params.csv, params.delimiter);
      if (records.length === 0) {
        return {
          affectedRows: 0,
          message: "CSV にインポート対象の行がありませんでした。",
        };
      }

      const columns = await this.getColumns(config, params.database, params.schema, params.table);
      const availableColumns = new Set(columns.map((column) => column.name));
      const missingColumns = headers.filter((header) => !availableColumns.has(header));
      if (missingColumns.length > 0) {
        throw new ApiError(
          400,
          "CSV_UNKNOWN_COLUMNS",
          `CSV に存在しない列が含まれています: ${missingColumns.join(", ")}`,
        );
      }

      const columnClause = headers.map((header) => this.quoteIdentifier(header)).join(", ");
      const placeholderClause = headers.map(() => "?").join(", ");
      let affectedRows = 0;

      await connection.beginTransaction();
      try {
        if (params.truncateBeforeImport) {
          await connection.query(
            `TRUNCATE TABLE ${this.quoteIdentifier(params.database)}.${this.quoteIdentifier(params.table)}`,
          );
        }

        for (const record of records) {
          const values = headers.map((header) => record[header]);
          const [result] = await connection.execute<mysql.ResultSetHeader>(
            `INSERT INTO ${this.quoteIdentifier(params.database)}.${this.quoteIdentifier(params.table)} (${columnClause})
             VALUES (${placeholderClause})`,
            values as mysql.ExecuteValues[],
          );
          affectedRows += result.affectedRows;
        }

        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      }

      return {
        affectedRows,
        message: `${affectedRows} 行を CSV から取り込みました。`,
      };
    });
  }

  async listSessions(
    config: ResolvedConnectionConfig,
    database?: string,
  ): Promise<ServerSessionInfo[]> {
    return this.withConnection(config, database ?? config.defaultDatabase, async (connection) => {
      const [rows] = await connection.query<MySqlRow[]>("SHOW FULL PROCESSLIST");
      return rows.map((row) => ({
        id: String(row.Id ?? row.id ?? ""),
        user: String(row.User ?? row.user ?? ""),
        database: row.db == null ? null : String(row.db),
        schema: row.db == null ? null : String(row.db),
        host: row.Host == null ? null : String(row.Host),
        state: row.State == null ? null : String(row.State),
        command: row.Command == null ? null : String(row.Command),
        query: row.Info == null ? null : String(row.Info),
        durationSeconds: row.Time == null ? null : Number(row.Time),
      }));
    });
  }

  async listServerVariables(
    config: ResolvedConnectionConfig,
    database?: string,
  ): Promise<ServerVariableInfo[]> {
    return this.withConnection(config, database ?? config.defaultDatabase, async (connection) => {
      const [rows] = await connection.query<MySqlRow[]>("SHOW VARIABLES");
      return rows.map((row) => ({
        name: String(row.Variable_name ?? row.variable_name ?? ""),
        value: String(row.Value ?? row.value ?? ""),
        scope: "runtime" as const,
      }));
    });
  }

  async listServerMetrics(
    config: ResolvedConnectionConfig,
    database?: string,
  ): Promise<ServerMetricInfo[]> {
    return this.withConnection(config, database ?? config.defaultDatabase, async (connection) => {
      const [rows] = await connection.query<MySqlRow[]>("SHOW GLOBAL STATUS");
      return rows.map((row) => {
        const name = String(row.Variable_name ?? row.variable_name ?? "");
        return {
          name,
          value: String(row.Value ?? row.value ?? ""),
          category: this.categorizeMetric(name),
        };
      });
    });
  }

  async executeSql(config: ResolvedConnectionConfig, sql: string): Promise<QueryExecutionResult> {
    return this.withConnection(config, config.defaultDatabase, async (connection) => {
      const statements = splitSqlStatements(sql);

      const results: QueryExecutionResult["statements"] = [];
      for (const statement of statements) {
        const startedAt = Date.now();
        const [rows, fields] = await connection.query<MySqlRow[]>(statement);

        if (Array.isArray(rows)) {
          results.push({
            sql: statement,
            statementType: this.detectStatementType(statement),
            result: {
              columns: fields.map((field) => ({
                name: field.name,
                dataType: String(field.columnType),
              })),
              rows,
              rowCount: rows.length,
              executionTimeMs: Date.now() - startedAt,
            },
          });
        } else {
          const resultHeader = rows as mysql.ResultSetHeader;
          results.push({
            sql: statement,
            statementType: this.detectStatementType(statement),
            result: {
              columns: [],
              rows: [],
              rowCount: 0,
              affectedRows: resultHeader.affectedRows,
              executionTimeMs: Date.now() - startedAt,
            },
            message: `${resultHeader.affectedRows} row(s) affected`,
          });
        }
      }

      return { statements: results };
    });
  }

  async listDatabaseUsers(config: ResolvedConnectionConfig): Promise<DatabaseUser[]> {
    return this.withConnection(config, config.defaultDatabase, async (connection) => {
      const [rows] = await connection.query<MySqlRow[]>(
        "SELECT User AS username, Host AS host FROM mysql.user ORDER BY User, Host",
      );

      return rows.map((row) => ({
        id: `${String(row.username)}@${String(row.host)}`,
        username: String(row.username),
        host: String(row.host),
        type: "user",
      }));
    });
  }

  async createDatabaseUser(
    config: ResolvedConnectionConfig,
    params: DatabaseUserMutationParams,
  ): Promise<MutationResult> {
    return this.withConnection(config, config.defaultDatabase, async (connection) => {
      const username = params.username;
      const host = params.host ?? "%";
      if (!username) {
        throw new ApiError(400, "DB_USER_NAME_REQUIRED", "ユーザー名が必要です。");
      }
      if (!params.password) {
        throw new ApiError(400, "DB_USER_PASSWORD_REQUIRED", "パスワードが必要です。");
      }
      await connection.query(`CREATE USER ${this.quoteUser(username, host)} IDENTIFIED BY ?`, [
        params.password,
      ] as mysql.QueryValues);
      return {
        affectedRows: 1,
        message: "DB ユーザーを作成しました。",
      };
    });
  }

  async updateDatabaseUser(
    config: ResolvedConnectionConfig,
    userId: string,
    params: DatabaseUserMutationParams,
  ): Promise<MutationResult> {
    return this.withConnection(config, config.defaultDatabase, async (connection) => {
      const [username = "", host = "%"] = userId.split("@");
      if (params.password) {
        await connection.query(`ALTER USER ${this.quoteUser(username, host)} IDENTIFIED BY ?`, [
          params.password,
        ] as mysql.QueryValues);
      }
      return {
        affectedRows: 1,
        message: "DB ユーザーを更新しました。",
      };
    });
  }

  async deleteDatabaseUser(
    config: ResolvedConnectionConfig,
    userId: string,
  ): Promise<MutationResult> {
    return this.withConnection(config, config.defaultDatabase, async (connection) => {
      const [username = "", host = "%"] = userId.split("@");
      await connection.query(`DROP USER ${this.quoteUser(username, host)}`);
      return {
        affectedRows: 1,
        message: "DB ユーザーを削除しました。",
      };
    });
  }

  async listDatabasePrivileges(
    config: ResolvedConnectionConfig,
    userId: string,
  ): Promise<DatabasePrivilege[]> {
    return this.withConnection(config, config.defaultDatabase, async (connection) => {
      const [username = "", host = "%"] = userId.split("@");
      const [rows] = await connection.query<MySqlStringRow[]>(
        `SHOW GRANTS FOR ${this.quoteUser(username, host)}`,
      );

      const privileges: DatabasePrivilege[] = [];
      for (const row of rows) {
        const grant = Object.values(row)[0];
        if (!grant) {
          continue;
        }

        const parsed = this.parseGrantStatement(userId, grant);
        privileges.push(...parsed);
      }

      return privileges;
    });
  }

  async grantPrivileges(
    config: ResolvedConnectionConfig,
    params: PrivilegeMutationParams,
  ): Promise<MutationResult> {
    return this.withConnection(
      config,
      params.database ?? config.defaultDatabase,
      async (connection) => {
        const [username = "", host = "%"] = params.userId.split("@");
        this.assertPrivilegesAllowed(params);
        const target = this.buildPrivilegeTarget(params);
        await connection.query(
          `GRANT ${params.privileges.join(", ")} ON ${target} TO ${this.quoteUser(username, host)}`,
        );
        return {
          affectedRows: 1,
          message: "権限を付与しました。",
        };
      },
    );
  }

  async revokePrivileges(
    config: ResolvedConnectionConfig,
    params: PrivilegeMutationParams,
  ): Promise<MutationResult> {
    return this.withConnection(
      config,
      params.database ?? config.defaultDatabase,
      async (connection) => {
        const [username = "", host = "%"] = params.userId.split("@");
        this.assertPrivilegesAllowed(params);
        const target = this.buildPrivilegeTarget(params);
        await connection.query(
          `REVOKE ${params.privileges.join(", ")} ON ${target} FROM ${this.quoteUser(username, host)}`,
        );
        return {
          affectedRows: 1,
          message: "権限を剥奪しました。",
        };
      },
    );
  }

  previewPrivilegeMutation(
    _config: ResolvedConnectionConfig,
    action: "grant" | "revoke",
    params: PrivilegeMutationParams,
  ) {
    const [username = "", host = "%"] = params.userId.split("@");
    this.assertPrivilegesAllowed(params);
    const target = this.buildPrivilegeTarget(params);
    const keyword = action === "grant" ? "GRANT" : "REVOKE";
    const direction = action === "grant" ? "TO" : "FROM";
    return `${keyword} ${params.privileges.join(", ")} ON ${target} ${direction} ${this.quoteUser(username, host)}`;
  }

  private quoteIdentifier(value: string) {
    return `\`${value.replace(/`/g, "``")}\``;
  }

  private quoteUser(username: string, host: string) {
    return `'${username.replace(/'/g, "''")}'@'${host.replace(/'/g, "''")}'`;
  }

  private buildFilterCondition(
    filter: { column: string; operator: string; value?: unknown },
    columnNames: Set<string>,
    bindValue: (value: unknown) => string,
  ) {
    if (!columnNames.has(filter.column)) {
      throw new ApiError(
        400,
        "ROW_FILTER_COLUMN_INVALID",
        `指定されたフィルタ列 ${filter.column} は存在しません。`,
      );
    }

    const column = this.quoteIdentifier(filter.column);
    if (filter.operator === "is-null") {
      return `${column} IS NULL`;
    }
    if (filter.operator === "not-null") {
      return `${column} IS NOT NULL`;
    }

    const value = this.requireFilterValue(filter.value);
    switch (filter.operator) {
      case "contains":
        return `${column} LIKE ${bindValue(`%${value}%`)}`;
      case "starts":
        return `${column} LIKE ${bindValue(`${value}%`)}`;
      case "ends":
        return `${column} LIKE ${bindValue(`%${value}`)}`;
      case "not":
        return `${column} <> ${bindValue(value)}`;
      case "gt":
        return `${column} > ${bindValue(value)}`;
      case "gte":
        return `${column} >= ${bindValue(value)}`;
      case "lt":
        return `${column} < ${bindValue(value)}`;
      case "lte":
        return `${column} <= ${bindValue(value)}`;
      default:
        return `${column} = ${bindValue(value)}`;
    }
  }

  private requireFilterValue(value: unknown) {
    if (value == null || (typeof value === "string" && value.trim().length === 0)) {
      throw new ApiError(400, "ROW_FILTER_VALUE_REQUIRED", "フィルタ値が必要です。");
    }
    return value;
  }

  private assertSafeSqlFragment(value: string, label: string) {
    if (/[;\0]|--|\/\*|\*\//.test(value)) {
      throw new ApiError(400, "UNSAFE_SQL_FRAGMENT", `${label} に危険な構文が含まれています。`);
    }
  }

  private assertPrivilegesAllowed(params: PrivilegeMutationParams) {
    if (params.objectType === "role_membership") {
      throw new ApiError(
        400,
        "MYSQL_ROLE_MEMBERSHIP_UNSUPPORTED",
        "MySQL/MariaDB ではこの role membership 操作は未対応です。",
      );
    }

    const allowedPrivileges = new Set([
      "SELECT",
      "INSERT",
      "UPDATE",
      "DELETE",
      "CREATE",
      "ALTER",
      "DROP",
      "INDEX",
      "REFERENCES",
      "CREATE TABLESPACE",
      "CREATE VIEW",
      "SHOW VIEW",
      "CREATE ROUTINE",
      "ALTER ROUTINE",
      "EXECUTE",
      "EVENT",
      "TRIGGER",
      "CREATE TEMPORARY TABLES",
      "LOCK TABLES",
      "GRANT OPTION",
      "CREATE USER",
      "PROCESS",
      "FILE",
      "RELOAD",
      "SHOW DATABASES",
      "REPLICATION CLIENT",
      "REPLICATION SLAVE",
      "SHUTDOWN",
      "SUPER",
    ]);
    for (const privilege of params.privileges) {
      if (!allowedPrivileges.has(privilege.toUpperCase())) {
        throw new ApiError(400, "DB_PRIVILEGE_INVALID", `未対応の権限です: ${privilege}`);
      }
    }
  }

  private buildPrivilegeTarget(params: PrivilegeMutationParams) {
    if (params.objectType === "global") {
      return "*.*";
    }
    if (params.objectType === "database") {
      return `${this.quoteIdentifier(params.database ?? "*")}.*`;
    }
    if (params.objectType === "table") {
      return `${this.quoteIdentifier(params.database ?? "*")}.${this.quoteIdentifier(params.table ?? "*")}`;
    }

    return `${this.quoteIdentifier(params.database ?? "*")}.*`;
  }

  private buildColumnDefinition(column: {
    name: string;
    type: string;
    nullable: boolean;
    defaultValue?: string;
    autoIncrement?: boolean;
  }) {
    this.assertSafeSqlFragment(column.type, "カラム型");
    const segments = [this.quoteIdentifier(column.name), column.type];

    if (column.autoIncrement) {
      segments.push("AUTO_INCREMENT");
    }
    segments.push(column.nullable ? "NULL" : "NOT NULL");
    if (column.defaultValue && column.defaultValue.trim().length > 0) {
      this.assertSafeSqlFragment(column.defaultValue, "デフォルト値");
      segments.push(`DEFAULT ${column.defaultValue.trim()}`);
    }

    return segments.join(" ");
  }

  private parseGrantStatement(userId: string, grant: string): DatabasePrivilege[] {
    const match = grant.match(/^GRANT\s+(.+)\s+ON\s+(.+)\s+TO\s+/i);
    if (!match) {
      return [
        {
          id: `${userId}-raw-${grant}`,
          userId,
          objectType: "global",
          privilege: grant,
          source: "raw",
        },
      ];
    }

    const privilegeSegment = match[1] ?? "";
    const target = (match[2] ?? "").trim();
    const privileges = privilegeSegment.split(",").map((item) => item.trim());
    const parsedTarget =
      target === "*.*"
        ? { objectType: "global" as const }
        : target.endsWith(".*")
          ? {
              objectType: "database" as const,
              database: target.replace(/`\.\*$/g, "").replaceAll("`", ""),
            }
          : {
              objectType: "table" as const,
              database: target.split(".")[0]?.replaceAll("`", ""),
              table: target.split(".")[1]?.replaceAll("`", ""),
            };

    return privileges.map((privilege) => ({
      id: `${userId}-${parsedTarget.objectType}-${privilege}-${target}`,
      userId,
      objectType: parsedTarget.objectType,
      privilege,
      database: parsedTarget.database,
      table: parsedTarget.table,
      source: "direct",
    }));
  }

  private categorizeMetric(name: string) {
    if (/threads|connections/i.test(name)) {
      return "connections";
    }
    if (/innodb|buffer|cache|key/i.test(name)) {
      return "storage";
    }
    if (/queries|com_|select|insert|update|delete/i.test(name)) {
      return "queries";
    }
    return "server";
  }

  private wrapError(error: unknown) {
    if (error instanceof ApiError) {
      return error;
    }
    const apiError = new ApiError(
      400,
      "MYSQL_OPERATION_FAILED",
      "MySQL 操作に失敗しました。接続状態、権限、SQL を確認してください。",
    );
    if (error instanceof Error) {
      (apiError as Error & { cause?: unknown }).cause = error;
      return apiError;
    }
    return apiError;
  }

  private detectStatementType(statement: string) {
    return statement.trim().split(/\s+/)[0]?.toLowerCase() ?? "select";
  }

  async closeConnection(connectionId: string) {
    const targets = [...this.pools.entries()].filter(([key]) =>
      key.startsWith(`${connectionId}\u001f`),
    );
    await Promise.all(
      targets.map(async ([key, pool]) => {
        this.pools.delete(key);
        await pool.end();
      }),
    );
  }

  async closeAll() {
    const pools = [...this.pools.values()];
    this.pools.clear();
    await Promise.all(pools.map((pool) => pool.end()));
  }
}
