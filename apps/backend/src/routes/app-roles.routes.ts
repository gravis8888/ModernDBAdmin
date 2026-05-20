import type { FastifyInstance } from "fastify";

import { appRoleCreateSchema, appRoleUpdateSchema } from "@modern-db-admin/shared";

import { ApiError } from "../utils/api-error";
import { roleIdParamsSchema } from "../utils/request-schemas";
import { parseRequestParams } from "../utils/request";

export async function registerAppRoleRoutes(app: FastifyInstance) {
  app.get("/api/app-roles", { preHandler: app.requireAuth }, async (request) => {
    app.authorize(request, ["manage_app_roles"]);
    return {
      roles: app.services.store.listRoles(),
      permissions: app.services.store.listPermissions(),
    };
  });

  app.post("/api/app-roles", { preHandler: app.requireAuth }, async (request) => {
    const sessionUser = app.authorize(request, ["manage_app_roles"]);
    const input = appRoleCreateSchema.parse(request.body);
    const role = app.services.store.createRole(input);
    app.services.audit.record({
      actorUserId: sessionUser.id,
      action: "app-role.create",
      resourceType: "app-role",
      resourceId: role?.id ?? null,
      details: { name: role?.name ?? input.name },
    });
    return { role };
  });

  app.put("/api/app-roles/:roleId", { preHandler: app.requireAuth }, async (request) => {
    const sessionUser = app.authorize(request, ["manage_app_roles"]);
    const { roleId } = parseRequestParams(request, roleIdParamsSchema);
    const existingRole = app.services.store.getRoleById(roleId);
    if (!existingRole) {
      throw new ApiError(404, "ROLE_NOT_FOUND", "ロールが見つかりません。");
    }
    if (existingRole.isSystem) {
      throw new ApiError(
        400,
        "SYSTEM_ROLE_UPDATE_FORBIDDEN",
        "システムロールは更新できません。",
      );
    }
    const input = appRoleUpdateSchema.parse(request.body);
    const role = app.services.store.updateRole(roleId, input);
    app.services.audit.record({
      actorUserId: sessionUser.id,
      action: "app-role.update",
      resourceType: "app-role",
      resourceId: roleId,
      details: { name: role?.name ?? input.name ?? null },
    });
    return { role };
  });

  app.delete("/api/app-roles/:roleId", { preHandler: app.requireAuth }, async (request) => {
    const sessionUser = app.authorize(request, ["manage_app_roles"]);
    const { roleId } = parseRequestParams(request, roleIdParamsSchema);
    app.services.store.deleteRole(roleId);
    app.services.audit.record({
      actorUserId: sessionUser.id,
      action: "app-role.delete",
      resourceType: "app-role",
      resourceId: roleId,
      details: {},
    });
    return { ok: true };
  });
}
