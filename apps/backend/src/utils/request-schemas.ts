import { z } from "zod";

const identifierSchema = z.string().trim().min(1).max(255);
const optionalIdentifierSchema = identifierSchema.optional();

export const connectionIdParamsSchema = z.object({
  connectionId: z.string().uuid(),
});

export const userIdParamsSchema = z.object({
  userId: z.string().uuid(),
});

export const roleIdParamsSchema = z.object({
  roleId: z.string().uuid(),
});

export const bookmarkIdParamsSchema = z.object({
  bookmarkId: z.string().uuid(),
});

export const connectionDatabaseParamsSchema = connectionIdParamsSchema.extend({
  database: identifierSchema,
});

export const connectionDatabaseSchemaParamsSchema = connectionDatabaseParamsSchema.extend({
  schema: identifierSchema,
});

export const connectionDatabaseSchemaTableParamsSchema =
  connectionDatabaseSchemaParamsSchema.extend({
    table: identifierSchema,
  });

export const connectionDatabaseSchemaTableColumnParamsSchema =
  connectionDatabaseSchemaTableParamsSchema.extend({
    column: identifierSchema,
  });

export const connectionDatabaseSchemaTableIndexParamsSchema =
  connectionDatabaseSchemaTableParamsSchema.extend({
    index: identifierSchema,
  });

export const connectionDbUserParamsSchema = connectionIdParamsSchema.extend({
  dbUserId: identifierSchema.max(320),
});

export const monitorQuerySchema = z.object({
  database: optionalIdentifierSchema,
});

export const exportTableQuerySchema = z.object({
  format: z.enum(["csv", "json", "insert_sql", "table_sql"]).default("csv"),
});

export const privilegePreviewQuerySchema = z.object({
  action: z.enum(["grant", "revoke"]).default("grant"),
});

export const sqlBookmarkListQuerySchema = z.object({
  connectionId: z.string().uuid().optional(),
  database: optionalIdentifierSchema,
  schema: optionalIdentifierSchema,
});
