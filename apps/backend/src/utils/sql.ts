export function splitSqlStatements(sql: string) {
  const statements: string[] = [];
  let current = "";
  let quote: "'" | '"' | "`" | null = null;
  let dollarQuote: string | null = null;
  let lineComment = false;
  let blockComment = false;
  let index = 0;

  while (index < sql.length) {
    const char = sql[index] ?? "";
    const next = sql[index + 1] ?? "";

    if (lineComment) {
      current += char;
      if (char === "\n") {
        lineComment = false;
      }
      index++;
      continue;
    }

    if (blockComment) {
      if (char === "*" && next === "/") {
        current += "*/";
        blockComment = false;
        index += 2;
        continue;
      }
      current += char;
      index++;
      continue;
    }

    if (dollarQuote) {
      if (sql.startsWith(dollarQuote, index)) {
        current += dollarQuote;
        index += dollarQuote.length;
        dollarQuote = null;
        continue;
      }
      current += char;
      index++;
      continue;
    }

    if (quote) {
      current += char;
      if (char === "\\" && next) {
        current += next;
        index += 2;
        continue;
      }
      if (char === quote) {
        if (next === quote) {
          current += next;
          index += 2;
          continue;
        }
        quote = null;
      }
      index++;
      continue;
    }

    if (char === "-" && next === "-") {
      current += "--";
      lineComment = true;
      index += 2;
      continue;
    }

    if (char === "/" && next === "*") {
      current += "/*";
      blockComment = true;
      index += 2;
      continue;
    }

    if (char === "$") {
      const tag = sql.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)?.[0];
      if (tag) {
        current += tag;
        dollarQuote = tag;
        index += tag.length;
        continue;
      }
    }

    if (char === "'" || char === '"' || char === "`") {
      current += char;
      quote = char;
      index++;
      continue;
    }

    if (char === ";") {
      const statement = current.trim();
      if (statement) {
        statements.push(statement);
      }
      current = "";
      index++;
      continue;
    }

    current += char;
    index++;
  }

  const tail = current.trim();
  if (tail) {
    statements.push(tail);
  }

  return statements;
}
