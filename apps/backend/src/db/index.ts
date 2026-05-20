import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import { systemPermissions, systemRoles } from "../constants/system";
import { env } from "../plugins/env";

const runtimeDir = path.dirname(fileURLToPath(import.meta.url));
const backendRoot =
  path.basename(runtimeDir) === "dist"
    ? path.resolve(runtimeDir, "..")
    : path.resolve(runtimeDir, "../..");
const resolvedPath = path.isAbsolute(env.SQLITE_DB_PATH)
  ? env.SQLITE_DB_PATH
  : path.resolve(backendRoot, env.SQLITE_DB_PATH);
const directory = path.dirname(resolvedPath);

if (!fs.existsSync(directory)) {
  fs.mkdirSync(directory, { recursive: true });
}

export const sqlite = new Database(resolvedPath);

sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS app_users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    last_login_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS app_roles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL,
    is_system INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS app_permissions (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    category TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS app_user_roles (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    role_id TEXT NOT NULL REFERENCES app_roles(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(user_id, role_id)
  );

  CREATE TABLE IF NOT EXISTS role_permissions (
    id TEXT PRIMARY KEY,
    role_id TEXT NOT NULL REFERENCES app_roles(id) ON DELETE CASCADE,
    permission_id TEXT NOT NULL REFERENCES app_permissions(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(role_id, permission_id)
  );

  CREATE TABLE IF NOT EXISTS connections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    dialect TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER NOT NULL,
    username TEXT NOT NULL,
    encrypted_password TEXT NOT NULL,
    default_database TEXT,
    use_ssl INTEGER NOT NULL DEFAULT 0,
    readonly INTEGER NOT NULL DEFAULT 0,
    last_connected_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    actor_user_id TEXT REFERENCES app_users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT,
    details_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS query_bookmarks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sql_text TEXT NOT NULL,
    connection_id TEXT REFERENCES connections(id) ON DELETE SET NULL,
    database_name TEXT,
    schema_name TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);

function ensureTableForeignKeys(options: {
  tableName: "app_user_roles" | "role_permissions" | "audit_logs" | "query_bookmarks";
  createSql: string;
  insertSql: (legacyTableName: string) => string;
  requiredForeignKeys: Array<{ column: string; referencedTable: string }>;
}) {
  const foreignKeys = sqlite
    .prepare(`PRAGMA foreign_key_list(${options.tableName})`)
    .all() as Array<{ from: string; table: string }>;
  const hasAllRequiredForeignKeys = options.requiredForeignKeys.every((requiredForeignKey) =>
    foreignKeys.some(
      (foreignKey) =>
        foreignKey.from === requiredForeignKey.column &&
        foreignKey.table === requiredForeignKey.referencedTable,
    ),
  );

  if (hasAllRequiredForeignKeys) {
    return;
  }

  const legacyTableName = `${options.tableName}__legacy`;
  sqlite.pragma("foreign_keys = OFF");
  try {
    const migrateTable = sqlite.transaction(() => {
      sqlite.exec(`DROP TABLE IF EXISTS ${legacyTableName}`);
      sqlite.exec(`ALTER TABLE ${options.tableName} RENAME TO ${legacyTableName}`);
      sqlite.exec(options.createSql);
      sqlite.exec(options.insertSql(legacyTableName));
      sqlite.exec(`DROP TABLE ${legacyTableName}`);
    });

    migrateTable();
  } finally {
    sqlite.pragma("foreign_keys = ON");
  }
}

ensureTableForeignKeys({
  tableName: "app_user_roles",
  requiredForeignKeys: [
    { column: "user_id", referencedTable: "app_users" },
    { column: "role_id", referencedTable: "app_roles" },
  ],
  createSql: `
    CREATE TABLE app_user_roles (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      role_id TEXT NOT NULL REFERENCES app_roles(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(user_id, role_id)
    );
  `,
  insertSql: (legacyTableName) => `
    INSERT INTO app_user_roles (id, user_id, role_id, created_at, updated_at)
    SELECT legacy.id, legacy.user_id, legacy.role_id, legacy.created_at, legacy.updated_at
    FROM ${legacyTableName} legacy
    INNER JOIN app_users users ON users.id = legacy.user_id
    INNER JOIN app_roles roles ON roles.id = legacy.role_id;
  `,
});

ensureTableForeignKeys({
  tableName: "role_permissions",
  requiredForeignKeys: [
    { column: "role_id", referencedTable: "app_roles" },
    { column: "permission_id", referencedTable: "app_permissions" },
  ],
  createSql: `
    CREATE TABLE role_permissions (
      id TEXT PRIMARY KEY,
      role_id TEXT NOT NULL REFERENCES app_roles(id) ON DELETE CASCADE,
      permission_id TEXT NOT NULL REFERENCES app_permissions(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(role_id, permission_id)
    );
  `,
  insertSql: (legacyTableName) => `
    INSERT INTO role_permissions (id, role_id, permission_id, created_at, updated_at)
    SELECT legacy.id, legacy.role_id, legacy.permission_id, legacy.created_at, legacy.updated_at
    FROM ${legacyTableName} legacy
    INNER JOIN app_roles roles ON roles.id = legacy.role_id
    INNER JOIN app_permissions permissions ON permissions.id = legacy.permission_id;
  `,
});

ensureTableForeignKeys({
  tableName: "audit_logs",
  requiredForeignKeys: [{ column: "actor_user_id", referencedTable: "app_users" }],
  createSql: `
    CREATE TABLE audit_logs (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT REFERENCES app_users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT,
      details_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `,
  insertSql: (legacyTableName) => `
    INSERT INTO audit_logs (id, actor_user_id, action, resource_type, resource_id, details_json, created_at)
    SELECT
      legacy.id,
      CASE WHEN users.id IS NOT NULL THEN legacy.actor_user_id ELSE NULL END,
      legacy.action,
      legacy.resource_type,
      legacy.resource_id,
      legacy.details_json,
      legacy.created_at
    FROM ${legacyTableName} legacy
    LEFT JOIN app_users users ON users.id = legacy.actor_user_id;
  `,
});

ensureTableForeignKeys({
  tableName: "query_bookmarks",
  requiredForeignKeys: [
    { column: "user_id", referencedTable: "app_users" },
    { column: "connection_id", referencedTable: "connections" },
  ],
  createSql: `
    CREATE TABLE query_bookmarks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      sql_text TEXT NOT NULL,
      connection_id TEXT REFERENCES connections(id) ON DELETE SET NULL,
      database_name TEXT,
      schema_name TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `,
  insertSql: (legacyTableName) => `
    INSERT INTO query_bookmarks (
      id,
      user_id,
      name,
      sql_text,
      connection_id,
      database_name,
      schema_name,
      created_at,
      updated_at
    )
    SELECT
      legacy.id,
      legacy.user_id,
      legacy.name,
      legacy.sql_text,
      CASE WHEN connections.id IS NOT NULL THEN legacy.connection_id ELSE NULL END,
      legacy.database_name,
      legacy.schema_name,
      legacy.created_at,
      legacy.updated_at
    FROM ${legacyTableName} legacy
    INNER JOIN app_users users ON users.id = legacy.user_id
    LEFT JOIN connections ON connections.id = legacy.connection_id;
  `,
});

sqlite.exec(`
  CREATE INDEX IF NOT EXISTS app_user_roles_user_idx
    ON app_user_roles (user_id);

  CREATE INDEX IF NOT EXISTS app_user_roles_role_idx
    ON app_user_roles (role_id);

  CREATE INDEX IF NOT EXISTS role_permissions_role_idx
    ON role_permissions (role_id);

  CREATE INDEX IF NOT EXISTS role_permissions_permission_idx
    ON role_permissions (permission_id);

  CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx
    ON audit_logs (created_at DESC);

  CREATE INDEX IF NOT EXISTS query_bookmarks_user_idx
    ON query_bookmarks (user_id, updated_at DESC);

  CREATE INDEX IF NOT EXISTS query_bookmarks_lookup_idx
    ON query_bookmarks (user_id, connection_id, database_name, schema_name, updated_at DESC);
`);

const permissionCount = (
  sqlite.prepare("SELECT COUNT(*) AS count FROM app_permissions").get() as { count: number }
).count;

if (permissionCount === 0) {
  const now = Date.now();
  const insertPermission = sqlite.prepare(`
    INSERT INTO app_permissions (id, key, label, category, created_at, updated_at)
    VALUES (@id, @key, @label, @category, @createdAt, @updatedAt)
  `);
  const insertRole = sqlite.prepare(`
    INSERT INTO app_roles (id, name, description, is_system, created_at, updated_at)
    VALUES (@id, @name, @description, @isSystem, @createdAt, @updatedAt)
  `);
  const insertRolePermission = sqlite.prepare(`
    INSERT INTO role_permissions (id, role_id, permission_id, created_at, updated_at)
    VALUES (@id, @roleId, @permissionId, @createdAt, @updatedAt)
  `);

  const permissionIds = new Map<string, string>();

  const seedTransaction = sqlite.transaction(() => {
    for (const permission of systemPermissions) {
      const permissionId = randomUUID();
      permissionIds.set(permission.key, permissionId);
      insertPermission.run({
        id: permissionId,
        key: permission.key,
        label: permission.label,
        category: permission.category,
        createdAt: now,
        updatedAt: now,
      });
    }

    for (const role of systemRoles) {
      const roleId = randomUUID();
      insertRole.run({
        id: roleId,
        name: role.name,
        description: role.description,
        isSystem: 1,
        createdAt: now,
        updatedAt: now,
      });

      for (const permissionKey of role.permissionKeys) {
        const permissionId = permissionIds.get(permissionKey);
        if (!permissionId) {
          continue;
        }

        insertRolePermission.run({
          id: randomUUID(),
          roleId,
          permissionId,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  });

  seedTransaction();
}

export const db = drizzle(sqlite);
