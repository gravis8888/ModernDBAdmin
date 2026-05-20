import { z } from "zod";

import { appPermissionValues } from "./types/app";

export const databaseDialectSchema = z.enum(["mysql", "mariadb", "postgresql"]);
export const themeModeSchema = z.enum(["light", "dark", "system"]);
export const appPermissionSchema = z.enum(appPermissionValues);

const unsafeSqlFragmentPattern = /[\0;]|--|\/\*|\*\//;
const sqlFragmentSchema = (minLength: number, maxLength: number) =>
  z
    .string()
    .trim()
    .min(minLength)
    .max(maxLength)
    .refine((value) => !unsafeSqlFragmentPattern.test(value), {
      message: "SQL fragment contains unsupported control characters or comments.",
    });

export const authSetupSchema = z.object({
  username: z.string().trim().min(3).max(40),
  email: z.email(),
  password: z.string().min(8).max(128),
});

export const authLoginSchema = z.object({
  identifier: z.string().trim().min(3).max(120),
  password: z.string().min(8).max(128),
});

export const connectionFormSchema = z.object({
  name: z.string().trim().min(2).max(80),
  dialect: databaseDialectSchema,
  host: z.string().trim().min(1).max(255),
  port: z.coerce.number().int().min(1).max(65535),
  username: z.string().trim().min(1).max(120),
  password: z.string().min(1).max(512),
  defaultDatabase: z.string().trim().max(120).optional().or(z.literal("")),
  useSsl: z.coerce.boolean().default(false),
  readonly: z.coerce.boolean().default(false),
});

export const appUserCreateSchema = z.object({
  username: z.string().trim().min(3).max(40),
  email: z.email(),
  password: z.string().min(8).max(128),
  roleIds: z.array(z.string().min(1)).min(1),
  enabled: z.coerce.boolean().default(true),
});

export const appUserUpdateSchema = z.object({
  username: z.string().trim().min(3).max(40).optional(),
  email: z.email().optional(),
  password: z.string().min(8).max(128).optional(),
  roleIds: z.array(z.string().min(1)).min(1).optional(),
  enabled: z.coerce.boolean().optional(),
});

export const appRoleCreateSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().min(2).max(200),
  permissionKeys: z.array(appPermissionSchema).min(1),
});

export const appRoleUpdateSchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  description: z.string().trim().min(2).max(200).optional(),
  permissionKeys: z.array(appPermissionSchema).min(1).optional(),
});

export const listRowsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(1000).default(50),
  orderBy: z.string().trim().max(120).optional(),
  orderDir: z.enum(["asc", "desc"]).default("asc"),
  search: z.string().trim().max(200).optional(),
  filters: z.preprocess(
    (value) => {
      if (typeof value !== "string" || value.trim().length === 0) {
        return undefined;
      }
      try {
        return JSON.parse(value) as unknown;
      } catch {
        return value;
      }
    },
    z
      .array(
        z.object({
          column: z.string().trim().min(1).max(120),
          operator: z.enum([
            "eq",
            "not",
            "contains",
            "starts",
            "ends",
            "gt",
            "gte",
            "lt",
            "lte",
            "is-null",
            "not-null",
          ]),
          value: z.unknown().optional(),
        }),
      )
      .max(25)
      .default([]),
  ),
});

export const rowMutationSchema = z.object({
  values: z.record(z.string(), z.unknown()).default({}),
  criteria: z.record(z.string(), z.unknown()).default({}),
});

export const executeSqlSchema = z.object({
  sql: z.string().trim().min(1).max(100_000),
  confirmDangerous: z.coerce.boolean().default(false),
});

export const createDatabaseSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export const truncateTableSchema = z.object({
  confirmDangerous: z.coerce.boolean().default(false),
});

export const databaseUserCreateSchema = z.object({
  username: z.string().trim().min(1).max(120),
  host: z.string().trim().max(120).optional(),
  password: z.string().min(1).max(512),
  canLogin: z.coerce.boolean().default(true),
  isSuperuser: z.coerce.boolean().default(false),
  canCreateDatabase: z.coerce.boolean().default(false),
  canCreateUser: z.coerce.boolean().default(false),
  canReplication: z.coerce.boolean().default(false),
  canBypassRls: z.coerce.boolean().default(false),
});

export const databaseUserUpdateSchema = z.object({
  password: z.string().min(1).max(512).optional(),
  canLogin: z.coerce.boolean().optional(),
  isSuperuser: z.coerce.boolean().optional(),
  canCreateDatabase: z.coerce.boolean().optional(),
  canCreateUser: z.coerce.boolean().optional(),
  canReplication: z.coerce.boolean().optional(),
  canBypassRls: z.coerce.boolean().optional(),
});

