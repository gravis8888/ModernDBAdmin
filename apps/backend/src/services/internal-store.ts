import { randomUUID } from "node:crypto";

import type {
  AppPermission,
  AppRole,
  AppUser,
  AuditLogEntry,
  ConnectionSummary,
  SqlBookmark,
} from "@modern-db-admin/shared";

import { sqlite } from "../db";
import { ApiError } from "../utils/api-error";
import { toIsoString } from "../utils/time";

type AppUserRow = {
  id: string;
  username: string;
  email: string;
  password_hash: string;
  is_active: number;
  last_login_at: number | null;
  created_at: number;
  updated_at: number;
};

type AppRoleRow = {
  id: string;
  name: string;
  description: string;
  is_system: number;
  created_at: number;
  updated_at: number;
};

type PermissionRow = {
  id: string;
  key: AppPermission;
  label: string;
  category: string;
  created_at: number;
  updated_at: number;
};

type ConnectionRow = {
  id: string;
  name: string;
  dialect: ConnectionSummary["dialect"];
  host: string;
  port: number;
  username: string;
  encrypted_password: string;
  default_database: string | null;
  use_ssl: number;
  readonly: number;
  last_connected_at: number | null;
  created_at: number;
  updated_at: number;
};

type AuditLogRow = {
  id: string;
  actor_user_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  details_json: string;
  created_at: number;
};

type QueryBookmarkRow = {
  id: string;
  user_id: string;
  name: string;
  sql_text: string;
  connection_id: string | null;
  database_name: string | null;
  schema_name: string | null;
  created_at: number;
  updated_at: number;
};

type AppUserRecord = AppUser & {
  passwordHash: string;
};

type ConnectionRecord = ConnectionSummary & {
  encryptedPassword: string;
  defaultDatabase: string | null;
};

const now = () => Date.now();

export class InternalStore {
  private createPlaceholders(count: number) {
    return Array.from({ length: count }, () => "?").join(", ");
  }

