import type { AppPermission, DatabaseDialect } from "@modern-db-admin/shared";

const permissionLabels: Partial<Record<AppPermission, string>> = {
  manage_app_users: "管理画面ユーザー管理",
  manage_app_roles: "管理画面ロール管理",
  manage_connections: "接続管理",
  view_connections: "接続閲覧",
  view_schema: "スキーマ閲覧",
  view_table_rows: "行閲覧",
  edit_table_rows: "行編集",
  execute_select_sql: "SELECT 実行",
  execute_mutation_sql: "更新 SQL 実行",
  execute_ddl_sql: "DDL 実行",
  manage_db_users: "DBユーザー管理",
  manage_db_privileges: "DB権限管理",
  export_data: "データ出力",
  view_audit_logs: "監査ログ閲覧",
};

export function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString("ja-JP");
}

export function formatNumber(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return "-";
  }
  return new Intl.NumberFormat("ja-JP").format(value);
}

export function dialectLabel(dialect: DatabaseDialect) {
  switch (dialect) {
    case "mariadb":
      return "MariaDB";
    case "mysql":
      return "MySQL";
    case "postgresql":
      return "PostgreSQL";
    default:
      return dialect;
  }
}

export function humanizePermission(permission: AppPermission) {
  return permissionLabels[permission] ?? permission;
}

export function stringifyCellValue(value: unknown) {
  if (value == null) {
    return "NULL";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}
