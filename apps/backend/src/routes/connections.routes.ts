import type { FastifyInstance } from "fastify";

import { connectionFormSchema } from "@modern-db-admin/shared";
import { parseRequestParams } from "../utils/request";
import { connectionIdParamsSchema } from "../utils/request-schemas";

export async function registerConnectionRoutes(app: FastifyInstance) {
  app.get("/api/connections", { preHandler: app.requireAuth }, async (request) => {
    app.authorize(request, ["view_connections"]);
    return {
      connections: app.services.connections.listConnections(),
    };
  });

  app.post("/api/connections", { preHandler: app.requireAuth }, async (request) => {
    const sessionUser = app.authorize(request, ["manage_connections"]);
    const input = connectionFormSchema.parse(request.body);
    return {
      connection: await app.services.connections.createConnection(input, sessionUser.id),
    };
  });

  app.put("/api/connections/:connectionId", { preHandler: app.requireAuth }, async (request) => {
    const sessionUser = app.authorize(request, ["manage_connections"]);
    const { connectionId } = parseRequestParams(request, connectionIdParamsSchema);
    const input = connectionFormSchema.parse(request.body);
    return {
      connection: await app.services.connections.updateConnection(
        connectionId,
        input,
        sessionUser.id,
      ),
    };
  });

  app.delete("/api/connections/:connectionId", { preHandler: app.requireAuth }, async (request) => {
    const sessionUser = app.authorize(request, ["manage_connections"]);
    const { connectionId } = parseRequestParams(request, connectionIdParamsSchema);
    await app.services.connections.deleteConnection(connectionId, sessionUser.id);
    return { ok: true };
  });

  app.post(
    "/api/connections/:connectionId/test",
    { preHandler: app.requireAuth },
    async (request) => {
      const sessionUser = app.authorize(request, ["manage_connections"]);
      const { connectionId } = parseRequestParams(request, connectionIdParamsSchema);
      return {
        serverInfo: await app.services.connections.testConnection(connectionId, sessionUser.id),
      };
    },
  );
}
