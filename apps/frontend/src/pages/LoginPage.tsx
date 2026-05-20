import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { APP_NAME } from "@modern-db-admin/shared";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";
import { formatApiError } from "@/lib/api";
import { useAuth } from "@/providers/auth-context";

export function LoginPage() {
  const navigate = useNavigate();
  const auth = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await auth.login({ identifier, password });
      toast.success("ログインしました。");
      navigate("/app/dashboard", { replace: true });
    } catch (error) {
      toast.error(formatApiError(error));
    }
  }

  return (
    <div className="app-shell-bg flex min-h-screen items-center justify-center px-4">
      <form className="app-panel w-full max-w-md rounded-3xl p-8" onSubmit={handleSubmit}>
        <p className="text-[11px] uppercase tracking-[0.28em] text-[var(--muted)]">ログイン</p>
        <h1 className="text-3xl font-semibold text-[var(--foreground)]">{APP_NAME}</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">ログインして管理画面を開きます。</p>
        <div className="mt-8 space-y-4">
          <Field label="ユーザー名またはメール">
            <TextInput
              autoComplete="username"
              onChange={(event) => setIdentifier(event.target.value)}
              placeholder="admin@example.com"
              value={identifier}
            />
          </Field>
          <Field label="パスワード">
            <TextInput
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              type="password"
              value={password}
            />
          </Field>
          <Button className="w-full" disabled={auth.isLoading} type="submit">
            {auth.isLoading ? "ログイン中..." : "ログイン"}
          </Button>
        </div>
      </form>
    </div>
  );
}
