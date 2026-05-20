import argon2 from "argon2";
import type { AuthLoginInput, AuthSetupInput } from "@modern-db-admin/shared";

import { ApiError } from "../utils/api-error";
import { PermissionService } from "./permission-service";
import { InternalStore } from "./internal-store";

export class AuthService {
  constructor(
    private readonly store: InternalStore,
    private readonly permissionService: PermissionService,
  ) {}

  isSetupCompleted() {
    return this.store.hasUsers();
  }

  async setupInitialAdmin(input: AuthSetupInput) {
    if (this.store.hasUsers()) {
      throw new ApiError(
        409,
        "SETUP_ALREADY_COMPLETED",
        "初期セットアップはすでに完了しています。",
      );
    }

    const adminRole = this.store.getRoleByName("Admin");
    if (!adminRole) {
      throw new ApiError(500, "ADMIN_ROLE_MISSING", "Admin ロールが初期化されていません。");
    }

    const passwordHash = await argon2.hash(input.password, {
      type: argon2.argon2id,
    });

    const user = this.store.createUser({
      username: input.username,
      email: input.email,
      passwordHash,
      roleIds: [adminRole.id],
      enabled: true,
    });

    if (!user) {
      throw new ApiError(500, "USER_CREATE_FAILED", "初期管理者を作成できませんでした。");
    }

    return this.permissionService.buildSessionUser(user.id);
  }

  async authenticate(input: AuthLoginInput) {
    const record = this.store.getUserWithPasswordByIdentifier(input.identifier);
    if (!record) {
      throw new ApiError(
        401,
        "INVALID_CREDENTIALS",
        "ユーザー名またはパスワードが正しくありません。",
      );
    }

    if (!record.enabled) {
      throw new ApiError(403, "USER_DISABLED", "このユーザーは無効化されています。");
    }

    const verified = await argon2.verify(record.passwordHash, input.password);
    if (!verified) {
      throw new ApiError(
        401,
        "INVALID_CREDENTIALS",
        "ユーザー名またはパスワードが正しくありません。",
      );
    }

    this.store.updateUser(record.id, { lastLoginAt: Date.now() });

    return this.permissionService.buildSessionUser(record.id);
  }
}
