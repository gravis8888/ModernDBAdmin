import { createContext, useContext } from "react";

import type { AuthLoginInput, AuthSetupInput, SessionUser } from "@modern-db-admin/shared";

export type AuthContextValue = {
  isReady: boolean;
  isLoading: boolean;
  setupCompleted: boolean | null;
  statusError: string | null;
  user: SessionUser | null;
  refresh: () => Promise<void>;
  login: (input: AuthLoginInput) => Promise<void>;
  setup: (input: AuthSetupInput) => Promise<void>;
  logout: () => Promise<void>;
};

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