  private toPublicUser(user: AppUserRecord): AppUser {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      roleIds: user.roleIds,
      roles: user.roles,
      enabled: user.enabled,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  listPermissions() {
    return sqlite
      .prepare(
        "SELECT id, key, label, category, created_at, updated_at FROM app_permissions ORDER BY category, key",
      )
      .all() as PermissionRow[];
  }

  getPermissionIdByKey(key: AppPermission) {
    const row = sqlite.prepare("SELECT id FROM app_permissions WHERE key = ?").get(key) as
      | { id: string }
      | undefined;

    if (!row) {
      throw new ApiError(500, "PERMISSION_NOT_FOUND", `権限 ${key} が内部DBに存在しません。`);
    }

    return row.id;
  }

  private mapRoles(rows: AppRoleRow[]): AppRole[] {
    if (rows.length === 0) {
      return [];
    }

    const roleIds = rows.map((row) => row.id);
    const permissionRows = sqlite
      .prepare(
        `SELECT rp.role_id, ap.key
         FROM role_permissions rp
         INNER JOIN app_permissions ap ON ap.id = rp.permission_id
         WHERE rp.role_id IN (${this.createPlaceholders(roleIds.length)})`,
      )
      .all(...roleIds) as Array<{ role_id: string; key: AppPermission }>;

    const permissionMap = new Map<string, AppPermission[]>();
    for (const row of permissionRows) {
      const existing = permissionMap.get(row.role_id) ?? [];
      existing.push(row.key);
      permissionMap.set(row.role_id, existing);
    }

    return rows.map((role) => ({
      id: role.id,
      name: role.name,
      description: role.description,
      permissionKeys: permissionMap.get(role.id) ?? [],
      isSystem: Boolean(role.is_system),
      createdAt: new Date(role.created_at).toISOString(),
      updatedAt: new Date(role.updated_at).toISOString(),
    }));
  }

  private getRolesByIds(roleIds: string[]) {
    if (roleIds.length === 0) {
      return [];
    }

    const rows = sqlite
      .prepare(
        `SELECT id, name, description, is_system, created_at, updated_at
         FROM app_roles
         WHERE id IN (${this.createPlaceholders(roleIds.length)})
         ORDER BY name`,
      )
      .all(...roleIds) as AppRoleRow[];

    return this.mapRoles(rows);
  }

  listRoles(): AppRole[] {
    const rows = sqlite
      .prepare(
        "SELECT id, name, description, is_system, created_at, updated_at FROM app_roles ORDER BY name",
      )
      .all() as AppRoleRow[];

    return this.mapRoles(rows);
  }

  getRoleById(roleId: string) {
    const row = sqlite
      .prepare(
        `SELECT id, name, description, is_system, created_at, updated_at
         FROM app_roles
         WHERE id = ?`,
      )
      .get(roleId) as AppRoleRow | undefined;

    return row ? (this.mapRoles([row])[0] ?? null) : null;
  }

  getRoleByName(name: string) {
    const row = sqlite
      .prepare(
        `SELECT id, name, description, is_system, created_at, updated_at
         FROM app_roles
         WHERE name = ?`,
      )
      .get(name) as AppRoleRow | undefined;

    return row ? (this.mapRoles([row])[0] ?? null) : null;
  }

  createRole(input: {
    name: string;
    description: string;
    permissionKeys: AppPermission[];
    isSystem?: boolean;
  }) {
    const timestamp = now();
    const roleId = randomUUID();
    const transaction = sqlite.transaction(() => {
      sqlite
        .prepare(
          `INSERT INTO app_roles (id, name, description, is_system, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(roleId, input.name, input.description, input.isSystem ? 1 : 0, timestamp, timestamp);
      const insertRolePermission = sqlite.prepare(
        `INSERT INTO role_permissions (id, role_id, permission_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      );
      for (const key of input.permissionKeys) {
        insertRolePermission.run(
          randomUUID(),
          roleId,
          this.getPermissionIdByKey(key),
          timestamp,
          timestamp,
        );
      }
    });

    transaction();

    return this.getRoleById(roleId);
  }

  updateRole(
    roleId: string,
    input: {
      name?: string;
      description?: string;
      permissionKeys?: AppPermission[];
    },
  ) {
    const role = this.getRoleById(roleId);
    if (!role) {
      throw new ApiError(404, "ROLE_NOT_FOUND", "ロールが見つかりません。");
    }

    const timestamp = now();
    const transaction = sqlite.transaction(() => {
      sqlite
        .prepare(
          `UPDATE app_roles
           SET name = ?, description = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(input.name ?? role.name, input.description ?? role.description, timestamp, roleId);

      if (input.permissionKeys) {
        sqlite.prepare("DELETE FROM role_permissions WHERE role_id = ?").run(roleId);
        const insertRolePermission = sqlite.prepare(
          `INSERT INTO role_permissions (id, role_id, permission_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
        );
        for (const key of input.permissionKeys) {
          insertRolePermission.run(
            randomUUID(),
            roleId,
            this.getPermissionIdByKey(key),
            timestamp,
            timestamp,
          );
        }
      }
    });

    transaction();

    return this.getRoleById(roleId);
  }

  deleteRole(roleId: string) {
    const role = this.getRoleById(roleId);
    if (!role) {
      throw new ApiError(404, "ROLE_NOT_FOUND", "ロールが見つかりません。");
    }
    if (role.isSystem) {
      throw new ApiError(400, "SYSTEM_ROLE_DELETE_FORBIDDEN", "システムロールは削除できません。");
    }

    sqlite.transaction(() => {
      sqlite.prepare("DELETE FROM app_user_roles WHERE role_id = ?").run(roleId);
      sqlite.prepare("DELETE FROM role_permissions WHERE role_id = ?").run(roleId);
      sqlite.prepare("DELETE FROM app_roles WHERE id = ?").run(roleId);
    })();
  }

  hasUsers() {
    const row = sqlite.prepare("SELECT COUNT(*) AS count FROM app_users").get() as {
      count: number;
    };
    return row.count > 0;
  }

  private hydrateUsers(rows: AppUserRow[]): AppUserRecord[] {
    if (rows.length === 0) {
      return [];
    }

    const userIds = rows.map((row) => row.id);
    const userRoleRows = sqlite
      .prepare(
        `SELECT aur.user_id, aur.role_id
         FROM app_user_roles aur
         WHERE aur.user_id IN (${this.createPlaceholders(userIds.length)})`,
      )
      .all(...userIds) as Array<{ user_id: string; role_id: string }>;

    const roles = this.getRolesByIds([...new Set(userRoleRows.map((row) => row.role_id))]);
    const rolesById = new Map(roles.map((role) => [role.id, role]));
    const roleIdsByUserId = new Map<string, string[]>();

    for (const row of userRoleRows) {
      const existing = roleIdsByUserId.get(row.user_id) ?? [];
      existing.push(row.role_id);
      roleIdsByUserId.set(row.user_id, existing);
    }

    return rows.map((row) => {
      const roleIds = roleIdsByUserId.get(row.id) ?? [];
      return {
        id: row.id,
        username: row.username,
        email: row.email,
        roleIds,
        roles: roleIds
          .map((roleId) => rolesById.get(roleId))
          .filter((role): role is AppRole => Boolean(role)),
        enabled: Boolean(row.is_active),
        lastLoginAt: toIsoString(row.last_login_at),
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
        passwordHash: row.password_hash,
      };
    });
  }

  listUsers(): AppUser[] {
    const rows = sqlite
      .prepare(
        `SELECT id, username, email, password_hash, is_active, last_login_at, created_at, updated_at
         FROM app_users
         ORDER BY username`,
      )
      .all() as AppUserRow[];
    return this.hydrateUsers(rows).map((user) => this.toPublicUser(user));
  }

  getUserById(userId: string): AppUser | null {
    const row = sqlite
      .prepare(
        `SELECT id, username, email, password_hash, is_active, last_login_at, created_at, updated_at
         FROM app_users
         WHERE id = ?`,
      )
      .get(userId) as AppUserRow | undefined;

    if (!row) {
      return null;
    }

    const user = this.hydrateUsers([row])[0];
    if (!user) {
      return null;
    }

    return this.toPublicUser(user);
  }

  getUserWithPasswordByIdentifier(identifier: string): AppUserRecord | null {
    const row = sqlite
      .prepare(
        `SELECT id, username, email, password_hash, is_active, last_login_at, created_at, updated_at
         FROM app_users
         WHERE username = ? OR email = ?`,
      )
      .get(identifier, identifier) as AppUserRow | undefined;

    if (!row) {
      return null;
    }

    return this.hydrateUsers([row])[0] ?? null;
  }

  private getUserRowById(userId: string) {
    return sqlite
      .prepare(
        `SELECT id, username, email, password_hash, is_active, last_login_at, created_at, updated_at
         FROM app_users
         WHERE id = ?`,
      )
      .get(userId) as AppUserRow | undefined;
  }

  createUser(input: {
    username: string;
    email: string;
    passwordHash: string;
    roleIds: string[];
    enabled: boolean;
  }) {
    const timestamp = now();
    const userId = randomUUID();
    sqlite.transaction(() => {
      sqlite
        .prepare(
          `INSERT INTO app_users (id, username, email, password_hash, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          userId,
          input.username,
          input.email,
          input.passwordHash,
          input.enabled ? 1 : 0,
          timestamp,
          timestamp,
        );

      const insertUserRole = sqlite.prepare(
        `INSERT INTO app_user_roles (id, user_id, role_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      );

      for (const roleId of input.roleIds) {
        insertUserRole.run(randomUUID(), userId, roleId, timestamp, timestamp);
      }
    })();

    return this.getUserById(userId);
  }

  updateUser(
    userId: string,
    input: {
      username?: string;
      email?: string;
      passwordHash?: string;
      roleIds?: string[];
      enabled?: boolean;
      lastLoginAt?: number;
    },
  ) {
    const persisted = this.getUserRowById(userId);
    if (!persisted) {
      throw new ApiError(404, "USER_NOT_FOUND", "ユーザーが見つかりません。");
    }

    const timestamp = now();
    sqlite.transaction(() => {
      sqlite
        .prepare(
          `UPDATE app_users
           SET username = ?, email = ?, password_hash = ?, is_active = ?, last_login_at = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          input.username ?? persisted.username,
          input.email ?? persisted.email,
          input.passwordHash ?? persisted.password_hash,
          input.enabled == null ? persisted.is_active : input.enabled ? 1 : 0,
          input.lastLoginAt ?? persisted.last_login_at,
          timestamp,
          userId,
        );

      if (input.roleIds) {
        sqlite.prepare("DELETE FROM app_user_roles WHERE user_id = ?").run(userId);
        const insertUserRole = sqlite.prepare(
          `INSERT INTO app_user_roles (id, user_id, role_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
        );
        for (const roleId of input.roleIds) {
          insertUserRole.run(randomUUID(), userId, roleId, timestamp, timestamp);
        }
      }
    })();

    return this.getUserById(userId);
  }

  deleteUser(userId: string) {
    sqlite.transaction(() => {
      sqlite.prepare("DELETE FROM app_user_roles WHERE user_id = ?").run(userId);
      sqlite.prepare("DELETE FROM app_users WHERE id = ?").run(userId);
    })();
  }

  listConnections(): ConnectionSummary[] {
    const rows = sqlite
      .prepare(
        `SELECT id, name, dialect, host, port, username, encrypted_password, default_database,
                use_ssl, readonly, last_connected_at, created_at, updated_at
         FROM connections
         ORDER BY name`,
      )
      .all() as ConnectionRow[];
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      dialect: row.dialect,
      host: row.host,
      port: row.port,
      username: row.username,
      database: row.default_database ?? "",
      readonly: Boolean(row.readonly),
      useSsl: Boolean(row.use_ssl),
      lastConnectedAt: toIsoString(row.last_connected_at),
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    }));
  }

