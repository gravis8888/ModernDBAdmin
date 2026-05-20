import type { FastifyInstance } from "fastify";

import { databasePrivilegeMutationSchema } from "@modern-db-admin/shared";
import { parseRequestParams, parseRequestQuery } from "../utils/request";
import {
  connectionDbUserParamsSchema,
  privilegePreviewQuerySchema,
} from "../utils/request-schemas";

export async function registerDbPrivilegeRoutes(app: FastifyInstance) {
  app.get(
    "/api/connections/:connectionId/db-users/:dbUserId/privileges",
    { preHandler: app.requireAuth },
    async (request) => {
      app.authorize(request, ["manage_db_users", "manage_db_privileges"], "any");
      const { connectionId, dbUserId } = parseRequestParams(request, connectionDbUserParamsSchema);
      return {
        privileges: await app.services.database.listDatabasePrivileges(connectionId, dbUserId),
      };
    },
  );

  app.post(
    "/api/connections/:connectionId/db-users/:dbUserId/privileges",
    { preHandler: app.requireAuth },
    async (request) => {
      const sessionUser = app.authorize(request, ["manage_db_privileges"]);
      const { connectionId, dbUserId } = parseRequestParams(request, connectionDbUserParamsSchema);
      const input = databasePrivilegeMutationSchema.parse(request.body);
      return {
        result: await app.services.database.mutatePrivileges(
          "grant",
          connectionId,
          dbUserId,
          input,
          sessionUser,
        ),
      };
    },
  );

  app.post(
    "/api/connections/:connectionId/db-users/:dbUserId/privileges/preview",
    { preHandler: app.requireAuth },
    async (request) => {
      app.authorize(request, ["manage_db_privileges"]);
      const { connectionId, dbUserId } = parseRequestParams(request, connectionDbUserParamsSchema);
      const query = parseRequestQuery(request, privilegePreviewQuerySchema);
      const input = databasePrivilegeMutationSchema.parse(request.body);
      return {
        sql: app.services.database.previewPrivilegeMutation(
          query.action === "revoke" ? "revoke" : "grant",
          connectionId,
          dbUserId,
          input,
        ),
      };
    },
  );

  app.delete(
    "/api/connections/:connectionId/db-users/:dbUserId/privileges",
    { preHandler: app.requireAuth },
    async (request) => {
      const sessionUser = app.authorize(request, ["manage_db_privileges"]);
      const { connectionId, dbUserId } = parseRequestParams(request, connectionDbUserParamsSchema);
      const input = databasePrivilegeMutationSchema.parse(request.body);
      return {
        result: await app.services.database.mutatePrivileges(
          "revoke",
          connectionId,
          dbUserId,
          input,
          sessionUser,
        ),
      };
    },
  );
}
