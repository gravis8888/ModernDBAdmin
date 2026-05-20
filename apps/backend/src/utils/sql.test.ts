import { describe, expect, it } from "vitest";

import { splitSqlStatements } from "./sql";

describe("splitSqlStatements", () => {
  it("handles trailing semicolons without producing empty statements", () => {
    expect(splitSqlStatements("SELECT 1;")).toEqual(["SELECT 1"]);
    expect(splitSqlStatements("SELECT 1; SELECT 2;")).toEqual(["SELECT 1", "SELECT 2"]);
  });

  it("does not split comments, quoted strings, or dollar-quoted blocks", () => {
    expect(
      splitSqlStatements("/* a;b */ SELECT 'c;d'; DO $$ BEGIN RAISE NOTICE 'x;y'; END $$;"),
    ).toEqual(["/* a;b */ SELECT 'c;d'", "DO $$ BEGIN RAISE NOTICE 'x;y'; END $$"]);
  });
});
