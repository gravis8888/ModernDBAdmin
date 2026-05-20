import type { FastifyInstance } from "fastify";

import { appUserCreateSchema, appUserUpdateSchema } from "@modern-db-admin/shared";

import { ApiError } from "../utils/api-error";
import { userIdParamsSchema } from "../utils/request-schemas";
import { parseRequestParams } from "../utils/request";

export async function registerAppUserRoutes(app: FastifyInstance) {
  const assertRoleIdsExist = (roleIds: string[]) => {
    const roles = roleIds.map((roleId) => app.services.store.getRoleById(roleId));
    if (roles.some((role) => role == null)) {
      throw new ApiError(400, "ROLE_NOT_FOUND", "指定されたロールが存在しません。");
    }
  };

  app.get("/api/app-users", { preHandler: app.requireAuth }, async (request) => {
    app.authorize(request, ["manage_app_users"]);
    return {
      users: app.services.store.listUsers(),
    };
  });

  app.post("/api/app-users", { preHandler: app.requireAuth }, async (request) => {
    const sessionUser = app.authorize(request, ["manage_app_users"]);
    const input = appUserCreateSchema.parse(request.body);
    assertRoleIdsExist(input.roleIds);

    const passwordHash = await import("argon2").then((argon2) =>
      argon2.default.hash(input.password, { type: argon2.default.argon2id }),
    );
    const user = app.services.store.createUser({
      username: input.username,
      email: input.email,
      passwordHash,
      roleIds: input.roleIds,
      enabled: input.enabled,
    });
    if (!user) {
      throw new ApiError(500, "USER_CREATE_FAILED", "ユーザーを作成できませんでした。");
    }

    app.services.audit.record({
      actorUserId: sessionUser.id,
      action: "app-user.create",
      resourceType: "app-user",
      resourceId: user.id,
      details: { username: user.username, roleIds: user.roleIds },
    });

    return { user };
  });

  app.put("/api/app-users/:userId", { preHandler: app.requireAuth }, async (request) => {
    const sessionUser = app.authorize(request, ["manage_app_users"]);
    const { userId } = parseRequestParams(request, userIdParamsSchema);
    const input = appUserUpdateSchema.parse(request.body);
    if (input.roleIds) {
      assertRoleIdsExist(input.roleIds);
    }
    if (userId === sessionUser.id && input.enabled === false) {
      throw new ApiError(400, "SELF_DISABLE_FORBIDDEN", "自分自身を無効化することはできません。");
    }
    if (userId === sessionUser.id && input.roleIds) {
      throw new ApiError(
        400,
        "SELF_ROLE_CHANGE_FORBIDDEN",
        "自分自身のロールは変更できません。",
      );
    }
    const passwordHash = input.password
      ? await import("argon2").then((argon2) =>
          argon2.default.hash(input.password!, { type: argon2.default.argon2id }),
        )
      : undefined;

    const user = app.services.store.updateUser(userId, {
      username: input.username,
      email: input.email,
      passwordHash,
      roleIds: input.roleIds,
      enabled: input.enabled,
    });

    app.services.audit.record({
      actorUserId: sessionUser.id,
      action: "app-user.update",
      resourceType: "app-user",
      resourceId: userId,
      details: {
        username: user?.username ?? null,
        roleIds: user?.roleIds ?? [],
      },
    });

    return { user };
  });

  app.delete("/api/app-users/:userId", { preHandler: app.requireAuth }, async (request) => {
    const sessionUser = app.authorize(request, ["manage_app_users"]);
    const { userId } = parseRequestParams(request, userIdParamsSchema);
    if (userId === sessionUser.id) {
      throw new ApiError(400, "SELF_DELETE_FORBIDDEN", "自分自身を削除することはできません。");
    }
    app.services.store.deleteUser(userId);
    app.services.audit.record({
      actorUserId: sessionUser.id,
      action: "app-user.delete",
      resourceType: "app-user",
      resourceId: userId,
      details: {},
    });
    return { ok: true };
  });
}
