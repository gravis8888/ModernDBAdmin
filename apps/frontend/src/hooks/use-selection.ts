import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";

export type AppSelection = {
  connectionId?: string;
  database?: string;
  schema?: string;
  table?: string;
};

type SetSelectionOptions = {
  replace?: boolean;
};

const selectionKeys = ["connectionId", "database", "schema", "table"] as const;

export function buildSelectionSearch(selection: AppSelection) {
  const params = new URLSearchParams();

  for (const key of selectionKeys) {
    const value = selection[key];
    if (value) {
      params.set(key, value);
    }
  }

  const query = params.toString();
  return query ? `?${query}` : "";
}

export function useSelection() {
  const [searchParams, setSearchParams] = useSearchParams();

  const selection = useMemo<AppSelection>(
    () => ({
      connectionId: searchParams.get("connectionId") ?? undefined,
      database: searchParams.get("database") ?? undefined,
      schema: searchParams.get("schema") ?? undefined,
      table: searchParams.get("table") ?? undefined,
    }),
    [searchParams],
  );

  function setSelection(next: Partial<AppSelection>, options?: SetSelectionOptions) {
    const params = new URLSearchParams(searchParams);

    for (const key of selectionKeys) {
      const value = next[key];
      if (value === undefined) {
        continue;
      }

      if (value === "") {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }

    setSearchParams(params, { replace: options?.replace });
  }

  function buildHref(pathname: string, next: AppSelection) {
    return `${pathname}${buildSelectionSearch(next)}`;
  }

  return {
    selection,
    setSelection,
    buildHref,
  };
}
