import { Pool, type PoolClient } from "pg";
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

type PgServerInfoRow = {
  version?: string;
  current_user?: string;
  current_database?: string;
  current_schema?: string;
};

type PgNamedRow = {
  name: string;
};

type PgTableRow = {
  name: string;
  schema_name: string;
  table_type: string;
  estimated_rows: number | null;
  size_bytes: number | null;
  comment: string | null;
};

type PgColumnRow = {
  name: string;
  data_type: string;
  is_nullable: string;
  default_value: string | null;
  comment: string | null;
  primary_key: boolean;
};

type PgIndexRow = {
  index_name: string;
  index_def: string;
};

type PgRoleRow = {
  rolname: string;
  rolcanlogin: boolean;
  rolsuper: boolean;
  rolcreatedb: boolean;
  rolcreaterole: boolean;
  rolreplication: boolean;
  rolbypassrls: boolean;
};

type PgDatabasePrivilegeRow = {
  datname: string;
  privilege_type: string;
  is_grantable: boolean;
  grantee: number;
};

type PgSchemaPrivilegeRow = {
  nspname: string;
  privilege_type: string;
  is_grantable: boolean;
  grantee: number;
};

type PgTablePrivilegeRow = {
  table_catalog: string;
  table_schema: string;
  table_name: string;
  privilege_type: string;
  is_grantable: string;
  grantee: string;
};

type PgMembershipRow = {
  source_role: string;
};

type PgCountRow = {
  total_count: string | number;
};

type PgObjectRow = {
  name: string;
  schema_name?: string;
  definition?: string | null;
  related_table?: string | null;
  routine_type?: string | null;
};

export class PostgreSqlAdapter implements DatabaseAdapter {
  private readonly pools = new Map<string, Pool>();

  private async withClient<T>(
    config: ResolvedConnectionConfig,
    databaseOverride: string | null,
    callback: (client: PoolClient) => Promise<T>,
  ) {
    const pool = this.getPool(config, databaseOverride);
    const client = await pool.connect();

    try {
      return await callback(client);
    } catch (error) {
      throw this.wrapError(error);
    } finally {
      client.release();
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
      databaseOverride ?? config.defaultDatabase ?? "postgres",
      config.useSsl ? "ssl" : "plain",
    ].join("\u001f");
    const currentPool = this.pools.get(poolKey);
    if (currentPool) {
      return currentPool;
    }

    const pool = new Pool({
      host: config.host,
      port: config.port,
      user: config.username,
      password: config.password,
      database: databaseOverride ?? config.defaultDatabase ?? "postgres",
      ssl: config.useSsl ? { rejectUnauthorized: true } : undefined,
      connectionTimeoutMillis: 3000,
      statement_timeout: 30000,
      max: 10,
      idleTimeoutMillis: 30000,
    });
    this.pools.set(poolKey, pool);
    return pool;
  }

  async testConnection(config: ResolvedConnectionConfig) {
    return this.getServerInfo(config);
  }

  async getServerInfo(
    config: ResolvedConnectionConfig,
    databaseOverride?: string,
  ): Promise<ServerInfo> {
    return this.withClient(config, databaseOverride ?? config.defaultDatabase, async (client) => {
      const result = await client.query<PgServerInfoRow>(
        `SELECT
             version() AS version,
             current_user AS current_user,
             current_database() AS current_database,
             current_schema() AS current_schema`,
      );
      const row = result.rows[0] ?? {};
      return {
        dialect: config.dialect,
        version: String(row.version ?? "unknown"),
        currentUser: String(row.current_user ?? config.username),
        host: config.host,
        database: row.current_database ? String(row.current_database) : null,
        schema: row.current_schema ? String(row.current_schema) : null,
      };
    });
  }

  async listDatabases(config: ResolvedConnectionConfig) {
    const queryDatabases = async (database: string | null) =>
      this.withClient(config, database, async (client) => {
        const result = await client.query<PgNamedRow>(
          `SELECT datname AS name
           FROM pg_database
           WHERE datistemplate = false
           ORDER BY datname`,
        );
        return result.rows.map((row) => ({ name: String(row.name) }));
      });

    try {
      return await queryDatabases("postgres");
    } catch {
      return queryDatabases(config.defaultDatabase);
    }
  }

  async createDatabase(
    config: ResolvedConnectionConfig,
    database: string,
  ): Promise<MutationResult> {
    return this.withClient(config, "postgres", async (client) => {
      await client.query(`CREATE DATABASE ${this.quoteIdentifier(database)}`);
      return {
        affectedRows: 1,
        message: "database を作成しました。",
      };
    });
  }

  async listSchemas(config: ResolvedConnectionConfig, database: string) {
    return this.withClient(config, database, async (client) => {
      const result = await client.query<PgNamedRow>(
        `SELECT schema_name AS name
         FROM information_schema.schemata
         WHERE schema_name NOT IN ('information_schema')
           AND schema_name NOT LIKE 'pg_%'
         ORDER BY schema_name`,
      );
      return result.rows.map((row) => ({ name: String(row.name) }));
    });
  }

