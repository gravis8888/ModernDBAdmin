import type { FastifyInstance } from "fastify";

import { executeSqlSchema } from "@modern-db-admin/shared";
import { parseRequestParams } from "../utils/request";
import { connectionIdParamsSchema } from "../utils/request-schemas";

export async function registerQueryRoutes(app: FastifyInstance) {
  app.post(
    "/api/connections/:connectionId/query",
    { preHandler: app.requireAuth },
    async (request) => {
      const { connectionId } = parseRequestParams(request, connectionIdParamsSchema);
      const input = executeSqlSchema.parse(request.body);
      const preview = app.services.querySafety.analyze(input.sql);
      const sessionUser = app.authorize(request, [preview.requiredPermission]);

      const execution = await app.services.database.executeSql(connectionId, input, sessionUser);

      return execution;
    },
  );
}
