import type { FastifyInstance } from "fastify";

import { listRowsQuerySchema, rowMutationSchema } from "@modern-db-admin/shared";
import { parseRequestParams } from "../utils/request";
import { connectionDatabaseSchemaTableParamsSchema } from "../utils/request-schemas";

export async function registerRowRoutes(app: FastifyInstance) {
  app.get(
    "/api/connections/:connectionId/databases/:database/schemas/:schema/tables/:table/rows",
    { preHandler: app.requireAuth },
    async (request) => {
      app.authorize(request, ["view_table_rows"]);
      const query = listRowsQuerySchema.parse(request.query);
      const { connectionId, database, schema, table } = parseRequestParams(
        request,
        connectionDatabaseSchemaTableParamsSchema,
      );

      return {
        result: await app.services.database.selectRows(
          connectionId,
          database,
          schema,
          table,
          query,
        ),
      };
    },
  );

  app.post(
    "/api/connections/:connectionId/databases/:database/schemas/:schema/tables/:table/rows",
    { preHandler: app.requireAuth },
    async (request) => {
      const sessionUser = app.authorize(request, ["edit_table_rows"]);
      const input = rowMutationSchema.parse(request.body);
      const { connectionId, database, schema, table } = parseRequestParams(
        request,
        connectionDatabaseSchemaTableParamsSchema,
      );
      return {
        result: await app.services.database.insertRow(
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

  app.put(
    "/api/connections/:connectionId/databases/:database/schemas/:schema/tables/:table/rows",
    { preHandler: app.requireAuth },
    async (request) => {
      const sessionUser = app.authorize(request, ["edit_table_rows"]);
      const input = rowMutationSchema.parse(request.body);
      const { connectionId, database, schema, table } = parseRequestParams(
        request,
        connectionDatabaseSchemaTableParamsSchema,
      );
      return {
        result: await app.services.database.updateRow(
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
    "/api/connections/:connectionId/databases/:database/schemas/:schema/tables/:table/rows",
    { preHandler: app.requireAuth },
    async (request) => {
      const sessionUser = app.authorize(request, ["edit_table_rows"]);
      const input = rowMutationSchema.parse(request.body);
      const { connectionId, database, schema, table } = parseRequestParams(
        request,
        connectionDatabaseSchemaTableParamsSchema,
      );
      return {
        result: await app.services.database.deleteRow(
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
