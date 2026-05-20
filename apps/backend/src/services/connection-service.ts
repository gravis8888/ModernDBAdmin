import type { ConnectionFormInput } from "@modern-db-admin/shared";

import { AdapterRegistry } from "../adapters";
import type { ResolvedConnectionConfig } from "../adapters/database-adapter";
import { ApiError } from "../utils/api-error";
import { AuditLogService } from "./audit-log-service";
import { EncryptionService } from "./encryption-service";
import { InternalStore } from "./internal-store";

export class ConnectionService {
  constructor(
    private readonly store: InternalStore,
    private readonly encryptionService: EncryptionService,
    private readonly adapters: AdapterRegistry,
    private readonly auditLogService: AuditLogService,
  ) {}

  listConnections() {
    return this.store.listConnections();
  }

  getConnection(connectionId: string) {
    const connection = this.store.getConnectionById(connectionId);
    if (!connection) {
      throw new ApiError(404, "CONNECTION_NOT_FOUND", "接続が見つかりません。");
    }
    return connection;
  }

  resolveConnection(connectionId: string): ResolvedConnectionConfig {
    const connection = this.getConnection(connectionId);
    return {
      id: connection.id,
      name: connection.name,
      dialect: connection.dialect,
      host: connection.host,
      port: connection.port,
      username: connection.username,
      password: this.encryptionService.decrypt(connection.encryptedPassword),
      defaultDatabase: connection.defaultDatabase,
      useSsl: connection.useSsl,
      readonly: connection.readonly,
    };
  }

  async createConnection(input: ConnectionFormInput, actorUserId: string) {
    const encryptedPassword = this.encryptionService.encrypt(input.password);
    const connection = this.store.createConnection({
      name: input.name,
      dialect: input.dialect,
      host: input.host,
      port: input.port,
      username: input.username,
      encryptedPassword,
      defaultDatabase: input.defaultDatabase || undefined,
      useSsl: input.useSsl,
      readonly: input.readonly,
    });
    if (!connection) {
      throw new ApiError(500, "CONNECTION_CREATE_FAILED", "接続を作成できませんでした。");
    }
    this.auditLogService.record({
      actorUserId,
      action: "connection.create",
      resourceType: "connection",
      resourceId: connection.id,
      details: { name: connection.name, dialect: connection.dialect },
    });
    return connection;
  }

  async updateConnection(connectionId: string, input: ConnectionFormInput, actorUserId: string) {
    await this.adapters.closeConnection(connectionId);
    const encryptedPassword = this.encryptionService.encrypt(input.password);
    const connection = this.store.updateConnection(connectionId, {
      name: input.name,
      dialect: input.dialect,
      host: input.host,
      port: input.port,
      username: input.username,
      encryptedPassword,
      defaultDatabase: input.defaultDatabase || undefined,
      useSsl: input.useSsl,
      readonly: input.readonly,
    });
    if (!connection) {
      throw new ApiError(500, "CONNECTION_UPDATE_FAILED", "接続を更新できませんでした。");
    }
    this.auditLogService.record({
      actorUserId,
      action: "connection.update",
      resourceType: "connection",
      resourceId: connection.id,
      details: { name: connection.name, dialect: connection.dialect },
    });
    return connection;
  }

  async deleteConnection(connectionId: string, actorUserId: string) {
    const connection = this.getConnection(connectionId);
    await this.adapters.closeConnection(connectionId);
    this.store.deleteConnection(connectionId);
    this.auditLogService.record({
      actorUserId,
      action: "connection.delete",
      resourceType: "connection",
      resourceId: connectionId,
      details: { name: connection.name },
    });
  }

  async testConnection(connectionId: string, actorUserId: string) {
    const config = this.resolveConnection(connectionId);
    const adapter = this.adapters.getAdapter(config.dialect);
    const result = await adapter.testConnection(config);
    this.store.touchConnection(connectionId);
    this.auditLogService.record({
      actorUserId,
      action: "connection.test",
      resourceType: "connection",
      resourceId: connectionId,
      details: { host: config.host, database: config.defaultDatabase },
    });
    return result;
  }
}
