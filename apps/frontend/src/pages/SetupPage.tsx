import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { APP_NAME } from "@modern-db-admin/shared";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";
import { ApiClientError, formatApiError } from "@/lib/api";
import { useAuth } from "@/providers/auth-context";

export function SetupPage() {
  const navigate = useNavigate();
  const auth = useAuth();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (password !== passwordConfirm) {
      toast.error("パスワード確認が一致しません。");
      return;
    }

    try {
      await auth.setup({ username, email, password });
      toast.success("初期管理者を作成しました。");
      navigate("/app/dashboard", { replace: true });
    } catch (error) {
      if (error instanceof ApiClientError && error.code === "SETUP_ALREADY_COMPLETED") {
        await auth.refresh();
        toast.error("初期セットアップはすでに完了しています。ログインしてください。");
        navigate("/login", { replace: true });
        return;
      }
      toast.error(formatApiError(error));
    }
  }

  return (
    <div className="app-shell-bg flex min-h-screen items-center justify-center px-4 py-8">
      <form
        className="app-panel mx-auto w-full max-w-3xl rounded-[28px] p-8"
        onSubmit={handleSubmit}
      >
        <p className="text-[11px] uppercase tracking-[0.28em] text-[var(--muted)]">初期設定</p>
        <h1 className="mt-1 text-3xl font-semibold">{APP_NAME}</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">最初に使う管理者アカウントを作成します。</p>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <Field label="管理者ユーザー名">
            <TextInput
              onChange={(event) => setUsername(event.target.value)}
              placeholder="admin"
              value={username}
            />
          </Field>
          <Field label="メールアドレス">
            <TextInput
              onChange={(event) => setEmail(event.target.value)}
              placeholder="admin@example.com"
              type="email"
              value={email}
            />
          </Field>
          <Field label="パスワード">
            <TextInput
              onChange={(event) => setPassword(event.target.value)}
              placeholder="8文字以上"
              type="password"
              value={password}
            />
          </Field>
          <Field label="パスワード確認">
            <TextInput
              onChange={(event) => setPasswordConfirm(event.target.value)}
              placeholder="もう一度入力"
              type="password"
              value={passwordConfirm}
            />
          </Field>
        </div>
        <div className="mt-6">
          <Button disabled={auth.isLoading} type="submit">
            {auth.isLoading ? "作成中..." : "初期管理者を作成"}
          </Button>
        </div>
      </form>
    </div>
  );
}
