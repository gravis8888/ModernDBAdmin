import type { FastifyInstance } from "fastify";

import { sqlBookmarkCreateSchema, sqlBookmarkUpdateSchema } from "@modern-db-admin/shared";
import { parseRequestParams, parseRequestQuery } from "../utils/request";
import { bookmarkIdParamsSchema, sqlBookmarkListQuerySchema } from "../utils/request-schemas";

export async function registerSqlBookmarkRoutes(app: FastifyInstance) {
  app.get("/api/sql-bookmarks", { preHandler: app.requireAuth }, async (request) => {
    const sessionUser = app.currentSessionUser(request);
    const query = parseRequestQuery(request, sqlBookmarkListQuerySchema);
    return {
      bookmarks: app.services.bookmarks.list(sessionUser, {
        connectionId: query.connectionId,
        database: query.database,
        schema: query.schema,
      }),
    };
  });

  app.post("/api/sql-bookmarks", { preHandler: app.requireAuth }, async (request) => {
    const sessionUser = app.currentSessionUser(request);
    const input = sqlBookmarkCreateSchema.parse(request.body);
    return {
      bookmark: app.services.bookmarks.create(sessionUser, input),
    };
  });

  app.put("/api/sql-bookmarks/:bookmarkId", { preHandler: app.requireAuth }, async (request) => {
    const sessionUser = app.currentSessionUser(request);
    const { bookmarkId } = parseRequestParams(request, bookmarkIdParamsSchema);
    const input = sqlBookmarkUpdateSchema.parse(request.body);
    return {
      bookmark: app.services.bookmarks.update(bookmarkId, sessionUser, input),
    };
  });

  app.delete("/api/sql-bookmarks/:bookmarkId", { preHandler: app.requireAuth }, async (request) => {
    const sessionUser = app.currentSessionUser(request);
    const { bookmarkId } = parseRequestParams(request, bookmarkIdParamsSchema);
    app.services.bookmarks.delete(bookmarkId, sessionUser);
    return { ok: true };
  });
}
