import { LogOut, MoonStar, RefreshCw, SunMedium } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { APP_NAME } from "@modern-db-admin/shared";

import { Button } from "@/components/ui/button";
import { formatApiError } from "@/lib/api";
import { useAuth } from "@/providers/auth-context";
import { resolveTheme, useThemeStore } from "@/stores/theme-store";

export function Topbar() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const auth = useAuth();
  const { mode, setMode } = useThemeStore();
  const currentTheme = resolveTheme(mode);

  return (
    <header className="app-topbar flex min-h-[58px] items-center justify-between gap-4 border-b border-[var(--border)] px-5 py-2.5">
      <span className="min-w-0 truncate text-2xl font-semibold tracking-[-0.055em] text-[var(--foreground)]">
        {APP_NAME}
      </span>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          className="rounded-xl px-2.5 py-2 text-[var(--muted-strong)] hover:text-[var(--foreground)]"
          variant="ghost"
          onClick={() => {
            void queryClient.invalidateQueries();
          }}
        >
          <RefreshCw className="mr-2 size-4" />
          更新
        </Button>
        <Button
          className="rounded-xl px-2.5 py-2 text-[var(--muted-strong)] hover:text-[var(--foreground)]"
          variant="ghost"
          onClick={() => setMode(currentTheme === "dark" ? "light" : "dark")}
        >
          {currentTheme === "dark" ? (
            <SunMedium className="mr-2 size-4" />
          ) : (
            <MoonStar className="mr-2 size-4" />
          )}
          {currentTheme === "dark" ? "Light" : "Dark"}
        </Button>
        <Button
          className="rounded-xl px-2.5 py-2 text-[var(--muted-strong)] hover:text-[var(--foreground)]"
          variant="ghost"
          onClick={() => {
            void auth
              .logout()
              .then(() => navigate("/login", { replace: true }))
              .catch((error) => {
                window.alert(formatApiError(error));
              });
          }}
        >
          <LogOut className="mr-2 size-4" />
          {auth.user?.username ?? "Logout"}
        </Button>
      </div>
    </header>
  );
}
