import { describe, expect, it } from "vitest";

import { QuerySafetyService } from "./query-safety-service";

describe("QuerySafetyService", () => {
  const service = new QuerySafetyService();

  it("does not split semicolons inside quoted strings or dollar-quoted strings", () => {
    expect(service.splitStatements("SELECT 'a;b'; SELECT $$c;d$$")).toEqual([
      "SELECT 'a;b'",
      "SELECT $$c;d$$",
    ]);
  });

  it("detects mutation statements wrapped in WITH clauses", () => {
    expect(
      service.analyze(
        "WITH moved AS (DELETE FROM users WHERE id = 1 RETURNING *) SELECT * FROM moved",
      ),
    ).toMatchObject({
      requiredPermission: "execute_mutation_sql",
      dangerous: true,
      statementTypes: ["delete"],
    });
  });

  it("requires DDL permission for unknown or administrative statements", () => {
    expect(service.analyze("VACUUM").requiredPermission).toBe("execute_ddl_sql");
    expect(service.analyze("PRAGMA table_info(users)").requiredPermission).toBe("execute_ddl_sql");
  });

  it("rejects changing statements on readonly connections", () => {
    expect(() =>
      service.assertExecutionAllowed({
        sql: "UPDATE users SET name = 'x'",
        readonly: true,
        confirmDangerous: true,
      }),
    ).toThrow("読み取り専用モード");
  });

  it("limits the number of statements per execution", () => {
    const sql = Array.from({ length: 26 }, (_, index) => `SELECT ${index}`).join("; ");

    expect(() => service.analyze(sql)).toThrow("一度に実行できる SQL");
  });
});
