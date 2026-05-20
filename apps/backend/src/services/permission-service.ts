import type { AppPermission, SessionUser } from "@modern-db-admin/shared";

import { ApiError } from "../utils/api-error";
import { InternalStore } from "./internal-store";

export class PermissionService {
  constructor(private readonly store: InternalStore) {}

  buildSessionUser(userId: string): SessionUser {
    const user = this.store.getUserById(userId);
    if (!user) {
      throw new ApiError(401, "AUTH_REQUIRED", "認証が必要です。");
    }

    const permissionKeys = [...new Set(user.roles.flatMap((role) => role.permissionKeys))];

    return {
      id: user.id,
      username: user.username,
      email: user.email,
      roleIds: user.roleIds,
      permissionKeys,
      enabled: user.enabled,
      lastLoginAt: user.lastLoginAt,
    };
  }

  assertPermissions(
    sessionUser: SessionUser,
    requiredPermissions: AppPermission[],
    mode: "all" | "any" = "all",
  ) {
    const hasPermission = (permission: AppPermission) =>
      sessionUser.permissionKeys.includes(permission);

    const okay =
      mode === "all"
        ? requiredPermissions.every((permission) => hasPermission(permission))
        : requiredPermissions.some((permission) => hasPermission(permission));

    if (!okay) {
      throw new ApiError(403, "PERMISSION_DENIED", "この操作を行う権限がありません。", {
        requiredPermissions,
      });
    }
  }
}
