import type { FastifyInstance } from "fastify";

export async function registerDashboardRoutes(app: FastifyInstance) {
  app.get("/api/dashboard", { preHandler: app.requireAuth }, async (request) => {
    const sessionUser = app.authorize(request, ["view_connections"]);
    const connections = app.services.connections.listConnections();
    const appUsers = app.services.store.listUsers();
    const roles = app.services.store.listRoles();
    const auditLogs = sessionUser.permissionKeys.includes("view_audit_logs")
      ? app.services.audit.listRecent(10)
      : [];

    return {
      summary: {
        connectionCount: connections.length,
        appUserCount: appUsers.length,
        appRoleCount: roles.length,
        activeConnectionCount: connections.filter((connection) => connection.lastConnectedAt)
          .length,
      },
      recentAuditLogs: auditLogs,
    };
  });
}