  getConnectionById(connectionId: string): ConnectionRecord | null {
    const row = sqlite
      .prepare(
        `SELECT id, name, dialect, host, port, username, encrypted_password, default_database,
                use_ssl, readonly, last_connected_at, created_at, updated_at
         FROM connections
         WHERE id = ?`,
      )
      .get(connectionId) as ConnectionRow | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      name: row.name,
      dialect: row.dialect,
      host: row.host,
      port: row.port,
      username: row.username,
      encryptedPassword: row.encrypted_password,
      defaultDatabase: row.default_database,
      database: row.default_database ?? "",
      readonly: Boolean(row.readonly),
      useSsl: Boolean(row.use_ssl),
      lastConnectedAt: toIsoString(row.last_connected_at),
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  createConnection(input: {
    name: string;
    dialect: ConnectionSummary["dialect"];
    host: string;
    port: number;
    username: string;
    encryptedPassword: string;
    defaultDatabase?: string;
    useSsl: boolean;
    readonly: boolean;
  }) {
    const timestamp = now();
    const connectionId = randomUUID();
    sqlite
      .prepare(
        `INSERT INTO connections
          (id, name, dialect, host, port, username, encrypted_password, default_database,
           use_ssl, readonly, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        connectionId,
        input.name,
        input.dialect,
        input.host,
        input.port,
        input.username,
        input.encryptedPassword,
        input.defaultDatabase || null,
        input.useSsl ? 1 : 0,
        input.readonly ? 1 : 0,
        timestamp,
        timestamp,
      );

    return this.getConnectionById(connectionId);
  }

  updateConnection(
    connectionId: string,
    input: {
      name?: string;
      dialect?: ConnectionSummary["dialect"];
      host?: string;
      port?: number;
      username?: string;
      encryptedPassword?: string;
      defaultDatabase?: string;
      useSsl?: boolean;
      readonly?: boolean;
    },
  ) {
    const existing = this.getConnectionById(connectionId);
    if (!existing) {
      throw new ApiError(404, "CONNECTION_NOT_FOUND", "接続が見つかりません。");
    }

    const timestamp = now();
    sqlite
      .prepare(
        `UPDATE connections
         SET name = ?, dialect = ?, host = ?, port = ?, username = ?, encrypted_password = ?,
             default_database = ?, use_ssl = ?, readonly = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        input.name ?? existing.name,
        input.dialect ?? existing.dialect,
        input.host ?? existing.host,
        input.port ?? existing.port,
        input.username ?? existing.username,
        input.encryptedPassword ?? existing.encryptedPassword,
        input.defaultDatabase ?? existing.defaultDatabase,
        input.useSsl == null ? (existing.useSsl ? 1 : 0) : input.useSsl ? 1 : 0,
        input.readonly == null ? (existing.readonly ? 1 : 0) : input.readonly ? 1 : 0,
        timestamp,
        connectionId,
      );

    return this.getConnectionById(connectionId);
  }

  deleteConnection(connectionId: string) {
    sqlite.prepare("DELETE FROM connections WHERE id = ?").run(connectionId);
  }

  touchConnection(connectionId: string) {
    const timestamp = now();
    sqlite
      .prepare(
        `UPDATE connections
         SET last_connected_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(timestamp, timestamp, connectionId);
  }

  addAuditLog(input: {
    actorUserId: string | null;
    action: string;
    resourceType: string;
    resourceId: string | null;
    details: Record<string, unknown>;
  }) {
    const timestamp = now();
    sqlite
      .prepare(
        `INSERT INTO audit_logs
          (id, actor_user_id, action, resource_type, resource_id, details_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        input.actorUserId,
        input.action,
        input.resourceType,
        input.resourceId,
        JSON.stringify(input.details),
        timestamp,
      );
  }

  listAuditLogs(limit = 20): AuditLogEntry[] {
    const rows = sqlite
      .prepare(
        `SELECT id, actor_user_id, action, resource_type, resource_id, details_json, created_at
         FROM audit_logs
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(limit) as AuditLogRow[];

    return rows.map((row) => ({
      id: row.id,
      actorUserId: row.actor_user_id,
      action: row.action,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      details: JSON.parse(row.details_json) as Record<string, unknown>,
      createdAt: new Date(row.created_at).toISOString(),
    }));
  }

  private toBookmark(row: QueryBookmarkRow): SqlBookmark {
    return {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      sql: row.sql_text,
      connectionId: row.connection_id,
      database: row.database_name,
      schema: row.schema_name,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  listQueryBookmarks(input: {
    userId: string;
    connectionId?: string | null;
    database?: string | null;
    schema?: string | null;
  }) {
    const conditions = ["user_id = ?"];
    const params: Array<string | null> = [input.userId];
    if (input.connectionId) {
      conditions.push("(connection_id = ? OR connection_id IS NULL)");
      params.push(input.connectionId);
    }
    if (input.database) {
      conditions.push("(database_name = ? OR database_name IS NULL)");
      params.push(input.database);
    }
    if (input.schema) {
      conditions.push("(schema_name = ? OR schema_name IS NULL)");
      params.push(input.schema);
    }
    const rows = sqlite
      .prepare(
        `SELECT id, user_id, name, sql_text, connection_id, database_name, schema_name, created_at, updated_at
         FROM query_bookmarks
         WHERE ${conditions.join(" AND ")}
         ORDER BY updated_at DESC, name ASC`,
      )
      .all(...params) as QueryBookmarkRow[];

    return rows.map((row) => this.toBookmark(row));
  }

  getQueryBookmarkById(bookmarkId: string, userId: string) {
    const row = sqlite
      .prepare(
        `SELECT id, user_id, name, sql_text, connection_id, database_name, schema_name, created_at, updated_at
         FROM query_bookmarks
         WHERE id = ? AND user_id = ?`,
      )
      .get(bookmarkId, userId) as QueryBookmarkRow | undefined;

    return row ? this.toBookmark(row) : null;
  }

  createQueryBookmark(input: {
    userId: string;
    name: string;
    sql: string;
    connectionId?: string | null;
    database?: string | null;
    schema?: string | null;
  }) {
    const timestamp = now();
    const bookmarkId = randomUUID();
    sqlite
      .prepare(
        `INSERT INTO query_bookmarks
          (id, user_id, name, sql_text, connection_id, database_name, schema_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        bookmarkId,
        input.userId,
        input.name,
        input.sql,
        input.connectionId ?? null,
        input.database ?? null,
        input.schema ?? null,
        timestamp,
        timestamp,
      );

    return this.getQueryBookmarkById(bookmarkId, input.userId);
  }

  updateQueryBookmark(
    bookmarkId: string,
    userId: string,
    input: {
      name?: string;
      sql?: string;
      connectionId?: string | null;
      database?: string | null;
      schema?: string | null;
    },
  ) {
    const existing = this.getQueryBookmarkById(bookmarkId, userId);
    if (!existing) {
      throw new ApiError(404, "BOOKMARK_NOT_FOUND", "SQL ブックマークが見つかりません。");
    }

    const timestamp = now();
    sqlite
      .prepare(
        `UPDATE query_bookmarks
         SET name = ?, sql_text = ?, connection_id = ?, database_name = ?, schema_name = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`,
      )
      .run(
        input.name ?? existing.name,
        input.sql ?? existing.sql,
        input.connectionId === undefined ? existing.connectionId : input.connectionId,
        input.database === undefined ? existing.database : input.database,
        input.schema === undefined ? existing.schema : input.schema,
        timestamp,
        bookmarkId,
        userId,
      );

    return this.getQueryBookmarkById(bookmarkId, userId);
  }

  deleteQueryBookmark(bookmarkId: string, userId: string) {
    const result = sqlite
      .prepare("DELETE FROM query_bookmarks WHERE id = ? AND user_id = ?")
      .run(bookmarkId, userId);

    if (result.changes === 0) {
      throw new ApiError(404, "BOOKMARK_NOT_FOUND", "SQL ブックマークが見つかりません。");
    }
  }
}
