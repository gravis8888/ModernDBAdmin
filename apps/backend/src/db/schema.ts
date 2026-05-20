import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
};

export const appUsers = sqliteTable(
  "app_users",
  {
    id: text("id").primaryKey(),
    username: text("username").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    lastLoginAt: integer("last_login_at", { mode: "timestamp_ms" }),
    ...timestamps,
  },
  (table) => ({
    emailIndex: uniqueIndex("app_users_email_idx").on(table.email),
    usernameIndex: uniqueIndex("app_users_username_idx").on(table.username),
  }),
);

export const appRoles = sqliteTable(
  "app_roles",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    isSystem: integer("is_system", { mode: "boolean" }).notNull().default(false),
    ...timestamps,
  },
  (table) => ({
    roleNameIndex: uniqueIndex("app_roles_name_idx").on(table.name),
  }),
);

export const appPermissions = sqliteTable(
  "app_permissions",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    category: text("category").notNull(),
    ...timestamps,
  },
  (table) => ({
    permissionKeyIndex: uniqueIndex("app_permissions_key_idx").on(table.key),
  }),
);

export const appUserRoles = sqliteTable(
  "app_user_roles",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    roleId: text("role_id").notNull(),
    ...timestamps,
  },
  (table) => ({
    uniqueUserRoleIndex: uniqueIndex("app_user_roles_unique_idx").on(table.userId, table.roleId),
  }),
);

export const rolePermissions = sqliteTable(
  "role_permissions",
  {
    id: text("id").primaryKey(),
    roleId: text("role_id").notNull(),
    permissionId: text("permission_id").notNull(),
    ...timestamps,
  },
  (table) => ({
    uniqueRolePermissionIndex: uniqueIndex("role_permissions_unique_idx").on(
      table.roleId,
      table.permissionId,
    ),
  }),
);

export const connections = sqliteTable(
  "connections",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    dialect: text("dialect").notNull(),
    host: text("host").notNull(),
    port: integer("port").notNull(),
    username: text("username").notNull(),
    encryptedPassword: text("encrypted_password").notNull(),
    defaultDatabase: text("default_database"),
    useSsl: integer("use_ssl", { mode: "boolean" }).notNull().default(false),
    readonly: integer("readonly", { mode: "boolean" }).notNull().default(false),
    lastConnectedAt: integer("last_connected_at", { mode: "timestamp_ms" }),
    ...timestamps,
  },
  (table) => ({
    connectionNameIndex: uniqueIndex("connections_name_idx").on(table.name),
  }),
);

export const auditLogs = sqliteTable("audit_logs", {
  id: text("id").primaryKey(),
  actorUserId: text("actor_user_id"),
  action: text("action").notNull(),
  resourceType: text("resource_type").notNull(),
  resourceId: text("resource_id"),
  detailsJson: text("details_json").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const queryBookmarks = sqliteTable("query_bookmarks", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  sqlText: text("sql_text").notNull(),
  connectionId: text("connection_id"),
  databaseName: text("database_name"),
  schemaName: text("schema_name"),
  ...timestamps,
});
