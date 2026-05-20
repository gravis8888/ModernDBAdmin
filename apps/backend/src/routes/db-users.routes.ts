import type { FastifyInstance } from "fastify";

import { databaseUserCreateSchema, databaseUserUpdateSchema } from "@modern-db-admin/shared";
import { parseRequestParams } from "../utils/request";
import {
  connectionDbUserParamsSchema,
  connectionIdParamsSchema,
} from "../utils/request-schemas";

export async function registerDbUserRoutes(app: FastifyInstance) {
  app.get(
    "/api/connections/:connectionId/db-users",
    { preHandler: app.requireAuth },
    async (request) => {
      app.authorize(request, ["manage_db_users"]);
      const { connectionId } = parseRequestParams(request, connectionIdParamsSchema);
      return {
        users: await app.services.database.listDatabaseUsers(connectionId),
      };
    },
  );

  app.post(
    "/api/connections/:connectionId/db-users",
    { preHandler: app.requireAuth },
    async (request) => {
      const sessionUser = app.authorize(request, ["manage_db_users"]);
      const { connectionId } = parseRequestParams(request, connectionIdParamsSchema);
      const input = databaseUserCreateSchema.parse(request.body);
      return {
        result: await app.services.database.createDatabaseUser(connectionId, input, sessionUser),
      };
    },
  );

  app.put(
    "/api/connections/:connectionId/db-users/:dbUserId",
    { preHandler: app.requireAuth },
    async (request) => {
      const sessionUser = app.authorize(request, ["manage_db_users"]);
      const { connectionId, dbUserId } = parseRequestParams(request, connectionDbUserParamsSchema);
      const input = databaseUserUpdateSchema.parse(request.body);
      return {
        result: await app.services.database.updateDatabaseUser(
          connectionId,
          dbUserId,
          input,
          sessionUser,
        ),
      };
    },
  );

  app.delete(
    "/api/connections/:connectionId/db-users/:dbUserId",
    { preHandler: app.requireAuth },
    async (request) => {
      const sessionUser = app.authorize(request, ["manage_db_users"]);
      const { connectionId, dbUserId } = parseRequestParams(request, connectionDbUserParamsSchema);
      return {
        result: await app.services.database.deleteDatabaseUser(connectionId, dbUserId, sessionUser),
      };
    },
  );
}
