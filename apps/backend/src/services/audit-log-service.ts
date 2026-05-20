import { InternalStore } from "./internal-store";

export class AuditLogService {
  constructor(private readonly store: InternalStore) {}

  record(input: {
    actorUserId: string | null;
    action: string;
    resourceType: string;
    resourceId: string | null;
    details: Record<string, unknown>;
  }) {
    this.store.addAuditLog(input);
  }

  listRecent(limit = 20) {
    return this.store.listAuditLogs(limit);
  }
}