  async listTables(
    config: ResolvedConnectionConfig,
    database: string,
    schema: string,
  ): Promise<TableInfo[]> {
    return this.withClient(config, database, async (client) => {
      const result = await client.query<PgTableRow>(
        `SELECT
           t.table_name AS name,
           t.table_schema AS schema_name,
           t.table_type AS table_type,
           c.reltuples::bigint AS estimated_rows,
           pg_total_relation_size(c.oid) AS size_bytes,
           obj_description(c.oid) AS comment
         FROM information_schema.tables t
         LEFT JOIN pg_class c ON c.relname = t.table_name
         LEFT JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = t.table_schema
         WHERE t.table_schema = $1
         ORDER BY t.table_name`,
        [schema],
      );

      return result.rows.map((row) => ({
        name: String(row.name),
        schema: String(row.schema_name),
        type: row.table_type === "VIEW" ? "view" : "table",
        estimatedRows: row.estimated_rows == null ? undefined : Number(row.estimated_rows),
        sizeBytes: row.size_bytes == null ? undefined : Number(row.size_bytes),
        comment: row.comment ? String(row.comment) : undefined,
      }));
    });
  }

  async getColumns(
    config: ResolvedConnectionConfig,
    database: string,
    schema: string,
    table: string,
  ): Promise<ColumnInfo[]> {
    return this.withClient(config, database, async (client) => {
      const result = await client.query<PgColumnRow>(
        `SELECT
           c.column_name AS name,
           c.data_type AS data_type,
           c.is_nullable AS is_nullable,
           c.column_default AS default_value,
           pgd.description AS comment,
           EXISTS (
             SELECT 1
             FROM information_schema.table_constraints tc
             JOIN information_schema.key_column_usage kcu
               ON tc.constraint_name = kcu.constraint_name
              AND tc.table_schema = kcu.table_schema
             WHERE tc.constraint_type = 'PRIMARY KEY'
               AND tc.table_schema = c.table_schema
               AND tc.table_name = c.table_name
               AND kcu.column_name = c.column_name
           ) AS primary_key
         FROM information_schema.columns c
         LEFT JOIN pg_catalog.pg_statio_all_tables st
           ON st.schemaname = c.table_schema AND st.relname = c.table_name
         LEFT JOIN pg_catalog.pg_description pgd
           ON pgd.objoid = st.relid AND pgd.objsubid = c.ordinal_position
         WHERE c.table_schema = $1
           AND c.table_name = $2
         ORDER BY c.ordinal_position`,
        [schema, table],
      );

      return result.rows.map((row) => ({
        name: String(row.name),
        type: String(row.data_type),
        nullable: row.is_nullable === "YES",
        primaryKey: Boolean(row.primary_key),
        defaultValue: row.default_value == null ? null : String(row.default_value),
        autoIncrement: /nextval|identity/i.test(String(row.default_value ?? "")),
        comment: row.comment ? String(row.comment) : undefined,
      }));
    });
  }

