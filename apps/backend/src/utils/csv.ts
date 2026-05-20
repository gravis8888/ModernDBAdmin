import { ApiError } from "./api-error";

function normalizeCsvInput(content: string) {
  return content.replace(/^\uFEFF/, "");
}

export function parseCsvContent(content: string, delimiter: "," | ";" | "\t") {
  const input = normalizeCsvInput(content);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index] ?? "";
    const nextCharacter = input[index + 1] ?? "";

    if (character === '"') {
      if (inQuotes && nextCharacter === '"') {
        cell += '"';
        index += 1;
        continue;
      }

      inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && character === delimiter) {
      row.push(cell);
      cell = "";
      continue;
    }

    if (!inQuotes && (character === "\n" || character === "\r")) {
      if (character === "\r" && nextCharacter === "\n") {
        index += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += character;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  const normalizedRows = rows.filter(
    (currentRow) => currentRow.length > 1 || currentRow.some((value) => value.trim() !== ""),
  );

  if (normalizedRows.length === 0) {
    throw new ApiError(400, "CSV_EMPTY", "CSV にデータがありません。");
  }

  const headerRow = normalizedRows[0];
  const dataRows = normalizedRows.slice(1);
  if (!headerRow) {
    throw new ApiError(400, "CSV_EMPTY", "CSV にデータがありません。");
  }
  const headers = headerRow.map((value) => value.trim());
  if (headers.length === 0 || headers.some((header) => header.length === 0)) {
    throw new ApiError(400, "CSV_HEADER_INVALID", "CSV ヘッダーが不正です。");
  }

  const records = dataRows.map((currentRow, rowIndex) => {
    if (currentRow.length !== headers.length) {
      throw new ApiError(
        400,
        "CSV_COLUMN_MISMATCH",
        `CSV ${rowIndex + 2} 行目の列数がヘッダーと一致しません。`,
      );
    }

    return Object.fromEntries(
      headers.map((header, columnIndex) => [header, currentRow[columnIndex] ?? ""]),
    );
  });

  return {
    headers,
    records,
  };
}

function escapeCsvCell(value: unknown) {
  const normalized = value == null ? "" : String(value);
  if (/["\n\r,;\t]/.test(normalized)) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }
  return normalized;
}

export function serializeCsv(columns: string[], rows: Record<string, unknown>[]) {
  const header = columns.map((column) => escapeCsvCell(column)).join(",");
  const body = rows.map((row) => columns.map((column) => escapeCsvCell(row[column])).join(","));
  return [header, ...body].join("\n");
}
