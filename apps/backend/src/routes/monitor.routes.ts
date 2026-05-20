import type { FastifyInstance } from "fastify";

import { parseRequestParams, parseRequestQuery } from "../utils/request";
import { connectionIdParamsSchema, monitorQuerySchema } from "../utils/request-schemas";

export async function registerMonitorRoutes(app: FastifyInstance) {
  app.get(
    "/api/connections/:connectionId/monitor/sessions",
    { preHandler: app.requireAuth },
    async (request) => {
      app.authorize(request, ["manage_connections"]);
      const { connectionId } = parseRequestParams(request, connectionIdParamsSchema);
      const { database } = parseRequestQuery(request, monitorQuerySchema);
      return {
        sessions: await app.services.database.listSessions(connectionId, database),
      };
    },
  );

  app.get(
    "/api/connections/:connectionId/monitor/variables",
    { preHandler: app.requireAuth },
    async (request) => {
      app.authorize(request, ["manage_connections"]);
      const { connectionId } = parseRequestParams(request, connectionIdParamsSchema);
      const { database } = parseRequestQuery(request, monitorQuerySchema);
      return {
        variables: await app.services.database.listServerVariables(connectionId, database),
      };
    },
  );

  app.get(
    "/api/connections/:connectionId/monitor/metrics",
    { preHandler: app.requireAuth },
    async (request) => {
      app.authorize(request, ["manage_connections"]);
      const { connectionId } = parseRequestParams(request, connectionIdParamsSchema);
      const { database } = parseRequestQuery(request, monitorQuerySchema);
      return {
        metrics: await app.services.database.listServerMetrics(connectionId, database),
      };
    },
  );
}
