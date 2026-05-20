import type { FastifyBaseLogger } from "fastify";

import { AdapterRegistry } from "../adapters";
import { AuthService } from "./auth-service";
import { AuditLogService } from "./audit-log-service";
import { ConnectionService } from "./connection-service";
import { DatabaseService } from "./database-service";
import { EncryptionService } from "./encryption-service";
import { InternalStore } from "./internal-store";
import { PermissionService } from "./permission-service";
import { QuerySafetyService } from "./query-safety-service";
import { SqlBookmarkService } from "./sql-bookmark-service";

export type AppServices = {
  store: InternalStore;
  permissions: PermissionService;
  auth: AuthService;
  audit: AuditLogService;
  encryption: EncryptionService;
  connections: ConnectionService;
  database: DatabaseService;
  querySafety: QuerySafetyService;
  bookmarks: SqlBookmarkService;
  adapters: AdapterRegistry;
  logger: FastifyBaseLogger;
};

export function createAppServices(logger: FastifyBaseLogger): AppServices {
  const store = new InternalStore();
  const permissions = new PermissionService(store);
  const audit = new AuditLogService(store);
  const encryption = new EncryptionService();
  const adapters = new AdapterRegistry();
  const querySafety = new QuerySafetyService();
  const bookmarks = new SqlBookmarkService(store, audit);
  const auth = new AuthService(store, permissions);
  const connections = new ConnectionService(store, encryption, adapters, audit);
  const database = new DatabaseService(connections, adapters, audit, querySafety);

  return {
    store,
    permissions,
    auth,
    audit,
    encryption,
    connections,
    database,
    querySafety,
    bookmarks,
    adapters,
    logger,
  };
}
