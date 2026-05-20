import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  KeyRound,
  LockKeyhole,
  Search,
  ShieldAlert,
  ShieldCheck,
  UserRoundCog,
  Users2,
} from "lucide-react";
import type {
  DatabaseDialect,
  DatabasePrivilege,
  DatabasePrivilegeMutationInput,
  DatabaseUser,
  DatabaseUserCreateInput,
  DatabaseUserUpdateInput,
} from "@modern-db-admin/shared";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckboxField, Field, SelectInput, TextInput } from "@/components/ui/field";
import { useSelection } from "@/hooks/use-selection";
import { connectionsApi, dbUsersApi, formatApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { dialectLabel } from "@/lib/format";

type DbUserFormState = {
  username: string;
  host: string;
  password: string;
  canLogin: boolean;
  isSuperuser: boolean;
  canCreateDatabase: boolean;
  canCreateUser: boolean;
  canReplication: boolean;
  canBypassRls: boolean;
};

type PrivilegeFormState = {
  objectType: DatabasePrivilegeMutationInput["objectType"];
  database: string;
  schema: string;
  table: string;
  sequence: string;
  selectedPrivileges: string[];
  sourceRole: string;
  confirmDangerous: boolean;
  action: "grant" | "revoke";
};

type PrivilegeObjectType = PrivilegeFormState["objectType"];

type PrivilegeCatalogOption = {
  value: string;
  label: string;
  hint: string;
  dangerous?: boolean;
};

type PrivilegeCatalogCategory = {
  key: string;
  label: string;
  description: string;
  options: PrivilegeCatalogOption[];
};

type DbRoleAttributeKey =
  | "isSuperuser"
  | "canCreateDatabase"
  | "canCreateUser"
  | "canReplication"
  | "canBypassRls";

type DbRoleAttributeOption = {
  key: DbRoleAttributeKey;
  label: string;
  hint: string;
  dangerous?: boolean;
};

type DbUserEditorState = {
  connectionId: string | null;
  selectedDbUserId: string | null;
  form: DbUserFormState;
};

const emptyDbUserForm: DbUserFormState = {
  username: "",
  host: "%",
  password: "",
  canLogin: true,
  isSuperuser: false,
  canCreateDatabase: false,
  canCreateUser: false,
  canReplication: false,
  canBypassRls: false,
};

const emptyPrivilegeForm: PrivilegeFormState = {
  objectType: "table",
  database: "",
  schema: "public",
  table: "",
  sequence: "",
  selectedPrivileges: ["SELECT"],
  sourceRole: "",
  confirmDangerous: false,
  action: "grant",
};

const emptyDbUserEditorState: DbUserEditorState = {
  connectionId: null,
  selectedDbUserId: null,
  form: emptyDbUserForm,
};

const postgresqlRoleAttributeOptions: DbRoleAttributeOption[] = [
  {
    key: "isSuperuser",
    label: "SUPERUSER",
    hint: "サーバ全体に対する最上位権限です。",
    dangerous: true,
  },
  {
    key: "canCreateDatabase",
    label: "CREATEDB",
    hint: "新しい database を作成できます。",
    dangerous: true,
  },
  {
    key: "canCreateUser",
    label: "CREATEROLE",
    hint: "他の role を作成・変更できます。",
    dangerous: true,
  },
  {
    key: "canReplication",
    label: "REPLICATION",
    hint: "replication 関連の接続と操作を許可します。",
    dangerous: true,
  },
  {
    key: "canBypassRls",
    label: "BYPASSRLS",
    hint: "Row Level Security を迂回できます。",
    dangerous: true,
  },
];

function createPrivilegeOption(
  value: string,
  label: string,
  hint: string,
  dangerous = false,
): PrivilegeCatalogOption {
  return { value, label, hint, dangerous };
}

function buildPostgresqlRoleAttributes(
  form: DbUserFormState,
): Pick<
  DatabaseUserCreateInput,
  "isSuperuser" | "canCreateDatabase" | "canCreateUser" | "canReplication" | "canBypassRls"
> {
  return {
    isSuperuser: form.isSuperuser,
    canCreateDatabase: form.canCreateDatabase,
    canCreateUser: form.canCreateUser,
    canReplication: form.canReplication,
    canBypassRls: form.canBypassRls,
  };
}

function getDbUserFormFromUser(user: DatabaseUser): DbUserFormState {
  return {
    username: user.username,
    host: user.host ?? "%",
    password: "",
    canLogin: user.canLogin ?? true,
    isSuperuser: Boolean(user.isSuperuser),
    canCreateDatabase: Boolean(user.canCreateDatabase),
    canCreateUser: Boolean(user.canCreateUser),
    canReplication: Boolean(user.canReplication),
    canBypassRls: Boolean(user.canBypassRls),
  };
}

function privilegeOptionsForDialect(
  dialect: DatabaseDialect | undefined,
): Array<{ value: PrivilegeObjectType; label: string }> {
  if (dialect === "postgresql") {
    return [
      { value: "database", label: "データベース" },
      { value: "schema", label: "スキーマ" },
      { value: "table", label: "テーブル" },
      { value: "sequence", label: "シーケンス" },
      { value: "role_membership", label: "ロール継承" },
    ];
  }

  return [
    { value: "global", label: "サーバ全体" },
    { value: "database", label: "データベース" },
    { value: "table", label: "テーブル" },
  ];
}

function getPrivilegeCategories(
  dialect: DatabaseDialect | undefined,
  objectType: PrivilegeObjectType,
): PrivilegeCatalogCategory[] {
  if (objectType === "role_membership") {
    return [];
  }

  if (dialect === "postgresql") {
    if (objectType === "database") {
      return [
        {
          key: "access",
          label: "接続・利用",
          description: "database へ接続したり一時テーブルを使う権限です。",
          options: [
            createPrivilegeOption("CONNECT", "CONNECT", "database に接続する"),
            createPrivilegeOption("TEMPORARY", "TEMPORARY", "一時テーブルを作成する"),
          ],
        },
        {
          key: "structure",
          label: "構造変更",
          description: "database 配下に新しい schema を作る権限です。",
          options: [createPrivilegeOption("CREATE", "CREATE", "database 内に schema を作成する")],
        },
      ];
    }

    if (objectType === "schema") {
      return [
        {
          key: "usage",
          label: "利用",
          description: "schema の中身を参照したり使うための権限です。",
          options: [createPrivilegeOption("USAGE", "USAGE", "schema を利用する")],
        },
        {
          key: "structure",
          label: "構造変更",
          description: "schema 配下に新規オブジェクトを作る権限です。",
          options: [createPrivilegeOption("CREATE", "CREATE", "schema に table などを作成する")],
        },
      ];
    }

    if (objectType === "sequence") {
      return [
        {
          key: "basic",
          label: "基本",
          description: "sequence の参照や採番に関する権限です。",
          options: [
            createPrivilegeOption("USAGE", "USAGE", "nextval / currval などを利用する"),
            createPrivilegeOption("SELECT", "SELECT", "sequence の現在値を参照する"),
            createPrivilegeOption("UPDATE", "UPDATE", "setval などで sequence を更新する"),
          ],
        },
      ];
    }

    return [
      {
        key: "read",
        label: "読み取り",
        description: "table の内容を参照する権限です。",
        options: [createPrivilegeOption("SELECT", "SELECT", "table の行を参照する")],
      },
      {
        key: "write",
        label: "書き込み",
        description: "table のデータを更新する権限です。",
        options: [
          createPrivilegeOption("INSERT", "INSERT", "新しい行を追加する"),
          createPrivilegeOption("UPDATE", "UPDATE", "既存行を更新する"),
          createPrivilegeOption("DELETE", "DELETE", "行を削除する"),
          createPrivilegeOption("TRUNCATE", "TRUNCATE", "table 全体を高速に空にする", true),
        ],
      },
      {
        key: "relational",
        label: "関連制御",
        description: "参照整合性や trigger に関する権限です。",
        options: [
          createPrivilegeOption("REFERENCES", "REFERENCES", "外部キー参照に使う"),
          createPrivilegeOption("TRIGGER", "TRIGGER", "trigger を作成・実行する"),
        ],
      },
    ];
  }

  if (objectType === "global") {
    return [
      {
        key: "data",
        label: "データ操作",
        description: "全 database に対する基本的な CRUD 権限です。",
        options: [
          createPrivilegeOption("SELECT", "SELECT", "全 database のデータを参照する"),
          createPrivilegeOption("INSERT", "INSERT", "全 database に行を追加する"),
          createPrivilegeOption("UPDATE", "UPDATE", "全 database の行を更新する"),
          createPrivilegeOption("DELETE", "DELETE", "全 database の行を削除する"),
        ],
      },
      {
        key: "structure",
        label: "構造変更",
        description: "database や table の構造を変更する権限です。",
        options: [
          createPrivilegeOption("CREATE", "CREATE", "object を新規作成する"),
          createPrivilegeOption("ALTER", "ALTER", "object 定義を変更する"),
          createPrivilegeOption("DROP", "DROP", "object を削除する", true),
          createPrivilegeOption("INDEX", "INDEX", "index を作成・削除する"),
          createPrivilegeOption("REFERENCES", "REFERENCES", "外部キー参照に使う"),
          createPrivilegeOption(
            "CREATE TABLESPACE",
            "CREATE TABLESPACE",
            "tablespace を作成・変更する",
            true,
          ),
        ],
      },
      {
        key: "programming",
        label: "ビュー・ルーチン",
        description: "view / routine / trigger / event まわりの権限です。",
        options: [
          createPrivilegeOption("CREATE VIEW", "CREATE VIEW", "view を作成する"),
          createPrivilegeOption("SHOW VIEW", "SHOW VIEW", "view 定義を表示する"),
          createPrivilegeOption(
            "CREATE ROUTINE",
            "CREATE ROUTINE",
            "procedure / function を作成する",
          ),
          createPrivilegeOption("ALTER ROUTINE", "ALTER ROUTINE", "routine 定義を変更する"),
          createPrivilegeOption("EXECUTE", "EXECUTE", "routine を実行する"),
          createPrivilegeOption("EVENT", "EVENT", "event scheduler を操作する"),
          createPrivilegeOption("TRIGGER", "TRIGGER", "trigger を作成する"),
        ],
      },
      {
        key: "operations",
        label: "運用補助",
        description: "一時テーブルや table lock などの運用系権限です。",
        options: [
          createPrivilegeOption(
            "CREATE TEMPORARY TABLES",
            "CREATE TEMPORARY TABLES",
            "一時テーブルを作成する",
          ),
          createPrivilegeOption("LOCK TABLES", "LOCK TABLES", "table lock を取得する"),
        ],
      },
      {
        key: "dangerous",
        label: "危険な権限",
        description: "サーバ全体に強い影響を与えるため要注意です。",
        options: [
          createPrivilegeOption(
            "GRANT OPTION",
            "GRANT OPTION",
            "他ユーザーへ権限を再付与できる",
            true,
          ),
          createPrivilegeOption("CREATE USER", "CREATE USER", "DB ユーザーを作成できる", true),
          createPrivilegeOption("PROCESS", "PROCESS", "実行中 process を閲覧できる", true),
          createPrivilegeOption("FILE", "FILE", "サーバ上の file 読み書きに関与できる", true),
          createPrivilegeOption("RELOAD", "RELOAD", "flush 系操作を実行できる", true),
          createPrivilegeOption(
            "SHOW DATABASES",
            "SHOW DATABASES",
            "全 database を列挙できる",
            true,
          ),
          createPrivilegeOption(
            "REPLICATION CLIENT",
            "REPLICATION CLIENT",
            "replication 状態を閲覧できる",
            true,
          ),
          createPrivilegeOption(
            "REPLICATION SLAVE",
            "REPLICATION SLAVE",
            "replication を受ける権限",
            true,
          ),
          createPrivilegeOption("SHUTDOWN", "SHUTDOWN", "server shutdown を実行できる", true),
          createPrivilegeOption("SUPER", "SUPER", "server 全体の強い管理権限", true),
        ],
      },
    ];
  }

  if (objectType === "database") {
    return [
      {
        key: "data",
        label: "データ操作",
        description: "database 全体に対する基本的な CRUD 権限です。",
        options: [
          createPrivilegeOption("SELECT", "SELECT", "database 内のデータを参照する"),
          createPrivilegeOption("INSERT", "INSERT", "database 内に行を追加する"),
          createPrivilegeOption("UPDATE", "UPDATE", "database 内の行を更新する"),
          createPrivilegeOption("DELETE", "DELETE", "database 内の行を削除する"),
        ],
      },
      {
        key: "structure",
        label: "構造変更",
        description: "database 配下の object を作成・変更する権限です。",
        options: [
          createPrivilegeOption("CREATE", "CREATE", "table などを新規作成する"),
          createPrivilegeOption("ALTER", "ALTER", "object 定義を変更する"),
          createPrivilegeOption("DROP", "DROP", "object を削除する", true),
          createPrivilegeOption("INDEX", "INDEX", "index を作成・削除する"),
          createPrivilegeOption("REFERENCES", "REFERENCES", "外部キー参照に使う"),
        ],
      },
      {
        key: "programming",
        label: "ビュー・ルーチン",
        description: "view / routine / trigger / event まわりの権限です。",
        options: [
          createPrivilegeOption("CREATE VIEW", "CREATE VIEW", "view を作成する"),
          createPrivilegeOption("SHOW VIEW", "SHOW VIEW", "view 定義を表示する"),
          createPrivilegeOption(
            "CREATE ROUTINE",
            "CREATE ROUTINE",
            "procedure / function を作成する",
          ),
          createPrivilegeOption("ALTER ROUTINE", "ALTER ROUTINE", "routine 定義を変更する"),
          createPrivilegeOption("EXECUTE", "EXECUTE", "routine を実行する"),
          createPrivilegeOption("EVENT", "EVENT", "event scheduler を操作する"),
          createPrivilegeOption("TRIGGER", "TRIGGER", "trigger を作成する"),
        ],
      },
      {
        key: "operations",
        label: "運用補助",
        description: "一時テーブルや table lock を扱う権限です。",
        options: [
          createPrivilegeOption(
            "CREATE TEMPORARY TABLES",
            "CREATE TEMPORARY TABLES",
            "一時テーブルを作成する",
          ),
          createPrivilegeOption("LOCK TABLES", "LOCK TABLES", "table lock を取得する"),
          createPrivilegeOption(
            "GRANT OPTION",
            "GRANT OPTION",
            "この database の権限を他ユーザーへ再付与できる",
            true,
          ),
        ],
      },
    ];
  }

  return [
    {
      key: "data",
      label: "データ操作",
      description: "table 単位の基本的な CRUD 権限です。",
      options: [
        createPrivilegeOption("SELECT", "SELECT", "table の行を参照する"),
        createPrivilegeOption("INSERT", "INSERT", "新しい行を追加する"),
        createPrivilegeOption("UPDATE", "UPDATE", "既存行を更新する"),
        createPrivilegeOption("DELETE", "DELETE", "行を削除する"),
      ],
    },
    {
      key: "structure",
      label: "構造変更",
      description: "table 定義や index に関する権限です。",
      options: [
        createPrivilegeOption("ALTER", "ALTER", "table 定義を変更する"),
        createPrivilegeOption("DROP", "DROP", "table を削除する", true),
        createPrivilegeOption("INDEX", "INDEX", "index を作成・削除する"),
        createPrivilegeOption("REFERENCES", "REFERENCES", "外部キー参照に使う"),
      ],
    },
    {
      key: "automation",
      label: "自動化",
      description: "trigger などの自動処理に関する権限です。",
      options: [
        createPrivilegeOption("CREATE VIEW", "CREATE VIEW", "この table を使う view を作成する"),
        createPrivilegeOption("SHOW VIEW", "SHOW VIEW", "関連 view 定義を表示する"),
        createPrivilegeOption("TRIGGER", "TRIGGER", "trigger を作成する"),
        createPrivilegeOption(
          "GRANT OPTION",
          "GRANT OPTION",
          "この table の権限を他ユーザーへ再付与できる",
          true,
        ),
      ],
    },
  ];
}

function getDefaultPrivileges(
  dialect: DatabaseDialect | undefined,
  objectType: PrivilegeObjectType,
) {
  if (objectType === "role_membership") {
    return [];
  }
  if (dialect === "postgresql") {
    if (objectType === "database") {
      return ["CONNECT"];
    }
    if (objectType === "schema") {
      return ["USAGE"];
    }
    if (objectType === "sequence") {
      return ["USAGE"];
    }
    return ["SELECT"];
  }
  return ["SELECT"];
}

function normalizePrivileges(values: string[]) {
  return [...new Set(values)];
}

function isDangerousPrivilege(privilege: string) {
  return /grant option|superuser|createdb|createrole|replication|bypassrls|file|process|reload|shutdown|super|create user/i.test(
    privilege,
  );
}

function describePrivilege(privilege: DatabasePrivilege) {
  const suffix = privilege.grantable ? " (grantable)" : "";

  if (privilege.objectType === "role_membership") {
    return `member of ${privilege.note ?? privilege.privilege}${suffix}`;
  }
  if (privilege.objectType === "global") {
    return `${privilege.privilege} on *.*${suffix}`;
  }
  if (privilege.objectType === "database") {
    return `${privilege.privilege} on database ${privilege.database ?? "-"}${suffix}`;
  }
  if (privilege.objectType === "schema") {
    return `${privilege.privilege} on schema ${privilege.schema ?? "-"}${suffix}`;
  }
  if (privilege.objectType === "sequence") {
    return `${privilege.privilege} on sequence ${privilege.schema ?? "public"}.${privilege.sequence ?? "-"}${suffix}`;
  }

  const tableTarget = privilege.schema
    ? `${privilege.schema}.${privilege.table ?? "-"}`
    : `${privilege.database ?? "-"}.${privilege.table ?? "-"}`;
  return `${privilege.privilege} on table ${tableTarget}${suffix}`;
}

function buildPrivilegeMutationInput(
  fallbackDatabase: string | undefined,
  form: PrivilegeFormState,
) {
  const privileges = form.objectType === "role_membership" ? ["MEMBER"] : form.selectedPrivileges;

  return {
    objectType: form.objectType,
    database: form.database || fallbackDatabase || undefined,
    schema: form.schema || undefined,
    table: form.table || undefined,
    sequence: form.sequence || undefined,
    privileges,
    sourceRole: form.sourceRole || undefined,
    confirmDangerous: form.confirmDangerous,
  } satisfies DatabasePrivilegeMutationInput;
}

function EmptyPrivilegeList({ message }: { message: string }) {
  return <p className="text-sm text-[var(--muted)]">{message}</p>;
}

export function DbUsersPage() {
  const queryClient = useQueryClient();
  const { selection, setSelection } = useSelection();
  const [dbUserEditor, setDbUserEditor] = useState<DbUserEditorState>(emptyDbUserEditorState);
  const [privilegeForm, setPrivilegeForm] = useState<PrivilegeFormState>(emptyPrivilegeForm);
  const [userSearch, setUserSearch] = useState("");
  const [showUserForm, setShowUserForm] = useState(false);

  const connectionsQuery = useQuery({
    queryKey: ["connections"],
    queryFn: connectionsApi.list,
  });
  const connections = connectionsQuery.data?.connections ?? [];
  const activeConnection =
    connections.find((connection) => connection.id === selection.connectionId) ?? connections[0];
  const isPostgreSql = activeConnection?.dialect === "postgresql";
  const dbEntityLabel = isPostgreSql ? "ロール（ユーザー）" : "DBユーザー";
  const dbEntityListLabel = isPostgreSql
    ? "PostgreSQL ロール（ユーザー）"
    : "MySQL / MariaDB ユーザー";
  const isDbUserEditorBoundToActiveConnection =
    dbUserEditor.connectionId === (activeConnection?.id ?? null);
  const selectedDbUserId = isDbUserEditorBoundToActiveConnection
    ? dbUserEditor.selectedDbUserId
    : null;
  const dbUserForm = isDbUserEditorBoundToActiveConnection ? dbUserEditor.form : emptyDbUserForm;

  const dbUsersQuery = useQuery({
    queryKey: ["db-users", activeConnection?.id],
    queryFn: () => dbUsersApi.list(activeConnection!.id),
    enabled: Boolean(activeConnection?.id),
  });

  const dbUsers = useMemo(() => dbUsersQuery.data?.users ?? [], [dbUsersQuery.data?.users]);
  const filteredDbUsers = useMemo(() => {
    const keyword = userSearch.trim().toLowerCase();
    if (!keyword) {
      return dbUsers;
    }
    return dbUsers.filter((user) =>
      [user.id, user.username, user.host, user.type]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword)),
    );
  }, [dbUsers, userSearch]);
  const selectedDbUser = dbUsers.find((user) => user.id === selectedDbUserId) ?? null;
  const privilegedUserCount = dbUsers.filter(
    (user) => user.isSuperuser || user.canCreateDatabase || user.canCreateUser,
  ).length;
  const loginDisabledCount = dbUsers.filter((user) => user.canLogin === false).length;

  const privilegesQuery = useQuery({
    queryKey: ["db-privileges", activeConnection?.id, selectedDbUserId],
    queryFn: () => dbUsersApi.privileges(activeConnection!.id, selectedDbUserId!),
    enabled: Boolean(activeConnection?.id && selectedDbUserId),
  });

  const saveDbUserMutation = useMutation({
    mutationFn: async () => {
      const postgresqlRoleAttributes = buildPostgresqlRoleAttributes(dbUserForm);

      return selectedDbUserId
        ? dbUsersApi.update(activeConnection!.id, selectedDbUserId, {
            password: dbUserForm.password || undefined,
            canLogin: dbUserForm.canLogin,
            ...postgresqlRoleAttributes,
          } satisfies DatabaseUserUpdateInput)
        : dbUsersApi.create(activeConnection!.id, {
            username: dbUserForm.username,
            host: dbUserForm.host || undefined,
            password: dbUserForm.password,
            canLogin: dbUserForm.canLogin,
            ...postgresqlRoleAttributes,
          } satisfies DatabaseUserCreateInput);
    },
    onSuccess: () => {
      toast.success(selectedDbUserId ? "DBユーザーを更新しました。" : "DBユーザーを作成しました。");
      resetDbUserEditor();
      setShowUserForm(false);
      void queryClient.invalidateQueries({ queryKey: ["db-users", activeConnection?.id] });
    },
    onError: (error) => {
      toast.error(formatApiError(error));
    },
  });

  const deleteDbUserMutation = useMutation({
    mutationFn: (dbUserId: string) => dbUsersApi.remove(activeConnection!.id, dbUserId),
    onSuccess: () => {
      toast.success("DBユーザーを削除しました。");
      resetDbUserEditor();
      setShowUserForm(false);
      void queryClient.invalidateQueries({ queryKey: ["db-users", activeConnection?.id] });
      void queryClient.invalidateQueries({ queryKey: ["db-privileges", activeConnection?.id] });
    },
    onError: (error) => {
      toast.error(formatApiError(error));
    },
  });

  const privilegeMutation = useMutation({
    mutationFn: async () => {
      if (!selectedDbUserId) {
        throw new Error("対象ユーザーを選択してください。");
      }

      const privileges =
        resolvedPrivilegeForm.objectType === "role_membership"
          ? ["MEMBER"]
          : resolvedPrivilegeForm.selectedPrivileges;

      if (resolvedPrivilegeForm.objectType !== "role_membership" && privileges.length === 0) {
        throw new Error("権限を1つ以上選択してください。");
      }

      const input = buildPrivilegeMutationInput(activeConnection?.database, {
        ...resolvedPrivilegeForm,
        selectedPrivileges: privileges,
        confirmDangerous: privilegeForm.confirmDangerous,
      });

      return resolvedPrivilegeForm.action === "grant"
        ? dbUsersApi.grant(activeConnection!.id, selectedDbUserId, input)
        : dbUsersApi.revoke(activeConnection!.id, selectedDbUserId, input);
    },
    onSuccess: () => {
      toast.success(
        privilegeForm.action === "grant" ? "権限を付与しました。" : "権限を剥奪しました。",
      );
      void queryClient.invalidateQueries({
        queryKey: ["db-privileges", activeConnection?.id, selectedDbUserId],
      });
    },
    onError: (error) => {
      toast.error(formatApiError(error));
    },
  });

  const groupedPrivileges = (privilegesQuery.data?.privileges ?? []).reduce<
    Record<string, DatabasePrivilege[]>
  >((accumulator, privilege) => {
    const key = privilege.source;
    const current = accumulator[key] ?? [];
    current.push(privilege);
    accumulator[key] = current;
    return accumulator;
  }, {});

  const supportedObjectOptions = privilegeOptionsForDialect(activeConnection?.dialect);
  const resolvedObjectType = supportedObjectOptions.some(
    (option) => option.value === privilegeForm.objectType,
  )
    ? privilegeForm.objectType
    : (supportedObjectOptions[0]?.value ?? "table");
  const resolvedSchema =
    activeConnection?.dialect === "postgresql"
      ? privilegeForm.schema || "public"
      : privilegeForm.schema;
  const privilegeCategories = getPrivilegeCategories(activeConnection?.dialect, resolvedObjectType);
  const privilegeOptions = privilegeCategories.flatMap((category) => category.options);
  const allowedPrivilegeValues = new Set(privilegeOptions.map((option) => option.value));
  const filteredSelectedPrivileges =
    resolvedObjectType === "role_membership"
      ? []
      : privilegeForm.selectedPrivileges.filter((value) => allowedPrivilegeValues.has(value));
  const selectedPrivileges =
    resolvedObjectType === "role_membership"
      ? []
      : filteredSelectedPrivileges.length > 0
        ? filteredSelectedPrivileges
        : getDefaultPrivileges(activeConnection?.dialect, resolvedObjectType);
  const resolvedPrivilegeForm: PrivilegeFormState = {
    ...privilegeForm,
    objectType: resolvedObjectType,
    schema: resolvedSchema,
    selectedPrivileges,
  };
  const selectedPrivilegeCount = selectedPrivileges.length;
  const hasDangerousSelection = selectedPrivileges.some((privilege) =>
    isDangerousPrivilege(privilege),
  );
  const canSubmitPrivilegeMutation =
    Boolean(selectedDbUserId) &&
    (resolvedObjectType === "role_membership"
      ? Boolean(privilegeForm.sourceRole.trim())
      : selectedPrivilegeCount > 0);
  const privilegePreviewQuery = useQuery({
    queryKey: [
      "db-privilege-preview",
      activeConnection?.id,
      selectedDbUserId,
      resolvedPrivilegeForm,
    ],
    queryFn: () =>
      dbUsersApi.previewPrivilege(
        activeConnection!.id,
        selectedDbUserId!,
        resolvedPrivilegeForm.action,
        buildPrivilegeMutationInput(activeConnection?.database, resolvedPrivilegeForm),
      ),
    enabled: Boolean(activeConnection?.id && selectedDbUserId && canSubmitPrivilegeMutation),
  });

  function resetDbUserEditor() {
    setDbUserEditor({
      connectionId: activeConnection?.id ?? null,
      selectedDbUserId: null,
      form: emptyDbUserForm,
    });
  }

  function patchDbUserForm(updater: (current: DbUserFormState) => DbUserFormState) {
    setDbUserEditor((current) => ({
      connectionId: activeConnection?.id ?? null,
      selectedDbUserId:
        current.connectionId === (activeConnection?.id ?? null) ? current.selectedDbUserId : null,
      form: updater(
        current.connectionId === (activeConnection?.id ?? null) ? current.form : emptyDbUserForm,
      ),
    }));
  }

  function selectDbUser(user: DatabaseUser) {
    setDbUserEditor({
      connectionId: activeConnection?.id ?? null,
      selectedDbUserId: user.id,
      form: getDbUserFormFromUser(user),
    });
    setShowUserForm(false);
  }

  function setSelectedPrivileges(nextPrivileges: string[]) {
    setPrivilegeForm((current) => ({
      ...current,
      selectedPrivileges: normalizePrivileges(nextPrivileges),
    }));
  }

  function togglePrivilege(privilege: string, checked: boolean) {
    setSelectedPrivileges(
      checked
        ? [...selectedPrivileges, privilege]
        : selectedPrivileges.filter((value) => value !== privilege),
    );
  }

  function toggleCategory(category: PrivilegeCatalogCategory, checked: boolean) {
    const categoryValues = category.options.map((option) => option.value);
    setSelectedPrivileges(
      checked
        ? [...selectedPrivileges, ...categoryValues]
        : selectedPrivileges.filter((value) => !categoryValues.includes(value)),
    );
  }

  function applyObjectType(objectType: PrivilegeFormState["objectType"]) {
    setPrivilegeForm((current) => ({
      ...current,
      objectType,
      selectedPrivileges: getDefaultPrivileges(activeConnection?.dialect, objectType),
    }));
  }

  return (
    <div className="space-y-5">
      <section className="app-panel rounded-[28px] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
              User Accounts & Privileges
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em]">{dbEntityListLabel}</h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              {activeConnection?.name ?? "No Connection"} / {activeConnection?.database ?? "-"} /{" "}
              {activeConnection ? dialectLabel(activeConnection.dialect) : "-"}
            </p>
            {isPostgreSql ? (
              <p className="mt-2 max-w-3xl text-sm text-[var(--muted)]">
                PostgreSQLでは「ユーザー」はLOGIN可能なロールです。この画面ではロール一覧として表示し、
                LOGIN可のものをログインユーザーとして扱います。
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone="outline">
              <Users2 className="mr-1 size-3" />
              {dbUsers.length} 件
            </Badge>
            <Badge tone="warning">
              <ShieldAlert className="mr-1 size-3" />
              管理系 {privilegedUserCount}
            </Badge>
            <Badge tone="muted">
              <LockKeyhole className="mr-1 size-3" />
              ロック {loginDisabledCount}
            </Badge>
          </div>
        </div>
      </section>

      <div className="grid min-w-0 gap-5 lg:grid-cols-[0.78fr_1.22fr]">
        <section className="app-panel min-w-0 rounded-[28px] p-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold">{dbEntityListLabel}</h3>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {isPostgreSql
                  ? "PostgreSQL の role / role属性 / 継承関係をまとめて管理します。"
                  : "phpMyAdmin の「ユーザーアカウント」に近い、database 側ユーザーを管理します。"}
              </p>
            </div>
            <Button
              onClick={() => {
                resetDbUserEditor();
                setShowUserForm(true);
              }}
            >
              新規作成
            </Button>
          </div>
          <div className="mt-4 space-y-4">
            <Field label="接続">
              <SelectInput
                onChange={(event) => {
                  const nextConnection = connections.find(
                    (connection) => connection.id === event.target.value,
                  );
                  setSelection(
                    {
                      connectionId: event.target.value,
                      database: nextConnection?.database ?? "",
                      schema: "",
                      table: "",
                    },
                    { replace: true },
                  );
                }}
                value={activeConnection?.id ?? ""}
              >
                {connections.map((connection) => (
                  <option key={connection.id} value={connection.id}>
                    {connection.name} ({dialectLabel(connection.dialect)})
                  </option>
                ))}
              </SelectInput>
            </Field>
            <div className="flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] px-3 py-2 text-sm text-[var(--muted)]">
              <Search className="size-4 shrink-0" />
              <input
                className="min-w-0 flex-1 bg-transparent outline-none"
                onChange={(event) => setUserSearch(event.target.value)}
                placeholder="user / host / role を検索"
                value={userSearch}
              />
            </div>
            <div className="overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--panel)]">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-[var(--panel-soft)] text-[var(--muted)]">
                  <tr>
                    <th className="px-3 py-2">ユーザー名</th>
                    <th className="px-3 py-2">ホスト名</th>
                    <th className="px-3 py-2">{isPostgreSql ? "LOGIN" : "状態"}</th>
                    <th className="px-3 py-2">権限</th>
                    <th className="px-3 py-2">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDbUsers.map((user) => (
                    <tr
                      className={cn(
                        "border-t border-[var(--border)] transition hover:bg-[var(--panel-strong)]",
                        selectedDbUserId === user.id && "bg-[var(--accent-soft)]",
                      )}
                      key={user.id}
                    >
                      <td className="px-3 py-2">
                        <button
                          className="font-medium text-[var(--foreground)] hover:text-[var(--accent)]"
                          onClick={() => selectDbUser(user)}
                          type="button"
                        >
                          {user.username}
                        </button>
                        <p className="mt-1 text-xs text-[var(--muted)]">{user.id}</p>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{user.host ?? "-"}</td>
                      <td className="px-3 py-2">
                        {isPostgreSql ? (
                          <Badge tone={user.canLogin === false ? "muted" : "success"}>
                            {user.canLogin === false ? "LOGINなし" : "LOGIN可"}
                          </Badge>
                        ) : (
                          <Badge tone="muted">管理対象</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {user.isSuperuser ? <Badge tone="danger">super</Badge> : null}
                          {user.canCreateDatabase ? <Badge tone="outline">createdb</Badge> : null}
                          {user.canCreateUser ? <Badge tone="outline">createrole</Badge> : null}
                          {user.canReplication ? <Badge tone="outline">replication</Badge> : null}
                          {!user.isSuperuser &&
                          !user.canCreateDatabase &&
                          !user.canCreateUser &&
                          !user.canReplication ? (
                            <Badge tone="muted">USAGE</Badge>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-2">
                          <Button
                            className="px-2 py-1 text-xs"
                            onClick={() => selectDbUser(user)}
                            variant="ghost"
                          >
                            <KeyRound className="mr-1 size-3" />
                            権限
                          </Button>
                          <Button
                            className="px-2 py-1 text-xs"
                            onClick={() => {
                              selectDbUser(user);
                              setShowUserForm(true);
                            }}
                            variant="ghost"
                          >
                            編集
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!dbUsersQuery.isLoading && filteredDbUsers.length === 0 ? (
                <div className="p-4 text-sm text-[var(--muted)]">
                  条件に一致するユーザーはありません。
                </div>
              ) : null}
            </div>
            <div className="space-y-3">
              {dbUsersQuery.isLoading ? (
                <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--panel)] p-4 text-sm text-[var(--muted)]">
                  DBユーザー一覧を読み込んでいます...
                </div>
              ) : null}
              {!dbUsersQuery.isLoading && dbUsers.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--panel)] p-4 text-sm text-[var(--muted)]">
                  この接続先には表示できる DBユーザー / role がありません。
                </div>
              ) : null}
            </div>

            {showUserForm || selectedDbUserId ? (
              <form
                className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveDbUserMutation.mutateAsync();
                }}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">
                      {selectedDbUserId ? `${dbEntityLabel}を編集` : `${dbEntityLabel}を作成`}
                    </p>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      {isPostgreSql
                        ? "PostgreSQL は LOGIN や SUPERUSER などの role 属性もここで管理します。"
                        : "MySQL / MariaDB の database 側ユーザーを管理します。"}
                    </p>
                  </div>
                  {selectedDbUserId ? (
                    <Button
                      onClick={() => {
                        resetDbUserEditor();
                        setShowUserForm(true);
                      }}
                      variant="secondary"
                    >
                      新規に戻す
                    </Button>
                  ) : null}
                </div>
                <Field label={isPostgreSql ? "ロール名" : "ユーザー名"}>
                  <TextInput
                    disabled={Boolean(selectedDbUserId)}
                    onChange={(event) =>
                      patchDbUserForm((current) => ({ ...current, username: event.target.value }))
                    }
                    value={dbUserForm.username}
                  />
                </Field>
                {!isPostgreSql ? (
                  <Field label="ホスト">
                    <TextInput
                      disabled={Boolean(selectedDbUserId)}
                      onChange={(event) =>
                        patchDbUserForm((current) => ({ ...current, host: event.target.value }))
                      }
                      value={dbUserForm.host}
                    />
                  </Field>
                ) : null}
                <Field
                  hint={selectedDbUserId ? "変更する場合のみ入力します。" : ""}
                  label="パスワード"
                >
                  <TextInput
                    onChange={(event) =>
                      patchDbUserForm((current) => ({ ...current, password: event.target.value }))
                    }
                    type="password"
                    value={dbUserForm.password}
                  />
                </Field>
                {isPostgreSql ? (
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="size-4 text-[var(--accent)]" />
                      <p className="text-sm font-medium">PostgreSQL ロール属性</p>
                    </div>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      ログイン可否と、サーバ寄りの role 属性をここで切り替えます。
                    </p>
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      <CheckboxField
                        checked={dbUserForm.canLogin}
                        hint="この role でログインできるようにします。"
                        label="LOGIN"
                        onChange={(event) =>
                          patchDbUserForm((current) => ({
                            ...current,
                            canLogin: event.target.checked,
                          }))
                        }
                      />
                      {postgresqlRoleAttributeOptions.map((option) => (
                        <CheckboxField
                          checked={dbUserForm[option.key]}
                          hint={option.dangerous ? `${option.hint} / 要注意` : option.hint}
                          key={option.key}
                          label={option.label}
                          onChange={(event) =>
                            patchDbUserForm((current) => ({
                              ...current,
                              [option.key]: event.target.checked,
                            }))
                          }
                        />
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button disabled={saveDbUserMutation.isPending} type="submit">
                    <UserRoundCog className="mr-2 size-4" />
                    {selectedDbUserId ? `${dbEntityLabel}を更新` : `${dbEntityLabel}を作成`}
                  </Button>
                  {selectedDbUserId ? (
                    <Button
                      onClick={() => {
                        if (!window.confirm(`${selectedDbUserId} を削除しますか。`)) {
                          return;
                        }
                        void deleteDbUserMutation.mutateAsync(selectedDbUserId);
                      }}
                      type="button"
                      variant="danger"
                    >
                      削除
                    </Button>
                  ) : null}
                </div>
              </form>
            ) : null}
          </div>
        </section>
        <section className="app-panel min-w-0 rounded-[28px] p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold">現在の権限と権限変更</h3>
              <p className="mt-1 text-sm text-[var(--muted)]">
                現在付与されている権限を見ながら、チェックボックスで変更内容を組み立てます。
                {isPostgreSql
                  ? " SUPERUSER / CREATEDB などのロール属性は左側で編集します。"
                  : " MySQL / MariaDB は global / database / table の3段階で切り替えます。"}
              </p>
            </div>
            <Badge tone={selectedDbUserId ? "outline" : "muted"}>
              {selectedDbUser ? `対象: ${selectedDbUser.id}` : "ユーザー未選択"}
            </Badge>
          </div>
          {!selectedDbUserId ? (
            <div className="mt-5 rounded-2xl border border-dashed border-[var(--border)] bg-[var(--panel)] p-5 text-sm text-[var(--muted)]">
              左の一覧からユーザーまたはロールを選択すると、現在の権限と変更フォームを表示します。
              新規作成は左上の「新規作成」から開きます。
            </div>
          ) : (
            <>
              <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4">
                <p className="text-sm font-medium">権限体系</p>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  {isPostgreSql
                    ? "PostgreSQL は role属性、オブジェクト権限、ロール継承を分けて管理します。"
                    : "MySQL / MariaDB はユーザー単位で、サーバ全体・database・table の権限を切り替えます。"}
                </p>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  {isPostgreSql ? (
                    <>
                      <Badge tone="muted">LOGIN / SUPERUSER</Badge>
                      <Badge tone="muted">database</Badge>
                      <Badge tone="muted">schema</Badge>
                      <Badge tone="muted">table</Badge>
                      <Badge tone="muted">sequence</Badge>
                      <Badge tone="muted">role membership</Badge>
                    </>
                  ) : (
                    <>
                      <Badge tone="muted">user@host</Badge>
                      <Badge tone="muted">global (*.*)</Badge>
                      <Badge tone="muted">database (db.*)</Badge>
                      <Badge tone="muted">table (db.table)</Badge>
                    </>
                  )}
                </div>
              </div>
              <div
                className={`mt-4 grid gap-4 ${isPostgreSql ? "md:grid-cols-3" : "md:grid-cols-2"}`}
              >
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4">
                  <p className="text-sm font-medium">直接付与されている権限</p>
                  <ul className="mt-3 space-y-2 text-sm text-[var(--muted)]">
                    {(groupedPrivileges.direct ?? []).length === 0 ? (
                      <EmptyPrivilegeList message="直接付与されている権限はありません。" />
                    ) : (
                      (groupedPrivileges.direct ?? []).map((item) => (
                        <li key={item.id}>{describePrivilege(item)}</li>
                      ))
                    )}
                  </ul>
                </div>
                {isPostgreSql ? (
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4">
                    <p className="text-sm font-medium">継承されている権限</p>
                    <ul className="mt-3 space-y-2 text-sm text-[var(--muted)]">
                      {(groupedPrivileges.membership ?? []).length === 0 ? (
                        <EmptyPrivilegeList message="継承されている権限はありません。" />
                      ) : (
                        (groupedPrivileges.membership ?? []).map((item) => (
                          <li key={item.id}>{describePrivilege(item)}</li>
                        ))
                      )}
                    </ul>
                  </div>
                ) : null}
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4">
                  <div className="flex items-center gap-2 text-[var(--danger)]">
                    <AlertTriangle className="size-4" />
                    <p className="text-sm font-medium text-[var(--foreground)]">
                      {isPostgreSql ? "PUBLIC / 注意が必要" : "注意が必要 / 未解析"}
                    </p>
                  </div>
                  <ul className="mt-3 space-y-2 text-sm text-[var(--muted)]">
                    {[...(groupedPrivileges.public ?? []), ...(groupedPrivileges.raw ?? [])]
                      .length === 0 ? (
                      <EmptyPrivilegeList
                        message={
                          isPostgreSql
                            ? "PUBLIC 付与や未解析の権限はありません。"
                            : "危険な付与や未解析の権限はありません。"
                        }
                      />
                    ) : (
                      [...(groupedPrivileges.public ?? []), ...(groupedPrivileges.raw ?? [])].map(
                        (item) => <li key={item.id}>{item.note ?? describePrivilege(item)}</li>,
                      )
                    )}
                  </ul>
                </div>
              </div>
              <form
                className="mt-5 grid min-w-0 gap-4 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void privilegeMutation.mutateAsync();
                }}
              >
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="操作">
                    <SelectInput
                      onChange={(event) =>
                        setPrivilegeForm((current) => ({
                          ...current,
                          action: event.target.value as PrivilegeFormState["action"],
                        }))
                      }
                      value={privilegeForm.action}
                    >
                      <option value="grant">GRANT</option>
                      <option value="revoke">REVOKE</option>
                    </SelectInput>
                  </Field>
                  <Field label="対象">
                    <SelectInput
                      onChange={(event) =>
                        applyObjectType(event.target.value as PrivilegeFormState["objectType"])
                      }
                      value={resolvedObjectType}
                    >
                      {supportedObjectOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </SelectInput>
                  </Field>
                  {(!isPostgreSql || resolvedObjectType === "database") && (
                    <Field label={isPostgreSql ? "データベース名" : "database名"}>
                      <TextInput
                        onChange={(event) =>
                          setPrivilegeForm((current) => ({
                            ...current,
                            database: event.target.value,
                          }))
                        }
                        value={privilegeForm.database}
                      />
                    </Field>
                  )}
                  {resolvedObjectType === "schema" ||
                  resolvedObjectType === "table" ||
                  resolvedObjectType === "sequence" ? (
                    <Field label="スキーマ名">
                      <TextInput
                        onChange={(event) =>
                          setPrivilegeForm((current) => ({
                            ...current,
                            schema: event.target.value,
                          }))
                        }
                        value={resolvedPrivilegeForm.schema}
                      />
                    </Field>
                  ) : null}
                  {resolvedObjectType === "table" ? (
                    <Field label="テーブル名">
                      <TextInput
                        onChange={(event) =>
                          setPrivilegeForm((current) => ({ ...current, table: event.target.value }))
                        }
                        value={privilegeForm.table}
                      />
                    </Field>
                  ) : null}
                  {resolvedObjectType === "sequence" ? (
                    <Field label="シーケンス名">
                      <TextInput
                        onChange={(event) =>
                          setPrivilegeForm((current) => ({
                            ...current,
                            sequence: event.target.value,
                          }))
                        }
                        value={privilegeForm.sequence}
                      />
                    </Field>
                  ) : null}
                  {resolvedObjectType === "role_membership" ? (
                    <Field
                      className="md:col-span-2"
                      hint="付与または剥奪したい親 role 名を入力します。"
                      label="親ロール名"
                    >
                      <TextInput
                        onChange={(event) =>
                          setPrivilegeForm((current) => ({
                            ...current,
                            sourceRole: event.target.value,
                          }))
                        }
                        value={privilegeForm.sourceRole}
                      />
                    </Field>
                  ) : (
                    <div className="space-y-4 md:col-span-2">
                      <div className="flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <ShieldCheck className="size-4 text-[var(--accent)]" />
                            <p className="text-sm font-medium">権限をチェックで選択</p>
                          </div>
                          <p className="mt-1 text-xs text-[var(--muted)]">
                            {isPostgreSql
                              ? "PostgreSQL の object権限をカテゴリー別に一括ON/OFFできます。"
                              : "MySQL / MariaDB の権限をカテゴリー別に一括ON/OFFできます。"}{" "}
                            選択中 {selectedPrivilegeCount} 件
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            onClick={() =>
                              setSelectedPrivileges(privilegeOptions.map((option) => option.value))
                            }
                            variant="ghost"
                          >
                            すべてON
                          </Button>
                          <Button onClick={() => setSelectedPrivileges([])} variant="ghost">
                            すべてOFF
                          </Button>
                        </div>
                      </div>
                      {privilegeCategories.map((category) => {
                        const selectedInCategory = category.options.filter((option) =>
                          selectedPrivileges.includes(option.value),
                        ).length;

                        return (
                          <section
                            className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4"
                            key={category.key}
                          >
                            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                              <div>
                                <div className="flex items-center gap-2">
                                  <p className="text-sm font-medium text-[var(--foreground)]">
                                    {category.label}
                                  </p>
                                  <Badge tone="muted">
                                    {selectedInCategory}/{category.options.length}
                                  </Badge>
                                </div>
                                <p className="mt-1 text-xs text-[var(--muted)]">
                                  {category.description}
                                </p>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  onClick={() => toggleCategory(category, true)}
                                  variant="ghost"
                                >
                                  このカテゴリをON
                                </Button>
                                <Button
                                  onClick={() => toggleCategory(category, false)}
                                  variant="ghost"
                                >
                                  このカテゴリをOFF
                                </Button>
                              </div>
                            </div>
                            <div className="mt-3 grid gap-2 lg:grid-cols-2">
                              {category.options.map((option) => (
                                <CheckboxField
                                  checked={selectedPrivileges.includes(option.value)}
                                  hint={option.dangerous ? `${option.hint} / 要注意` : option.hint}
                                  key={option.value}
                                  label={option.label}
                                  onChange={(event) =>
                                    togglePrivilege(option.value, event.target.checked)
                                  }
                                />
                              ))}
                            </div>
                          </section>
                        );
                      })}
                    </div>
                  )}
                </div>
                {hasDangerousSelection ? (
                  <CheckboxField
                    checked={privilegeForm.confirmDangerous}
                    hint="危険な権限が含まれているため、保存前に明示確認が必要です。"
                    label="危険な権限変更を確認済みにする"
                    onChange={(event) =>
                      setPrivilegeForm((current) => ({
                        ...current,
                        confirmDangerous: event.target.checked,
                      }))
                    }
                  />
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={privilegeMutation.isPending || !canSubmitPrivilegeMutation}
                    type="submit"
                  >
                    {privilegeForm.action === "grant" ? "権限を付与" : "権限を剥奪"}
                  </Button>
                </div>
              </form>
              <div className="mt-5 min-w-0 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4">
                <p className="text-sm font-medium leading-6">
                  実行される
                  <br />
                  SQL
                </p>
                <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-all text-sm text-[var(--foreground)]">
                  {privilegePreviewQuery.isLoading
                    ? "生成中..."
                    : privilegePreviewQuery.isError
                      ? formatApiError(privilegePreviewQuery.error)
                      : (privilegePreviewQuery.data?.sql ??
                        "対象ユーザーと権限を選択してください。")}
                </pre>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
