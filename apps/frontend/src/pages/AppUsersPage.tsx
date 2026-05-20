import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Database, Shield, UserPlus } from "lucide-react";
import type { AppPermission } from "@modern-db-admin/shared";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckboxField, Field, TextArea, TextInput } from "@/components/ui/field";
import { appRolesApi, appUsersApi, formatApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDateTime, humanizePermission } from "@/lib/format";

type UserFormState = {
  username: string;
  email: string;
  password: string;
  roleIds: string[];
  enabled: boolean;
};

type RoleFormState = {
  name: string;
  description: string;
  permissionKeys: AppPermission[];
};

const emptyUserForm: UserFormState = {
  username: "",
  email: "",
  password: "",
  roleIds: [],
  enabled: true,
};

const emptyRoleForm: RoleFormState = {
  name: "",
  description: "",
  permissionKeys: [],
};

const VISIBLE_PERMISSION_BADGES = 6;

export function AppUsersPage() {
  const queryClient = useQueryClient();
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [userForm, setUserForm] = useState<UserFormState>(emptyUserForm);
  const [roleForm, setRoleForm] = useState<RoleFormState>(emptyRoleForm);

  const usersQuery = useQuery({
    queryKey: ["app-users"],
    queryFn: appUsersApi.list,
  });
  const rolesQuery = useQuery({
    queryKey: ["app-roles"],
    queryFn: appRolesApi.list,
  });

  const users = usersQuery.data?.users ?? [];
  const roles = rolesQuery.data?.roles ?? [];
  const permissionCatalog = rolesQuery.data?.permissions ?? [];

  const saveUserMutation = useMutation({
    mutationFn: async () =>
      selectedUserId
        ? appUsersApi.update(selectedUserId, {
            username: userForm.username,
            email: userForm.email,
            password: userForm.password || undefined,
            roleIds: userForm.roleIds,
            enabled: userForm.enabled,
          })
        : appUsersApi.create(userForm),
    onSuccess: () => {
      toast.success(selectedUserId ? "ユーザーを更新しました。" : "ユーザーを作成しました。");
      setSelectedUserId(null);
      setUserForm(emptyUserForm);
      void queryClient.invalidateQueries({ queryKey: ["app-users"] });
    },
    onError: (error) => {
      toast.error(formatApiError(error));
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: (userId: string) => appUsersApi.remove(userId),
    onSuccess: () => {
      toast.success("ユーザーを削除しました。");
      setSelectedUserId(null);
      setUserForm(emptyUserForm);
      void queryClient.invalidateQueries({ queryKey: ["app-users"] });
    },
    onError: (error) => {
      toast.error(formatApiError(error));
    },
  });

  const saveRoleMutation = useMutation({
    mutationFn: async () =>
      selectedRoleId ? appRolesApi.update(selectedRoleId, roleForm) : appRolesApi.create(roleForm),
    onSuccess: () => {
      toast.success(selectedRoleId ? "ロールを更新しました。" : "ロールを作成しました。");
      setSelectedRoleId(null);
      setRoleForm(emptyRoleForm);
      void queryClient.invalidateQueries({ queryKey: ["app-roles"] });
      void queryClient.invalidateQueries({ queryKey: ["app-users"] });
    },
    onError: (error) => {
      toast.error(formatApiError(error));
    },
  });

  const deleteRoleMutation = useMutation({
    mutationFn: (roleId: string) => appRolesApi.remove(roleId),
    onSuccess: () => {
      toast.success("ロールを削除しました。");
      setSelectedRoleId(null);
      setRoleForm(emptyRoleForm);
      void queryClient.invalidateQueries({ queryKey: ["app-roles"] });
      void queryClient.invalidateQueries({ queryKey: ["app-users"] });
    },
    onError: (error) => {
      toast.error(formatApiError(error));
    },
  });

  const permissionsByCategory = permissionCatalog.reduce<
    Record<string, Array<(typeof permissionCatalog)[number]>>
  >((accumulator, permission) => {
    const current = accumulator[permission.category] ?? [];
    current.push(permission);
    accumulator[permission.category] = current;
    return accumulator;
  }, {});

  return (
    <div className="space-y-5">
      <section className="app-panel rounded-[28px] p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--accent)]">
              Internal Access Control
            </p>
            <h2 className="mt-2 text-lg font-semibold">
              この画面は Modern DB Admin へのログイン権限用です。
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-[var(--muted)]">
              MySQL / PostgreSQL の実ユーザーや role、その GRANT / REVOKE はここではなく
              接続一覧・接続ツリー・テーブル画面から対象接続の権限画面を開いて操作します。
            </p>
          </div>
          <Link to="/app/connections">
            <Button variant="secondary">
              <Database className="mr-2 size-4" />
              接続一覧を開く
            </Button>
          </Link>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
        <section className="app-panel rounded-[28px] p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">管理画面ユーザー</h3>
            <Button
              onClick={() => {
                setSelectedUserId(null);
                setUserForm(emptyUserForm);
              }}
              variant="secondary"
            >
              <UserPlus className="mr-2 size-4" />
              新規ユーザー
            </Button>
          </div>
          <div className="mt-4 grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
            <div className="space-y-3">
              {users.map((user) => (
                <button
                  className={cn(
                    "block w-full rounded-2xl border border-[var(--border)] bg-[var(--panel)] px-4 py-3 text-left transition hover:border-[var(--accent)]",
                    selectedUserId === user.id &&
                      "border-[var(--accent)] shadow-[0_12px_30px_var(--shadow-color)]",
                  )}
                  key={user.id}
                  onClick={() => {
                    setSelectedUserId(user.id);
                    setUserForm({
                      username: user.username,
                      email: user.email,
                      password: "",
                      roleIds: user.roleIds,
                      enabled: user.enabled,
                    });
                  }}
                  type="button"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium">{user.username}</p>
                    <Badge tone={user.enabled ? "success" : "outline"}>
                      {user.enabled ? "enabled" : "disabled"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-[var(--muted)]">{user.email}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {user.roles.map((role) => (
                      <Badge key={role.id} tone="outline">
                        {role.name}
                      </Badge>
                    ))}
                  </div>
                  <p className="mt-3 text-xs text-[var(--muted)]">
                    最終ログイン: {formatDateTime(user.lastLoginAt)}
                  </p>
                </button>
              ))}
            </div>
            <form
              className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4"
              onSubmit={(event) => {
                event.preventDefault();
                void saveUserMutation.mutateAsync();
              }}
            >
              <div className="flex items-center justify-between">
                <p className="font-medium">
                  {selectedUserId ? "ユーザーを編集" : "ユーザーを作成"}
                </p>
                {selectedUserId ? (
                  <Button
                    onClick={() => {
                      setSelectedUserId(null);
                      setUserForm(emptyUserForm);
                    }}
                    variant="secondary"
                  >
                    新規に戻す
                  </Button>
                ) : null}
              </div>
              <Field label="ユーザー名">
                <TextInput
                  onChange={(event) =>
                    setUserForm((current) => ({ ...current, username: event.target.value }))
                  }
                  value={userForm.username}
                />
              </Field>
              <Field label="メールアドレス">
                <TextInput
                  onChange={(event) =>
                    setUserForm((current) => ({ ...current, email: event.target.value }))
                  }
                  type="email"
                  value={userForm.email}
                />
              </Field>
              <Field
                hint={selectedUserId ? "変更する場合のみ入力します。" : "8文字以上"}
                label="パスワード"
              >
                <TextInput
                  onChange={(event) =>
                    setUserForm((current) => ({ ...current, password: event.target.value }))
                  }
                  type="password"
                  value={userForm.password}
                />
              </Field>
              <div className="space-y-2">
                <p className="text-sm font-medium">ロール</p>
                <div className="grid gap-2">
                  {roles.map((role) => (
                    <CheckboxField
                      checked={userForm.roleIds.includes(role.id)}
                      hint={role.description}
                      key={role.id}
                      label={role.name}
                      onChange={(event) =>
                        setUserForm((current) => ({
                          ...current,
                          roleIds: event.target.checked
                            ? [...current.roleIds, role.id]
                            : current.roleIds.filter((roleId) => roleId !== role.id),
                        }))
                      }
                    />
                  ))}
                </div>
              </div>
              <CheckboxField
                checked={userForm.enabled}
                label="このユーザーを有効にする"
                onChange={(event) =>
                  setUserForm((current) => ({ ...current, enabled: event.target.checked }))
                }
              />
              <div className="flex flex-wrap gap-2">
                <Button disabled={saveUserMutation.isPending} type="submit">
                  {selectedUserId ? "ユーザーを更新" : "ユーザーを作成"}
                </Button>
                {selectedUserId ? (
                  <Button
                    onClick={() => {
                      if (!window.confirm("このユーザーを削除しますか。")) {
                        return;
                      }
                      void deleteUserMutation.mutateAsync(selectedUserId);
                    }}
                    type="button"
                    variant="danger"
                  >
                    削除
                  </Button>
                ) : null}
              </div>
            </form>
          </div>
        </section>
        <section className="app-panel rounded-[28px] p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">管理画面ロールと権限</h3>
            <Button
              onClick={() => {
                setSelectedRoleId(null);
                setRoleForm(emptyRoleForm);
              }}
              variant="secondary"
            >
              <Shield className="mr-2 size-4" />
              新規ロール
            </Button>
          </div>
          <div className="mt-4 grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
            <div className="space-y-4">
              {roles.map((role) => (
                <article
                  className={cn(
                    "rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4 transition",
                    selectedRoleId === role.id &&
                      "border-[var(--accent)] shadow-[0_12px_30px_var(--shadow-color)]",
                  )}
                  key={role.name}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">{role.name}</p>
                      <p className="text-sm text-[var(--muted)]">{role.description}</p>
                    </div>
                    <Button
                      onClick={() => {
                        setSelectedRoleId(role.id);
                        setRoleForm({
                          name: role.name,
                          description: role.description,
                          permissionKeys: role.permissionKeys,
                        });
                      }}
                      variant="secondary"
                    >
                      編集
                    </Button>
                  </div>
                  <div className="mt-4 border-t border-[var(--border)] pt-3">
                    <div className="flex flex-wrap gap-2">
                      {role.permissionKeys.slice(0, VISIBLE_PERMISSION_BADGES).map((permission) => (
                        <Badge key={permission} tone="outline">
                          {humanizePermission(permission)}
                        </Badge>
                      ))}
                      {role.permissionKeys.length > VISIBLE_PERMISSION_BADGES ? (
                        <Badge tone="muted">
                          他 {role.permissionKeys.length - VISIBLE_PERMISSION_BADGES} 件
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2 text-xs text-[var(--muted)]">
                    {role.isSystem ? <Badge tone="outline">system</Badge> : null}
                    <span>updated {formatDateTime(role.updatedAt)}</span>
                  </div>
                </article>
              ))}
            </div>
            <form
              className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4"
              onSubmit={(event) => {
                event.preventDefault();
                void saveRoleMutation.mutateAsync();
              }}
            >
              <div className="flex items-center justify-between">
                <p className="font-medium">{selectedRoleId ? "ロールを編集" : "ロールを作成"}</p>
                {selectedRoleId ? (
                  <Button
                    onClick={() => {
                      setSelectedRoleId(null);
                      setRoleForm(emptyRoleForm);
                    }}
                    variant="secondary"
                  >
                    新規に戻す
                  </Button>
                ) : null}
              </div>
              <Field label="ロール名">
                <TextInput
                  onChange={(event) =>
                    setRoleForm((current) => ({ ...current, name: event.target.value }))
                  }
                  value={roleForm.name}
                />
              </Field>
              <Field label="説明">
                <TextArea
                  onChange={(event) =>
                    setRoleForm((current) => ({ ...current, description: event.target.value }))
                  }
                  value={roleForm.description}
                />
              </Field>
              <div className="space-y-3">
                <p className="text-sm font-medium">権限</p>
                {Object.entries(permissionsByCategory).map(([category, permissions]) => (
                  <section
                    className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-3"
                    key={category}
                  >
                    <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
                      {category}
                    </p>
                    <div className="mt-3 grid gap-2">
                      {permissions.map((permission) => (
                        <CheckboxField
                          checked={roleForm.permissionKeys.includes(permission.key)}
                          key={permission.id}
                          label={humanizePermission(permission.key)}
                          onChange={(event) =>
                            setRoleForm((current) => ({
                              ...current,
                              permissionKeys: event.target.checked
                                ? [...current.permissionKeys, permission.key]
                                : current.permissionKeys.filter((key) => key !== permission.key),
                            }))
                          }
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button disabled={saveRoleMutation.isPending} type="submit">
                  {selectedRoleId ? "ロールを更新" : "ロールを作成"}
                </Button>
                {selectedRoleId ? (
                  <Button
                    disabled={roles.find((role) => role.id === selectedRoleId)?.isSystem}
                    onClick={() => {
                      const selectedRole = roles.find((role) => role.id === selectedRoleId);
                      if (
                        !selectedRole ||
                        !window.confirm(`ロール ${selectedRole.name} を削除しますか。`)
                      ) {
                        return;
                      }
                      void deleteRoleMutation.mutateAsync(selectedRoleId);
                    }}
                    type="button"
                    variant="danger"
                  >
                    削除
                  </Button>
                ) : null}
              </div>
            </form>
          </div>
        </section>
      </div>
    </div>
  );
}
