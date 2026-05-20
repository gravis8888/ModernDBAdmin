import type { AppPermission, SystemRoleName } from "@modern-db-admin/shared";

export const systemPermissions: Array<{
  key: AppPermission;
  label: string;
  category: string;
}> = [
  { key: "manage_app_users", label: "管理画面ユーザー管理", category: "app" },
  { key: "manage_app_roles", label: "管理画面ロール管理", category: "app" },
  { key: "manage_connections", label: "接続管理", category: "connections" },
  { key: "view_connections", label: "接続閲覧", category: "connections" },
  { key: "view_schema", label: "スキーマ閲覧", category: "database" },
  { key: "view_table_rows", label: "行閲覧", category: "database" },
  { key: "edit_table_rows", label: "行編集", category: "database" },
  { key: "execute_select_sql", label: "SELECT SQL 実行", category: "sql" },
  { key: "execute_mutation_sql", label: "変更 SQL 実行", category: "sql" },
  { key: "execute_ddl_sql", label: "DDL / 権限 SQL 実行", category: "sql" },
  { key: "manage_db_users", label: "DB ユーザー管理", category: "database-security" },
  {
    key: "manage_db_privileges",
    label: "DB 権限管理",
    category: "database-security",
  },
  { key: "export_data", label: "データエクスポート", category: "database" },
  { key: "view_audit_logs", label: "監査ログ閲覧", category: "audit" },
];

export const systemRoles: Array<{
  name: SystemRoleName;
  description: string;
  permissionKeys: AppPermission[];
}> = [
  {
    name: "Admin",
    description: "アプリとDB管理のすべてを操作できます。",
    permissionKeys: systemPermissions.map((permission) => permission.key),
  },
  {
    name: "Developer",
    description: "接続・スキーマ・SQL 実行・行編集を行えます。",
    permissionKeys: [
      "manage_connections",
      "view_connections",
      "view_schema",
      "view_table_rows",
      "edit_table_rows",
      "execute_select_sql",
      "execute_mutation_sql",
      "export_data",
    ],
  },
  {
    name: "Viewer",
    description: "読み取り専用です。",
    permissionKeys: [
      "view_connections",
      "view_schema",
      "view_table_rows",
      "execute_select_sql",
      "export_data",
    ],
  },
];