  async getIndexes(
    config: ResolvedConnectionConfig,
    database: string,
    schema: string,
    table: string,
  ): Promise<IndexInfo[]> {
    return this.withClient(config, database, async (client) => {
      const result = await client.query<PgIndexRow>(
        `SELECT
           indexname AS index_name,
           indexdef AS index_def
         FROM pg_indexes
         WHERE schemaname = $1
           AND tablename = $2
         ORDER BY indexname`,
        [schema, table],
      );

      return result.rows.map((row) => {
        const definition = String(row.index_def);
        const columnsMatch = definition.match(/\((.*)\)/);
        const matchedColumns = columnsMatch?.[1];
        return {
          name: String(row.index_name),
          columns: matchedColumns
            ? matchedColumns.split(",").map((column) => column.trim().replace(/"/g, ""))
            : [],
          unique: definition.includes("UNIQUE"),
          primary: definition.includes("PRIMARY KEY"),
          type: definition.includes("USING")
            ? (definition.split("USING")[1]?.trim().split(" ")[0] ?? "btree")
            : "btree",
          definition,
        };
      });
    });
  }

  async listDatabaseObjects(
    config: ResolvedConnectionConfig,
    database: string,
    schema: string,
  ): Promise<DatabaseObjectInfo[]> {
    return this.withClient(config, database, async (client) => {
      const objects: DatabaseObjectInfo[] = [];

      const viewResult = await client.query<PgObjectRow>(
        `SELECT schemaname AS schema_name, viewname AS name, definition
         FROM pg_views
         WHERE schemaname = $1
         ORDER BY viewname`,
        [schema],
      );
      objects.push(
        ...viewResult.rows.map((row) => ({
          id: `${database}:${schema}:view:${row.name}`,
          kind: "view" as const,
          database,
          schema: String(row.schema_name ?? schema),
          name: String(row.name),
          definition: row.definition == null ? null : String(row.definition),
        })),
      );

      const triggerResult = await client.query<PgObjectRow>(
        `SELECT
           t.tgname AS name,
           c.relname AS related_table,
           pg_get_triggerdef(t.oid, true) AS definition
         FROM pg_trigger t
         INNER JOIN pg_class c ON c.oid = t.tgrelid
         INNER JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = $1
           AND NOT t.tgisinternal
         ORDER BY t.tgname`,
        [schema],
      );
      objects.push(
        ...triggerResult.rows.map((row) => {
          const definition = row.definition == null ? null : String(row.definition);
          return {
            id: `${database}:${schema}:trigger:${row.name}`,
            kind: "trigger" as const,
            database,
            schema,
            name: String(row.name),
            relatedTable: row.related_table == null ? undefined : String(row.related_table),
            definition,
            timing: definition?.match(/\b(BEFORE|AFTER|INSTEAD OF)\b/i)?.[1]?.toUpperCase(),
            event: definition?.match(/\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/i)?.[1]?.toUpperCase(),
          };
        }),
      );

      const routineResult = await client.query<PgObjectRow>(
        `SELECT
           p.proname AS name,
           n.nspname AS schema_name,
           CASE p.prokind WHEN 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END AS routine_type,
           pg_get_functiondef(p.oid) AS definition
         FROM pg_proc p
         INNER JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = $1
           AND p.prokind IN ('f', 'p')
         ORDER BY routine_type, p.proname`,
        [schema],
      );
      objects.push(
        ...routineResult.rows.map((row) => ({
          id: `${database}:${schema}:routine:${row.routine_type}:${row.name}`,
          kind: "routine" as const,
          database,
          schema: String(row.schema_name ?? schema),
          name: String(row.name),
          routineType: row.routine_type == null ? undefined : String(row.routine_type),
          definition: row.definition == null ? null : String(row.definition),
        })),
      );

      const sequenceResult = await client.query<PgObjectRow>(
        `SELECT sequence_schema AS schema_name, sequence_name AS name
         FROM information_schema.sequences
         WHERE sequence_schema = $1
         ORDER BY sequence_name`,
        [schema],
      );
      objects.push(
        ...sequenceResult.rows.map((row) => ({
          id: `${database}:${schema}:sequence:${row.name}`,
          kind: "sequence" as const,
          database,
          schema: String(row.schema_name ?? schema),
          name: String(row.name),
        })),
      );

      return objects;
    });
  }

  async getTableCreateSql(
    config: ResolvedConnectionConfig,
    database: string,
    schema: string,
    table: string,
  ): Promise<string> {
    const columns = await this.getColumns(config, database, schema, table);
    const indexes = await this.getIndexes(config, database, schema, table);
    if (columns.length === 0) {
      throw new ApiError(404, "TABLE_NOT_FOUND", "テーブル定義を取得できませんでした。");
    }

    const primaryKeys = columns.filter((column) => column.primaryKey).map((column) => column.name);
    const columnDefinitions = columns.map((column) => this.buildColumnDefinition(column));
    if (primaryKeys.length > 0) {
      columnDefinitions.push(
        `PRIMARY KEY (${primaryKeys.map((column) => this.quoteIdentifier(column)).join(", ")})`,
      );
    }

    const statements = [
      `CREATE TABLE ${this.quoteIdentifier(schema)}.${this.quoteIdentifier(table)} (\n  ${columnDefinitions.join(",\n  ")}\n);`,
    ];

    for (const index of indexes.filter((currentIndex) => !currentIndex.primary)) {
      if (index.definition) {
        statements.push(`${index.definition};`);
      }
    }

    return statements.join("\n\n");
  }

  async selectRows(
    config: ResolvedConnectionConfig,
    params: SelectRowsParams,
  ): Promise<QueryResult> {
    return this.withClient(config, params.database, async (client) => {
      const columns = await this.getColumns(config, params.database, params.schema, params.table);
      const columnNames = new Set(columns.map((column) => column.name));
      const quotedTable = `${this.quoteIdentifier(params.schema)}.${this.quoteIdentifier(params.table)}`;
      const whereParts: string[] = [];
      const values: unknown[] = [];
      let parameterIndex = 1;

      for (const filter of params.filters) {
        const condition = this.buildFilterCondition(filter, columnNames, (value) => {
          values.push(value);
          return `$${parameterIndex++}`;
        });
        whereParts.push(condition);
      }

      if (params.search) {
        const searchableColumns = columns.map((column) => this.quoteIdentifier(column.name));
        if (searchableColumns.length > 0) {
          whereParts.push(
            `(${searchableColumns
              .map((column) => `CAST(${column} AS TEXT) ILIKE $${parameterIndex++}`)
              .join(" OR ")})`,
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
      const countResult = await client.query<PgCountRow>(
        `SELECT COUNT(*)::bigint AS total_count FROM ${quotedTable} ${whereClause}`,
        values,
      );
      values.push(params.pageSize, offset);
      const sql = `SELECT * FROM ${quotedTable} ${whereClause} ORDER BY ${orderBy} ${params.orderDir.toUpperCase()} LIMIT $${parameterIndex++} OFFSET $${parameterIndex++}`;
      const result = await client.query<Record<string, unknown>>(sql, values);
      const totalCount = Number(countResult.rows[0]?.total_count ?? result.rows.length);

      return {
        columns: result.fields.map((field) => ({
          name: field.name,
          dataType: field.dataTypeID.toString(),
        })),
        rows: result.rows,
        rowCount: totalCount,
        executionTimeMs: Date.now() - startedAt,
      };
    });
  }

  async readTableData(
    config: ResolvedConnectionConfig,
    database: string,
    schema: string,
    table: string,
  ): Promise<QueryResult> {
    return this.withClient(config, database, async (client) => {
      const startedAt = Date.now();
      const result = await client.query<Record<string, unknown>>(
        `SELECT * FROM ${this.quoteIdentifier(schema)}.${this.quoteIdentifier(table)}`,
      );
      return {
        columns: result.fields.map((field) => ({
          name: field.name,
          dataType: field.dataTypeID.toString(),
        })),
        rows: result.rows,
        rowCount: result.rows.length,
        executionTimeMs: Date.now() - startedAt,
      };
    });
  }

  async insertRow(
    config: ResolvedConnectionConfig,
    params: RowMutationParams,
  ): Promise<MutationResult> {
    return this.withClient(config, params.database, async (client) => {
      const entries = Object.entries(params.values);
      if (entries.length === 0) {
        throw new ApiError(400, "ROW_VALUES_REQUIRED", "追加する値が必要です。");
      }

      const columns = entries.map(([key]) => this.quoteIdentifier(key)).join(", ");
      const placeholders = entries.map((_, index) => `$${index + 1}`).join(", ");
      const result = await client.query(
        `INSERT INTO ${this.quoteIdentifier(params.schema)}.${this.quoteIdentifier(params.table)} (${columns}) VALUES (${placeholders})`,
        entries.map(([, value]) => value),
      );

      return {
        affectedRows: result.rowCount ?? 0,
        message: "行を追加しました。",
      };
    });
  }

  async updateRow(
    config: ResolvedConnectionConfig,
    params: RowMutationParams,
  ): Promise<MutationResult> {
    return this.withClient(config, params.database, async (client) => {
      const valueEntries = Object.entries(params.values);
      const criteriaEntries = Object.entries(params.criteria);
      if (valueEntries.length === 0 || criteriaEntries.length === 0) {
        throw new ApiError(400, "ROW_UPDATE_INVALID", "更新値と検索条件の両方が必要です。");
      }

      const setClause = valueEntries
        .map(([key], index) => `${this.quoteIdentifier(key)} = $${index + 1}`)
        .join(", ");
      const whereClause = criteriaEntries
        .map(([key], index) => `${this.quoteIdentifier(key)} = $${valueEntries.length + index + 1}`)
        .join(" AND ");
      const result = await client.query(
        `UPDATE ${this.quoteIdentifier(params.schema)}.${this.quoteIdentifier(params.table)}
         SET ${setClause}
         WHERE ${whereClause}`,
        [...valueEntries.map(([, value]) => value), ...criteriaEntries.map(([, value]) => value)],
      );

      return {
        affectedRows: result.rowCount ?? 0,
        message: "行を更新しました。",
      };
    });
  }

  async deleteRow(
    config: ResolvedConnectionConfig,
    params: RowMutationParams,
  ): Promise<MutationResult> {
    return this.withClient(config, params.database, async (client) => {
      const criteriaEntries = Object.entries(params.criteria);
      if (criteriaEntries.length === 0) {
        throw new ApiError(400, "ROW_DELETE_CRITERIA_REQUIRED", "削除条件が必要です。");
      }

      const whereClause = criteriaEntries
        .map(([key], index) => `${this.quoteIdentifier(key)} = $${index + 1}`)
        .join(" AND ");
      const result = await client.query(
        `DELETE FROM ${this.quoteIdentifier(params.schema)}.${this.quoteIdentifier(params.table)}
         WHERE ${whereClause}`,
        criteriaEntries.map(([, value]) => value),
      );

      return {
        affectedRows: result.rowCount ?? 0,
        message: "行を削除しました。",
      };
    });
  }

  async createTable(
    config: ResolvedConnectionConfig,
    params: CreateTableParams,
  ): Promise<MutationResult> {
    return this.withClient(config, params.database, async (client) => {
      const primaryKeys = params.columns
        .filter((column) => column.primaryKey)
        .map((column) => this.quoteIdentifier(column.name));
      const columnDefinitions = params.columns.map((column) => this.buildColumnDefinition(column));
      if (primaryKeys.length > 0) {
        columnDefinitions.push(`PRIMARY KEY (${primaryKeys.join(", ")})`);
      }

      await client.query(
        `CREATE TABLE ${this.quoteIdentifier(params.schema)}.${this.quoteIdentifier(params.name)} (${columnDefinitions.join(", ")})`,
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
    return this.withClient(config, params.database, async (client) => {
      await client.query(
        `ALTER TABLE ${this.quoteIdentifier(params.schema)}.${this.quoteIdentifier(params.table)}
         RENAME TO ${this.quoteIdentifier(params.nextName)}`,
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
    schema: string,
    table: string,
  ): Promise<MutationResult> {
    return this.withClient(config, database, async (client) => {
      await client.query(
        `DROP TABLE ${this.quoteIdentifier(schema)}.${this.quoteIdentifier(table)}`,
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
    schema: string,
    table: string,
  ): Promise<MutationResult> {
    return this.withClient(config, database, async (client) => {
      await client.query(
        `TRUNCATE TABLE ${this.quoteIdentifier(schema)}.${this.quoteIdentifier(table)} RESTART IDENTITY`,
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
    return this.withClient(config, params.database, async (client) => {
      await client.query(
        `ALTER TABLE ${this.quoteIdentifier(params.schema)}.${this.quoteIdentifier(params.table)}
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
    schema: string,
    table: string,
    column: string,
  ): Promise<MutationResult> {
    return this.withClient(config, database, async (client) => {
      await client.query(
        `ALTER TABLE ${this.quoteIdentifier(schema)}.${this.quoteIdentifier(table)}
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
    return this.withClient(config, params.database, async (client) => {
      await client.query(
        `CREATE ${params.unique ? "UNIQUE " : ""}INDEX ${this.quoteIdentifier(params.name)}
         ON ${this.quoteIdentifier(params.schema)}.${this.quoteIdentifier(params.table)}
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
    schema: string,
    _table: string,
    index: string,
  ): Promise<MutationResult> {
    void _table;
    return this.withClient(config, database, async (client) => {
      await client.query(
        `DROP INDEX ${this.quoteIdentifier(schema)}.${this.quoteIdentifier(index)}`,
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
    return this.withClient(config, params.database, async (client) => {
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
      const placeholderClause = headers.map((_, index) => `$${index + 1}`).join(", ");
      let affectedRows = 0;

      await client.query("BEGIN");
      try {
        if (params.truncateBeforeImport) {
          await client.query(
            `TRUNCATE TABLE ${this.quoteIdentifier(params.schema)}.${this.quoteIdentifier(params.table)} RESTART IDENTITY`,
          );
        }

        for (const record of records) {
          const values = headers.map((header) => record[header]);
          const result = await client.query(
            `INSERT INTO ${this.quoteIdentifier(params.schema)}.${this.quoteIdentifier(params.table)} (${columnClause})
             VALUES (${placeholderClause})`,
            values,
          );
          affectedRows += result.rowCount ?? 0;
        }

        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
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
    return this.withClient(config, database ?? config.defaultDatabase, async (client) => {
      const result = await client.query<{
        session_id: string;
        usename: string;
        datname: string | null;
        client_addr: string | null;
        state: string | null;
        backend_type: string | null;
        query: string | null;
        duration_seconds: number | null;
      }>(
        `SELECT
           pid::text AS session_id,
           usename,
           datname,
           client_addr::text,
           state,
           backend_type,
           query,
           EXTRACT(EPOCH FROM (clock_timestamp() - COALESCE(query_start, backend_start)))::double precision AS duration_seconds
         FROM pg_stat_activity
         WHERE pid <> pg_backend_pid()
         ORDER BY COALESCE(query_start, backend_start) DESC NULLS LAST`,
      );

      return result.rows.map((row) => ({
        id: String(row.session_id),
        user: String(row.usename),
        database: row.datname,
        schema: null,
        host: row.client_addr,
        state: row.state,
        command: row.backend_type,
        query: row.query,
        durationSeconds:
          row.duration_seconds == null ? null : Number(row.duration_seconds.toFixed(2)),
      }));
    });
  }

  async listServerVariables(
    config: ResolvedConnectionConfig,
    database?: string,
  ): Promise<ServerVariableInfo[]> {
    return this.withClient(config, database ?? config.defaultDatabase, async (client) => {
      const result = await client.query<{ name: string; setting: string }>(
        `SELECT name, setting
         FROM pg_settings
         ORDER BY name`,
      );
      return result.rows.map((row) => ({
        name: String(row.name),
        value: String(row.setting),
        scope: "runtime" as const,
      }));
    });
  }

  async listServerMetrics(
    config: ResolvedConnectionConfig,
    database?: string,
  ): Promise<ServerMetricInfo[]> {
    return this.withClient(config, database ?? config.defaultDatabase, async (client) => {
      const result = await client.query<{
        name: string;
        value: string;
        category: string;
      }>(
        `SELECT * FROM (
           SELECT 'numbackends' AS name, numbackends::text AS value, 'connections' AS category
           FROM pg_stat_database
           WHERE datname = current_database()
           UNION ALL
           SELECT 'xact_commit', xact_commit::text, 'transactions'
           FROM pg_stat_database
           WHERE datname = current_database()
           UNION ALL
           SELECT 'xact_rollback', xact_rollback::text, 'transactions'
           FROM pg_stat_database
           WHERE datname = current_database()
           UNION ALL
           SELECT 'blks_read', blks_read::text, 'storage'
           FROM pg_stat_database
           WHERE datname = current_database()
           UNION ALL
           SELECT 'blks_hit', blks_hit::text, 'storage'
           FROM pg_stat_database
           WHERE datname = current_database()
           UNION ALL
           SELECT 'tup_returned', tup_returned::text, 'queries'
           FROM pg_stat_database
           WHERE datname = current_database()
           UNION ALL
           SELECT 'tup_fetched', tup_fetched::text, 'queries'
           FROM pg_stat_database
           WHERE datname = current_database()
           UNION ALL
           SELECT 'tup_inserted', tup_inserted::text, 'queries'
           FROM pg_stat_database
           WHERE datname = current_database()
           UNION ALL
           SELECT 'tup_updated', tup_updated::text, 'queries'
           FROM pg_stat_database
           WHERE datname = current_database()
           UNION ALL
           SELECT 'tup_deleted', tup_deleted::text, 'queries'
           FROM pg_stat_database
           WHERE datname = current_database()
           UNION ALL
           SELECT 'deadlocks', deadlocks::text, 'locks'
           FROM pg_stat_database
           WHERE datname = current_database()
         ) metrics
         ORDER BY category, name`,
      );

      return result.rows.map((row) => ({
        name: String(row.name),
        value: String(row.value),
        category: String(row.category),
      }));
    });
  }

  async executeSql(config: ResolvedConnectionConfig, sql: string): Promise<QueryExecutionResult> {
    return this.withClient(config, config.defaultDatabase, async (client) => {
      const statements = splitSqlStatements(sql);

      const results: QueryExecutionResult["statements"] = [];
      for (const statement of statements) {
        const startedAt = Date.now();
        const result = await client.query<Record<string, unknown>>(statement);
        results.push({
          sql: statement,
          statementType: this.detectStatementType(statement),
          result: {
            columns: result.fields.map((field) => ({
              name: field.name,
              dataType: field.dataTypeID.toString(),
            })),
            rows: result.rows,
            rowCount: result.rowCount ?? result.rows.length,
            affectedRows: result.command === "SELECT" ? undefined : (result.rowCount ?? 0),
            executionTimeMs: Date.now() - startedAt,
          },
          message: result.command,
        });
      }

      return { statements: results };
    });
  }

  async listDatabaseUsers(config: ResolvedConnectionConfig): Promise<DatabaseUser[]> {
    return this.withClient(config, config.defaultDatabase, async (client) => {
      const result = await client.query<PgRoleRow>(
        `SELECT
           rolname,
           rolcanlogin,
           rolsuper,
           rolcreatedb,
           rolcreaterole,
           rolreplication,
           rolbypassrls
         FROM pg_roles
         ORDER BY rolname`,
      );

      return result.rows.map((row) => ({
        id: String(row.rolname),
        username: String(row.rolname),
        type: "role",
        canLogin: Boolean(row.rolcanlogin),
        isSuperuser: Boolean(row.rolsuper),
        canCreateDatabase: Boolean(row.rolcreatedb),
        canCreateUser: Boolean(row.rolcreaterole),
        canReplication: Boolean(row.rolreplication),
        canBypassRls: Boolean(row.rolbypassrls),
      }));
    });
  }

  async createDatabaseUser(
    config: ResolvedConnectionConfig,
    params: DatabaseUserMutationParams,
  ): Promise<MutationResult> {
    return this.withClient(config, config.defaultDatabase, async (client) => {
      const username = params.username;
      if (!username) {
        throw new ApiError(400, "DB_ROLE_NAME_REQUIRED", "ロール名が必要です。");
      }
      const roleOptions = this.buildRoleOptionClauses(params, true);
      await client.query(
        `CREATE ROLE ${this.quoteIdentifier(username)} WITH ${roleOptions.join(" ")} PASSWORD $1`,
        [params.password],
      );
      return {
        affectedRows: 1,
        message: "DB role を作成しました。",
      };
    });
  }

  async updateDatabaseUser(
    config: ResolvedConnectionConfig,
    userId: string,
    params: DatabaseUserMutationParams,
  ): Promise<MutationResult> {
    return this.withClient(config, config.defaultDatabase, async (client) => {
      const roleOptions = this.buildRoleOptionClauses(params, false);
      if (params.password) {
        roleOptions.push("PASSWORD $1");
      }
      if (roleOptions.length > 0) {
        await client.query(
          `ALTER ROLE ${this.quoteIdentifier(userId)} WITH ${roleOptions.join(" ")}`,
          params.password ? [params.password] : [],
        );
      }
      return {
        affectedRows: 1,
        message: "DB role を更新しました。",
      };
    });
  }

  async deleteDatabaseUser(
    config: ResolvedConnectionConfig,
    userId: string,
  ): Promise<MutationResult> {
    return this.withClient(config, config.defaultDatabase, async (client) => {
      await client.query(`DROP ROLE ${this.quoteIdentifier(userId)}`);
      return {
        affectedRows: 1,
        message: "DB role を削除しました。",
      };
    });
  }

  async listDatabasePrivileges(
    config: ResolvedConnectionConfig,
    userId: string,
  ): Promise<DatabasePrivilege[]> {
    return this.withClient(config, config.defaultDatabase, async (client) => {
      const privileges: DatabasePrivilege[] = [];

      const databasePrivileges = await client.query<PgDatabasePrivilegeRow>(
        `SELECT d.datname, acl.privilege_type, acl.is_grantable, acl.grantee
         FROM pg_database d
         CROSS JOIN LATERAL aclexplode(COALESCE(d.datacl, acldefault('d', d.datdba))) acl
         LEFT JOIN pg_roles r ON acl.grantee = r.oid
         WHERE COALESCE(r.rolname, 'PUBLIC') IN ($1, 'PUBLIC')
           AND d.datistemplate = false`,
        [userId],
      );
      for (const row of databasePrivileges.rows) {
        privileges.push({
          id: `${userId}-database-${row.datname}-${row.privilege_type}-${row.grantee}`,
          userId,
          objectType: "database",
          database: String(row.datname),
          privilege: String(row.privilege_type),
          grantable: Boolean(row.is_grantable),
          source: Number(row.grantee) === 0 ? "public" : "direct",
        });
      }

      const schemaPrivileges = await client.query<PgSchemaPrivilegeRow>(
        `SELECT n.nspname, acl.privilege_type, acl.is_grantable, acl.grantee
         FROM pg_namespace n
         CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) acl
         LEFT JOIN pg_roles r ON acl.grantee = r.oid
         WHERE COALESCE(r.rolname, 'PUBLIC') IN ($1, 'PUBLIC')
           AND n.nspname NOT IN ('information_schema')
           AND n.nspname NOT LIKE 'pg_%'`,
        [userId],
      );
      for (const row of schemaPrivileges.rows) {
        privileges.push({
          id: `${userId}-schema-${row.nspname}-${row.privilege_type}-${row.grantee}`,
          userId,
          objectType: "schema",
          schema: String(row.nspname),
          privilege: String(row.privilege_type),
          grantable: Boolean(row.is_grantable),
          source: Number(row.grantee) === 0 ? "public" : "direct",
        });
      }

      const tablePrivileges = await client.query<PgTablePrivilegeRow>(
        `SELECT table_catalog, table_schema, table_name, privilege_type, is_grantable, grantee
         FROM information_schema.table_privileges
         WHERE grantee IN ($1, 'PUBLIC')`,
        [userId],
      );
      for (const row of tablePrivileges.rows) {
        privileges.push({
          id: `${userId}-table-${row.table_schema}-${row.table_name}-${row.privilege_type}-${row.grantee}`,
          userId,
          objectType: "table",
          database: String(row.table_catalog),
          schema: String(row.table_schema),
          table: String(row.table_name),
          privilege: String(row.privilege_type),
          grantable: row.is_grantable === "YES",
          source: row.grantee === "PUBLIC" ? "public" : "direct",
        });
      }

      const memberships = await client.query<PgMembershipRow>(
        `SELECT parent.rolname AS source_role
         FROM pg_auth_members m
         JOIN pg_roles member ON member.oid = m.member
         JOIN pg_roles parent ON parent.oid = m.roleid
         WHERE member.rolname = $1`,
        [userId],
      );
      for (const row of memberships.rows) {
        privileges.push({
          id: `${userId}-membership-${row.source_role}`,
          userId,
          objectType: "role_membership",
          privilege: "MEMBER",
          source: "membership",
          note: String(row.source_role),
        });
      }

      return privileges;
    });
  }

  async grantPrivileges(
    config: ResolvedConnectionConfig,
    params: PrivilegeMutationParams,
  ): Promise<MutationResult> {
    return this.withClient(config, params.database ?? config.defaultDatabase, async (client) => {
      this.assertPrivilegesAllowed(params);
      const sql = this.buildPrivilegeSql("GRANT", params);
      await client.query(sql);
      return {
        affectedRows: 1,
        message: "権限を付与しました。",
      };
    });
  }

  async revokePrivileges(
    config: ResolvedConnectionConfig,
    params: PrivilegeMutationParams,
  ): Promise<MutationResult> {
    return this.withClient(config, params.database ?? config.defaultDatabase, async (client) => {
      this.assertPrivilegesAllowed(params);
      const sql = this.buildPrivilegeSql("REVOKE", params);
      await client.query(sql);
      return {
        affectedRows: 1,
        message: "権限を剥奪しました。",
      };
    });
  }

  previewPrivilegeMutation(
    _config: ResolvedConnectionConfig,
    action: "grant" | "revoke",
    params: PrivilegeMutationParams,
  ) {
    this.assertPrivilegesAllowed(params);
    return this.buildPrivilegeSql(action === "grant" ? "GRANT" : "REVOKE", params);
  }

  private quoteIdentifier(value: string) {
    return `"${value.replace(/"/g, '""')}"`;
  }

  private buildColumnDefinition(column: {
    name: string;
    type: string;
    nullable: boolean;
    defaultValue?: string | null;
    autoIncrement?: boolean;
  }) {
    this.assertSafeSqlFragment(column.type, "カラム型");
    const segments = [this.quoteIdentifier(column.name), column.type];

    if (column.autoIncrement) {
      segments.push("GENERATED BY DEFAULT AS IDENTITY");
    } else if (column.defaultValue && column.defaultValue.trim().length > 0) {
      this.assertSafeSqlFragment(column.defaultValue, "デフォルト値");
      segments.push(`DEFAULT ${column.defaultValue.trim()}`);
    }
    if (!column.nullable) {
      segments.push("NOT NULL");
    }

    return segments.join(" ");
  }

  private buildRoleOptionClauses(params: DatabaseUserMutationParams, includeDefaults: boolean) {
    const clauses: string[] = [];

    if (includeDefaults || params.canLogin != null) {
      clauses.push(params.canLogin === false ? "NOLOGIN" : "LOGIN");
    }
    if (includeDefaults || params.isSuperuser != null) {
      clauses.push(params.isSuperuser ? "SUPERUSER" : "NOSUPERUSER");
    }
    if (includeDefaults || params.canCreateDatabase != null) {
      clauses.push(params.canCreateDatabase ? "CREATEDB" : "NOCREATEDB");
    }
    if (includeDefaults || params.canCreateUser != null) {
      clauses.push(params.canCreateUser ? "CREATEROLE" : "NOCREATEROLE");
    }
    if (includeDefaults || params.canReplication != null) {
      clauses.push(params.canReplication ? "REPLICATION" : "NOREPLICATION");
    }
    if (includeDefaults || params.canBypassRls != null) {
      clauses.push(params.canBypassRls ? "BYPASSRLS" : "NOBYPASSRLS");
    }

    return clauses;
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
        return `${column}::text ILIKE ${bindValue(`%${value}%`)}`;
      case "starts":
        return `${column}::text ILIKE ${bindValue(`${value}%`)}`;
      case "ends":
        return `${column}::text ILIKE ${bindValue(`%${value}`)}`;
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
    const allowedByObjectType: Record<PrivilegeMutationParams["objectType"], Set<string>> = {
      global: new Set(),
      database: new Set(["CONNECT", "TEMPORARY", "TEMP", "CREATE"]),
      schema: new Set(["USAGE", "CREATE"]),
      table: new Set(["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]),
      sequence: new Set(["USAGE", "SELECT", "UPDATE"]),
      role_membership: new Set(["MEMBER"]),
    };
    const allowedPrivileges = allowedByObjectType[params.objectType];
    for (const privilege of params.privileges) {
      if (!allowedPrivileges.has(privilege.toUpperCase())) {
        throw new ApiError(400, "DB_PRIVILEGE_INVALID", `未対応の権限です: ${privilege}`);
      }
    }
  }

  private buildPrivilegeSql(action: "GRANT" | "REVOKE", params: PrivilegeMutationParams) {
    if (params.objectType === "role_membership") {
      const sourceRole = params.sourceRole;
      if (!sourceRole) {
        throw new ApiError(
          400,
          "SOURCE_ROLE_REQUIRED",
          "role membership の変更には sourceRole が必要です。",
        );
      }
      return `${action} ${this.quoteIdentifier(sourceRole)} ${
        action === "GRANT" ? "TO" : "FROM"
      } ${this.quoteIdentifier(params.userId)}`;
    }

    const privilegeList = params.privileges.join(", ");
    if (params.objectType === "database") {
      return `${action} ${privilegeList} ON DATABASE ${this.quoteIdentifier(params.database ?? "")} ${
        action === "GRANT" ? "TO" : "FROM"
      } ${this.quoteIdentifier(params.userId)}`;
    }
    if (params.objectType === "schema") {
      return `${action} ${privilegeList} ON SCHEMA ${this.quoteIdentifier(params.schema ?? "public")} ${
        action === "GRANT" ? "TO" : "FROM"
      } ${this.quoteIdentifier(params.userId)}`;
    }
    if (params.objectType === "sequence") {
      return `${action} ${privilegeList} ON SEQUENCE ${this.quoteIdentifier(params.schema ?? "public")}.${this.quoteIdentifier(params.sequence ?? "")} ${
        action === "GRANT" ? "TO" : "FROM"
      } ${this.quoteIdentifier(params.userId)}`;
    }
    return `${action} ${privilegeList} ON TABLE ${this.quoteIdentifier(params.schema ?? "public")}.${this.quoteIdentifier(params.table ?? "")} ${
      action === "GRANT" ? "TO" : "FROM"
    } ${this.quoteIdentifier(params.userId)}`;
  }

  private wrapError(error: unknown) {
    if (error instanceof ApiError) {
      return error;
    }
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "57014"
    ) {
      const timeoutError = new ApiError(
        408,
        "POSTGRES_QUERY_TIMEOUT",
        "PostgreSQL の応答がタイムアウトしました。処理を見直して再実行してください。",
      );
      (timeoutError as Error & { cause?: unknown }).cause = error;
      return timeoutError;
    }
    const apiError = new ApiError(
      400,
      "POSTGRES_OPERATION_FAILED",
      "PostgreSQL 操作に失敗しました。接続状態、権限、SQL を確認してください。",
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
