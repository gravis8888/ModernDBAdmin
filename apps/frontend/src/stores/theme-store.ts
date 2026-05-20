import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { ThemeMode } from "@modern-db-admin/shared";

type ThemeState = {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
};

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      mode: "dark",
      setMode: (mode) => set({ mode }),
    }),
    {
      name: "modern-db-admin-theme",
    },
  ),
);

export function resolveTheme(mode: ThemeMode) {
  if (mode === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  return mode;
}
