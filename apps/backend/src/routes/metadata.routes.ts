import type { FastifyInstance } from "fastify";

import { parseRequestParams } from "../utils/request";
import {
  connectionDatabaseParamsSchema,
  connectionDatabaseSchemaParamsSchema,
  connectionDatabaseSchemaTableParamsSchema,
  connectionIdParamsSchema,
} from "../utils/request-schemas";

export async function registerMetadataRoutes(app: FastifyInstance) {
  app.get(
    "/api/connections/:connectionId/server-info",
    { preHandler: app.requireAuth },
    async (request) => {
      app.authorize(request, ["view_connections", "view_schema"]);
      const { connectionId } = parseRequestParams(request, connectionIdParamsSchema);
      return {
        serverInfo: await app.services.database.getServerInfo(connectionId),
      };
    },
  );

  app.get(
    "/api/connections/:connectionId/databases",
    { preHandler: app.requireAuth },
    async (request) => {
      app.authorize(request, ["view_connections", "view_schema"]);
      const { connectionId } = parseRequestParams(request, connectionIdParamsSchema);
      return {
        databases: await app.services.database.listDatabases(connectionId),
      };
    },
  );

  app.get(
    "/api/connections/:connectionId/databases/:database/schemas",
    { preHandler: app.requireAuth },
    async (request) => {
      app.authorize(request, ["view_schema"]);
      const { connectionId, database } = parseRequestParams(request, connectionDatabaseParamsSchema);
      return {
        schemas: await app.services.database.listSchemas(connectionId, database),
      };
    },
  );

  app.get(
    "/api/connections/:connectionId/databases/:database/schemas/:schema/tables",
    { preHandler: app.requireAuth },
    async (request) => {
      app.authorize(request, ["view_schema"]);
      const { connectionId, database, schema } = parseRequestParams(
        request,
        connectionDatabaseSchemaParamsSchema,
      );
      return {
        tables: await app.services.database.listTables(connectionId, database, schema),
      };
    },
  );

  app.get(
    "/api/connections/:connectionId/databases/:database/schemas/:schema/tables/:table/columns",
    { preHandler: app.requireAuth },
    async (request) => {
      app.authorize(request, ["view_schema"]);
      const { connectionId, database, schema, table } = parseRequestParams(
        request,
        connectionDatabaseSchemaTableParamsSchema,
      );
      return {
        columns: await app.services.database.getColumns(connectionId, database, schema, table),
      };
    },
  );

  app.get(
    "/api/connections/:connectionId/databases/:database/schemas/:schema/tables/:table/metadata",
    { preHandler: app.requireAuth },
    async (request) => {
      app.authorize(request, ["view_schema"]);
      const { connectionId, database, schema, table } = parseRequestParams(
        request,
        connectionDatabaseSchemaTableParamsSchema,
      );
      return {
        metadata: await app.services.database.getTableMetadata(
          connectionId,
          database,
          schema,
          table,
        ),
      };
    },
  );

  app.get(
    "/api/connections/:connectionId/databases/:database/schemas/:schema/tables/:table/indexes",
    { preHandler: app.requireAuth },
    async (request) => {
      app.authorize(request, ["view_schema"]);
      const { connectionId, database, schema, table } = parseRequestParams(
        request,
        connectionDatabaseSchemaTableParamsSchema,
      );
      return {
        indexes: await app.services.database.getIndexes(connectionId, database, schema, table),
      };
    },
  );

  app.get(
    "/api/connections/:connectionId/databases/:database/schemas/:schema/objects",
    { preHandler: app.requireAuth },
    async (request) => {
      app.authorize(request, ["view_schema"]);
      const { connectionId, database, schema } = parseRequestParams(
        request,
        connectionDatabaseSchemaParamsSchema,
      );
      return {
        objects: await app.services.database.listDatabaseObjects(connectionId, database, schema),
      };
    },
  );

  app.get(
    "/api/connections/:connectionId/databases/:database/schemas/:schema/tables/:table/create-sql",
    { preHandler: app.requireAuth },
    async (request) => {
      app.authorize(request, ["view_schema"]);
      const { connectionId, database, schema, table } = parseRequestParams(
        request,
        connectionDatabaseSchemaTableParamsSchema,
      );
      return {
        sql: await app.services.database.getTableCreateSql(connectionId, database, schema, table),
      };
    },
  );
}
