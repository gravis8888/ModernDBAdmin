import type { AppPermission } from "@modern-db-admin/shared";

import { ApiError } from "../utils/api-error";
import { splitSqlStatements } from "../utils/sql";

export type SqlAnalysis = {
  statements: string[];
  statementTypes: string[];
  requiredPermission: AppPermission;
  dangerous: boolean;
};

type SqlKeywordToken = {
  depth: number;
  word: string;
};

const selectKeywords = ["select", "show", "describe", "explain"];
const mutationKeywords = ["insert", "update", "delete", "merge", "replace"];
const ddlKeywords = ["create", "alter", "drop", "truncate", "grant", "revoke", "rename"];
const administrativeKeywords = [
  "analyze",
  "begin",
  "call",
  "commit",
  "copy",
  "do",
  "execute",
  "lock",
  "notify",
  "reset",
  "rollback",
  "set",
  "use",
  "vacuum",
];
const maxStatementCount = 25;

export class QuerySafetyService {
  splitStatements(sql: string) {
    const statements = splitSqlStatements(sql);

    if (statements.length > maxStatementCount) {
      throw new ApiError(
        400,
        "SQL_STATEMENT_LIMIT_EXCEEDED",
        `一度に実行できる SQL は ${maxStatementCount} 文までです。`,
      );
    }

    return statements;
  }

  analyze(sql: string): SqlAnalysis {
    const statements = this.splitStatements(sql);
    if (statements.length === 0) {
      throw new ApiError(400, "SQL_EMPTY", "SQL が空です。");
    }

    const statementTypes = statements.map((statement) => this.detectStatementType(statement));
    const hasDdl = statementTypes.some(
      (type) =>
        ddlKeywords.includes(type) ||
        administrativeKeywords.includes(type) ||
        (!selectKeywords.includes(type) && !mutationKeywords.includes(type)),
    );
    const hasMutation = statementTypes.some((type) => mutationKeywords.includes(type));

    return {
      statements,
      statementTypes,
      requiredPermission: hasDdl
        ? "execute_ddl_sql"
        : hasMutation
          ? "execute_mutation_sql"
          : "execute_select_sql",
      dangerous: hasDdl || hasMutation,
    };
  }

  assertExecutionAllowed(options: { sql: string; readonly: boolean; confirmDangerous: boolean }) {
    const analysis = this.analyze(options.sql);

    if (options.readonly && analysis.requiredPermission !== "execute_select_sql") {
      throw new ApiError(
        400,
        "READONLY_SQL_REJECTED",
        "読み取り専用モードの接続では変更系 SQL を実行できません。",
      );
    }

    if (analysis.dangerous && !options.confirmDangerous) {
      throw new ApiError(
        400,
        "DANGEROUS_SQL_CONFIRM_REQUIRED",
        "危険な SQL を実行するには confirmDangerous=true が必要です。",
        {
          statementTypes: analysis.statementTypes,
        },
      );
    }

    return analysis;
  }

  private detectStatementType(statement: string) {
    const normalized = this.stripLeadingComments(statement).toLowerCase();
    const tokens = this.collectKeywordTokens(normalized);
    const firstWord = tokens.find((token) => token.depth === 0)?.word ?? "unknown";

    if (firstWord === "with") {
      return this.detectWithStatementType(tokens);
    }
    if (
      selectKeywords.includes(firstWord) ||
      mutationKeywords.includes(firstWord) ||
      ddlKeywords.includes(firstWord) ||
      administrativeKeywords.includes(firstWord)
    ) {
      return firstWord;
    }

    return "unknown";
  }

  private detectWithStatementType(tokens: SqlKeywordToken[]) {
    const nestedMutation = tokens.find((token) => mutationKeywords.includes(token.word));
    if (nestedMutation) {
      return nestedMutation.word;
    }

    const nestedDdl = tokens.find(
      (token) => ddlKeywords.includes(token.word) || administrativeKeywords.includes(token.word),
    );
    if (nestedDdl) {
      return nestedDdl.word;
    }

    const topLevelSelect = tokens.find(
      (token) => token.depth === 0 && selectKeywords.includes(token.word),
    );
    if (topLevelSelect) {
      return topLevelSelect.word;
    }

    return "with";
  }

  private collectKeywordTokens(statement: string) {
    const tokens: SqlKeywordToken[] = [];
    let quote: "'" | '"' | "`" | null = null;
    let dollarQuote: string | null = null;
    let lineComment = false;
    let blockComment = false;
    let depth = 0;
    let index = 0;

    while (index < statement.length) {
      const char = statement[index] ?? "";
      const next = statement[index + 1] ?? "";

      if (lineComment) {
        if (char === "\n") {
          lineComment = false;
        }
        index++;
        continue;
      }

      if (blockComment) {
        if (char === "*" && next === "/") {
          blockComment = false;
          index += 2;
          continue;
        }
        index++;
        continue;
      }

      if (dollarQuote) {
        if (statement.startsWith(dollarQuote, index)) {
          index += dollarQuote.length;
          dollarQuote = null;
          continue;
        }
        index++;
        continue;
      }

      if (quote) {
        if (char === "\\" && next) {
          index += 2;
          continue;
        }
        if (char === quote) {
          if (next === quote) {
            index += 2;
            continue;
          }
          quote = null;
        }
        index++;
        continue;
      }

      if (char === "-" && next === "-") {
        lineComment = true;
        index += 2;
        continue;
      }

      if (char === "/" && next === "*") {
        blockComment = true;
        index += 2;
        continue;
      }

      if (char === "$") {
        const tag = statement.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)?.[0];
        if (tag) {
          dollarQuote = tag;
          index += tag.length;
          continue;
        }
      }

      if (char === "'" || char === '"' || char === "`") {
        quote = char;
        index++;
        continue;
      }

      if (char === "(") {
        depth++;
        index++;
        continue;
      }

      if (char === ")") {
        depth = Math.max(depth - 1, 0);
        index++;
        continue;
      }

      if (/[a-z_]/.test(char)) {
        const start = index;
        index++;
        while (index < statement.length && /[a-z0-9_]/.test(statement[index] ?? "")) {
          index++;
        }
        tokens.push({
          word: statement.slice(start, index),
          depth,
        });
        continue;
      }

      index++;
    }

    return tokens;
  }

  private stripLeadingComments(statement: string) {
    let normalized = statement.trim();

    while (normalized.length > 0) {
      if (normalized.startsWith("--")) {
        const newlineIndex = normalized.indexOf("\n");
        normalized = newlineIndex === -1 ? "" : normalized.slice(newlineIndex + 1).trimStart();
        continue;
      }

      if (normalized.startsWith("/*")) {
        const endIndex = normalized.indexOf("*/");
        normalized = endIndex === -1 ? "" : normalized.slice(endIndex + 2).trimStart();
        continue;
      }

      break;
    }

    return normalized.trim();
  }
}
