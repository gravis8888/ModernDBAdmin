import { create } from "zustand";
import { persist } from "zustand/middleware";

type QueryRuntimeState = {
  rowCount?: number;
  executionTimeMs?: number;
  statementTypes?: string[];
  updatedAt?: string;
};

type RuntimeState = {
  lastQuery: QueryRuntimeState | null;
  sqlHistory: string[];
  setLastQuery: (lastQuery: QueryRuntimeState | null) => void;
  pushSqlHistory: (sql: string) => void;
  clearSqlHistory: () => void;
};

export const useRuntimeStore = create<RuntimeState>()(
  persist(
    (set, get) => ({
      lastQuery: null,
      sqlHistory: [],
      setLastQuery: (lastQuery) => set({ lastQuery }),
      pushSqlHistory: (sql) => {
        const normalized = sql.trim();
        if (!normalized) {
          return;
        }

        const next = [normalized, ...get().sqlHistory.filter((item) => item !== normalized)].slice(
          0,
          12,
        );
        set({ sqlHistory: next });
      },
      clearSqlHistory: () => set({ sqlHistory: [] }),
    }),
    {
      name: "modern-db-admin-runtime",
      partialize: (state) => ({
        sqlHistory: state.sqlHistory,
      }),
    },
  ),
);
