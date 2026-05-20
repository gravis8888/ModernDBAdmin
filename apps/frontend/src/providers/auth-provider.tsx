import type { PropsWithChildren } from "react";
import { useEffect, useState } from "react";

import type { AuthLoginInput, AuthSetupInput, SessionUser } from "@modern-db-admin/shared";

import { ApiClientError, authApi, formatApiError } from "@/lib/api";
import { AuthContext } from "@/providers/auth-context";

export function AuthProvider({ children }: PropsWithChildren) {
  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [setupCompleted, setSetupCompleted] = useState<boolean | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);

  async function refresh() {
    setIsReady(false);
    setIsLoading(true);
    setStatusError(null);
    try {
      const status = await authApi.status();
      setSetupCompleted(status.setupCompleted);

      if (!status.setupCompleted) {
        setUser(null);
        return;
      }

      try {
        const me = await authApi.me();
        setUser(me.user);
      } catch (error) {
        if (error instanceof ApiClientError && error.status === 401) {
          setUser(null);
          return;
        }
        throw error;
      }
    } catch (error) {
      setStatusError(formatApiError(error));
    } finally {
      setIsReady(true);
      setIsLoading(false);
    }
  }

  async function login(input: AuthLoginInput) {
    setIsLoading(true);
    setStatusError(null);
    try {
      const response = await authApi.login(input);
      setSetupCompleted(true);
      setUser(response.user);
      setIsReady(true);
    } finally {
      setIsLoading(false);
    }
  }

  async function setup(input: AuthSetupInput) {
    setIsLoading(true);
    setStatusError(null);
    try {
      const response = await authApi.setup(input);
      setSetupCompleted(response.setupCompleted);
      setUser(response.user);
      setIsReady(true);
    } finally {
      setIsLoading(false);
    }
  }

  async function logout() {
    setIsLoading(true);
    setStatusError(null);
    try {
      await authApi.logout();
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh();
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <AuthContext.Provider
      value={{
        isReady,
        isLoading,
        setupCompleted,
        statusError,
        user,
        refresh,
        login,
        setup,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
