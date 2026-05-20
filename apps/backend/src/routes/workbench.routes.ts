import type { FastifyInstance } from "fastify";

import {
  addColumnSchema,
  createDatabaseSchema,
  createIndexSchema,
  createTableSchema,
  importCsvSchema,
  renameTableSchema,
  truncateTableSchema,
} from "@modern-db-admin/shared";

import { parseRequestParams, parseRequestQuery } from "../utils/request";
import {
  connectionDatabaseSchemaParamsSchema,
  connectionDatabaseSchemaTableColumnParamsSchema,
  connectionDatabaseSchemaTableIndexParamsSchema,
  connectionDatabaseSchemaTableParamsSchema,
  connectionIdParamsSchema,
  exportTableQuerySchema,
} from "../utils/request-schemas";

export async function registerWorkbenchRoutes(app: FastifyInstance) {
  app.post(
    "/api/connections/:connectionId/databases",
    { preHandler: app.requireAuth },
    async (request) => {
      const sessionUser = app.authorize(request, ["execute_ddl_sql"]);
      const { connectionId } = parseRequestParams(request, connectionIdParamsSchema);
      const input = createDatabaseSchema.parse(request.body);
      return {
        result: await app.services.database.createDatabase(connectionId, input.name, sessionUser),
      };
    },
  );

  app.get(
    "/api/connections/:connectionId/databases/:database/schemas/:schema/tables/:table/export",
    { preHandler: app.requireAuth },
    async (request) => {
      const sessionUser = app.authorize(request, ["export_data"]);
      const { connectionId, database, schema, table } = parseRequestParams(
        request,
        connectionDatabaseSchemaTableParamsSchema,
      );
      const { format } = parseRequestQuery(request, exportTableQuerySchema);

      return app.services.database.exportTable(
        connectionId,
        database,
        schema,
        table,
        format as "csv" | "json" | "insert_sql" | "table_sql",
        sessionUser,
      );
    },
  );

  app.post(
    "/api/connections/:connectionId/databases/:database/schemas/:schema/structure/tables",
    { preHandler: app.requireAuth },
    async (request) => {
      const sessionUser = app.authorize(request, ["execute_ddl_sql"]);
      const { connectionId, database, schema } = parseRequestParams(
        request,
        connectionDatabaseSchemaParamsSchema,
      );
      const input = createTableSchema.parse(request.body);
      return {
        result: await app.services.database.createTable(
          connectionId,
          database,
          schema,
          input,
          sessionUser,
        ),
      };
    },
  );

  app.post(
    "/api/connections/:connectionId/databases/:database/schemas/:schema/tables/:table/rename",
    { preHandler: app.requireAuth },
    async (request) => {
      const sessionUser = app.authorize(request, ["execute_ddl_sql"]);
      const { connectionId, database, schema, table } = parseRequestParams(
        request,
        connectionDatabaseSchemaTableParamsSchema,
      );
      const input = renameTableSchema.parse(request.body);
      return {
        result: await app.services.database.renameTable(
          connectionId,
          database,
          schema,
          table,
          input.nextName,
          sessionUser,
        ),
      };
    },
  );

  app.delete(
    "/api/connections/:connectionId/databases/:database/schemas/:schema/tables/:table",
    { preHandler: app.requireAuth },
    async (request) => {
      const sessionUser = app.authorize(request, ["execute_ddl_sql"]);
      const { connectionId, database, schema, table } = parseRequestParams(
        request,
        connectionDatabaseSchemaTableParamsSchema,
      );
      return {
        result: await app.services.database.dropTable(
          connectionId,
          database,
          schema,
          table,
          sessionUser,
        ),
      };
    },
  );

  app.post(
    "/api/connections/:connectionId/databases/:database/schemas/:schema/tables/:table/truncate",
    { preHandler: app.requireAuth },
    async (request) => {
      const sessionUser = app.authorize(request, ["execute_ddl_sql"]);
      const { connectionId, database, schema, table } = parseRequestParams(
        request,
        connectionDatabaseSchemaTableParamsSchema,
      );
      const input = truncateTableSchema.parse(request.body);
      return {
        result: await app.services.database.truncateTable(
          connectionId,
          database,
          schema,
          table,
          input.confirmDangerous,
          sessionUser,
        ),
      };
    },
  );

  app.post(
    "/api/connections/:connectionId/databases/:database/schemas/:schema/tables/:table/columns",
    { preHandler: app.requireAuth },
    async (request) => {
      const sessionUser = app.authorize(request, ["execute_ddl_sql"]);
      const { connectionId, database, schema, table } = parseRequestParams(
        request,
        connectionDatabaseSchemaTableParamsSchema,
      );
      const input = addColumnSchema.parse(request.body);
      return {
        result: await app.services.database.addColumn(
          connectionId,
          database,
          schema,
          table,
          input,
          sessionUser,
        ),
      };
    },
  );

  app.delete(
    "/api/connections/:connectionId/databases/:database/schemas/:schema/tables/:table/columns/:column",
    { preHandler: app.requireAuth },
    async (request) => {
      const sessionUser = app.authorize(request, ["execute_ddl_sql"]);
      const { connectionId, database, schema, table, column } = parseRequestParams(
        request,
        connectionDatabaseSchemaTableColumnParamsSchema,
      );
      return {
        result: await app.services.database.dropColumn(
          connectionId,
          database,
          schema,
          table,
          column,
          sessionUser,
        ),
      };
    },
  );

  app.post(
    "/api/connections/:connectionId/databases/:database/schemas/:schema/tables/:table/indexes",
    { preHandler: app.requireAuth },
    async (request) => {
      const sessionUser = app.authorize(request, ["execute_ddl_sql"]);
      const { connectionId, database, schema, table } = parseRequestParams(
        request,
        connectionDatabaseSchemaTableParamsSchema,
      );
      const input = createIndexSchema.parse(request.body);
      return {
        result: await app.services.database.createIndex(
          connectionId,
          database,
          schema,
          table,
          input,
          sessionUser,
        ),
      };
    },
  );

  app.delete(
    "/api/connections/:connectionId/databases/:database/schemas/:schema/tables/:table/indexes/:index",
    { preHandler: app.requireAuth },
    async (request) => {
      const sessionUser = app.authorize(request, ["execute_ddl_sql"]);
      const { connectionId, database, schema, table, index } = parseRequestParams(
        request,
        connectionDatabaseSchemaTableIndexParamsSchema,
      );
      return {
        result: await app.services.database.dropIndex(
          connectionId,
          database,
          schema,
          table,
          index,
          sessionUser,
        ),
      };
    },
  );

  app.post(
    "/api/connections/:connectionId/databases/:database/schemas/:schema/tables/:table/import/csv",
    { preHandler: app.requireAuth },
    async (request) => {
      const sessionUser = app.authorize(request, ["edit_table_rows"]);
      const { connectionId, database, schema, table } = parseRequestParams(
        request,
        connectionDatabaseSchemaTableParamsSchema,
      );
      const input = importCsvSchema.parse(request.body);
      return {
        result: await app.services.database.importCsv(
          connectionId,
          database,
          schema,
          table,
          input,
          sessionUser,
        ),
      };
    },
  );
}
