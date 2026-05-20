import type {
  SessionUser,
  SqlBookmarkCreateInput,
  SqlBookmarkUpdateInput,
} from "@modern-db-admin/shared";

import { AuditLogService } from "./audit-log-service";
import { InternalStore } from "./internal-store";

export class SqlBookmarkService {
  constructor(
    private readonly store: InternalStore,
    private readonly auditLogService: AuditLogService,
  ) {}

  list(
    sessionUser: SessionUser,
    filter: { connectionId?: string; database?: string; schema?: string },
  ) {
    return this.store.listQueryBookmarks({
      userId: sessionUser.id,
      connectionId: filter.connectionId,
      database: filter.database,
      schema: filter.schema,
    });
  }

  create(sessionUser: SessionUser, input: SqlBookmarkCreateInput) {
    const bookmark = this.store.createQueryBookmark({
      userId: sessionUser.id,
      name: input.name,
      sql: input.sql,
      connectionId: input.connectionId || null,
      database: input.database || null,
      schema: input.schema || null,
    });

    this.auditLogService.record({
      actorUserId: sessionUser.id,
      action: "bookmark.create",
      resourceType: "sql-bookmark",
      resourceId: bookmark?.id ?? null,
      details: {
        connectionId: input.connectionId || null,
        database: input.database || null,
        schema: input.schema || null,
      },
    });

    return bookmark;
  }

  update(bookmarkId: string, sessionUser: SessionUser, input: SqlBookmarkUpdateInput) {
    const bookmark = this.store.updateQueryBookmark(bookmarkId, sessionUser.id, {
      name: input.name,
      sql: input.sql,
      connectionId: input.connectionId === undefined ? undefined : input.connectionId || null,
      database: input.database === undefined ? undefined : input.database || null,
      schema: input.schema === undefined ? undefined : input.schema || null,
    });

    this.auditLogService.record({
      actorUserId: sessionUser.id,
      action: "bookmark.update",
      resourceType: "sql-bookmark",
      resourceId: bookmark?.id ?? bookmarkId,
      details: {
        connectionId: input.connectionId || null,
        database: input.database || null,
        schema: input.schema || null,
      },
    });

    return bookmark;
  }

  delete(bookmarkId: string, sessionUser: SessionUser) {
    this.store.deleteQueryBookmark(bookmarkId, sessionUser.id);
    this.auditLogService.record({
      actorUserId: sessionUser.id,
      action: "bookmark.delete",
      resourceType: "sql-bookmark",
      resourceId: bookmarkId,
      details: {},
    });
  }
}