export const databasePrivilegeMutationSchema = z.object({
  objectType: z.enum(["global", "database", "schema", "table", "sequence", "role_membership"]),
  database: z.string().trim().max(120).optional(),
  schema: z.string().trim().max(120).optional(),
  table: z.string().trim().max(120).optional(),
  sequence: z.string().trim().max(120).optional(),
  privileges: z.array(z.string().trim().min(1).max(60)).min(1),
  sourceRole: z.string().trim().max(120).optional(),
  confirmDangerous: z.coerce.boolean().default(false),
});

const optionalSqlNameSchema = z.string().trim().max(120).optional().or(z.literal(""));

export const tableColumnDraftSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: sqlFragmentSchema(1, 120),
  nullable: z.coerce.boolean().default(true),
  defaultValue: sqlFragmentSchema(0, 400).optional().or(z.literal("")),
  primaryKey: z.coerce.boolean().default(false),
  autoIncrement: z.coerce.boolean().default(false),
});

export const createTableSchema = z.object({
  name: z.string().trim().min(1).max(120),
  columns: z.array(tableColumnDraftSchema).min(1),
});

export const renameTableSchema = z.object({
  nextName: z.string().trim().min(1).max(120),
});

export const addColumnSchema = tableColumnDraftSchema.omit({
  primaryKey: true,
});

export const createIndexSchema = z.object({
  name: z.string().trim().min(1).max(120),
  columns: z.array(z.string().trim().min(1).max(120)).min(1),
  unique: z.coerce.boolean().default(false),
});

export const importCsvSchema = z.object({
  csv: z.string().min(1).max(2_000_000),
  delimiter: z.enum([",", ";", "\t"]).default(","),
  truncateBeforeImport: z.coerce.boolean().default(false),
});

export const sqlBookmarkCreateSchema = z.object({
  name: z.string().trim().min(2).max(80),
  sql: z.string().trim().min(1).max(20_000),
  connectionId: optionalSqlNameSchema,
  database: optionalSqlNameSchema,
  schema: optionalSqlNameSchema,
});

export const sqlBookmarkUpdateSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  sql: z.string().trim().min(1).max(20_000).optional(),
  connectionId: optionalSqlNameSchema,
  database: optionalSqlNameSchema,
  schema: optionalSqlNameSchema,
});

export type AuthSetupInput = z.infer<typeof authSetupSchema>;
export type AuthLoginInput = z.infer<typeof authLoginSchema>;
export type ConnectionFormInput = z.infer<typeof connectionFormSchema>;
export type AppUserCreateInput = z.infer<typeof appUserCreateSchema>;
export type AppUserUpdateInput = z.infer<typeof appUserUpdateSchema>;
export type AppRoleCreateInput = z.infer<typeof appRoleCreateSchema>;
export type AppRoleUpdateInput = z.infer<typeof appRoleUpdateSchema>;
export type ListRowsQueryInput = z.infer<typeof listRowsQuerySchema>;
export type RowFilterInput = ListRowsQueryInput["filters"][number];
export type RowMutationInput = z.infer<typeof rowMutationSchema>;
export type ExecuteSqlInput = z.infer<typeof executeSqlSchema>;
export type CreateDatabaseInput = z.infer<typeof createDatabaseSchema>;
export type TruncateTableInput = z.infer<typeof truncateTableSchema>;
export type DatabaseUserCreateInput = z.infer<typeof databaseUserCreateSchema>;
export type DatabaseUserUpdateInput = z.infer<typeof databaseUserUpdateSchema>;
export type DatabasePrivilegeMutationInput = z.infer<typeof databasePrivilegeMutationSchema>;
export type TableColumnDraftInput = z.infer<typeof tableColumnDraftSchema>;
export type CreateTableInput = z.infer<typeof createTableSchema>;
export type RenameTableInput = z.infer<typeof renameTableSchema>;
export type AddColumnInput = z.infer<typeof addColumnSchema>;
export type CreateIndexInput = z.infer<typeof createIndexSchema>;
export type ImportCsvInput = z.infer<typeof importCsvSchema>;
export type SqlBookmarkCreateInput = z.infer<typeof sqlBookmarkCreateSchema>;
export type SqlBookmarkUpdateInput = z.infer<typeof sqlBookmarkUpdateSchema>;
