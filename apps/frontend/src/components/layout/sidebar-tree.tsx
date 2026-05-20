import {
  ChevronRight,
  Database,
  Eye,
  Layers3,
  LayoutGrid,
  Table2,
  Telescope,
  Users2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import type { ConnectionSummary, TableInfo } from "@modern-db-admin/shared";

import { buildSelectionSearch } from "@/hooks/use-selection";
import { connectionsApi, metadataApi } from "@/lib/api";
import { cn } from "@/lib/cn";

type SidebarNodeType = "connection" | "database" | "schema" | "folder" | "table" | "view";

type SidebarSelection = {
  connectionId?: string;
  database?: string;
  schema?: string;
  table?: string;
};

type SidebarNodeQuery = {
  emptyMessage: string;
  queryFn: () => Promise<SidebarNode[]>;
  queryKey: readonly unknown[];
};

type SidebarNode = {
  id: string;
  label: string;
  type: SidebarNodeType;
  href?: string;
  selection?: SidebarSelection;
  defaultExpanded?: boolean;
  children?: SidebarNode[];
  childrenQuery?: SidebarNodeQuery;
};

type TreeNodeState = "inactive" | "ancestor" | "current";
type ExpansionState = Record<string, boolean>;

type RouteState = {
  currentHref: string;
  pathname: string;
  selection: SidebarSelection;
};

const sidebarTreeStaleTimeMs = 30_000;
const selectionKeys = ["connectionId", "database", "schema", "table"] as const;

function NodeIcon({ className, type }: { className?: string; type: SidebarNodeType }) {
  switch (type) {
    case "connection":
    case "database":
      return <Database className={className} />;
    case "schema":
    case "folder":
      return <Layers3 className={className} />;
    case "table":
      return <Table2 className={className} />;
    case "view":
      return <Eye className={className} />;
    default:
      return <Telescope className={className} />;
  }
}

function buildTableHref(connectionId: string, database: string, schema: string, table: string) {
  return `/app/table${buildSelectionSearch({
    connectionId,
    database,
    schema,
    table,
  })}`;
}

function buildObjectHref(
  connection: ConnectionSummary,
  database: string,
  schema?: string,
  section?: "schemas" | "tables" | "views",
) {
  const search = buildSelectionSearch({
    connectionId: connection.id,
    database,
    schema,
  });

  if (!section) {
    return `/app/table${search}`;
  }

  const separator = search ? "&" : "?";
  return `/app/table${search}${separator}section=${section}`;
}

function buildObjectFolders(
  connection: ConnectionSummary,
  database: string,
  schema: string,
  tables: TableInfo[],
): SidebarNode[] {
  const tableNodes = tables
    .filter((table) => table.type === "table")
    .map((table) => ({
      id: `${connection.id}:${database}:${schema}:table:${table.name}`,
      label: table.name,
      type: "table" as const,
      href: buildTableHref(connection.id, database, schema, table.name),
      selection: {
        connectionId: connection.id,
        database,
        schema,
        table: table.name,
      },
    }));

  const viewNodes = tables
    .filter((table) => table.type === "view")
    .map((table) => ({
      id: `${connection.id}:${database}:${schema}:view:${table.name}`,
      label: table.name,
      type: "view" as const,
      href: buildTableHref(connection.id, database, schema, table.name),
      selection: {
        connectionId: connection.id,
        database,
        schema,
        table: table.name,
      },
    }));

  return [
    {
      id: `${connection.id}:${database}:${schema}:tables`,
      label: "tables",
      type: "folder" as const,
      href: buildObjectHref(connection, database, schema, "tables"),
      children: tableNodes,
    },
    ...(viewNodes.length > 0
      ? [
          {
            id: `${connection.id}:${database}:${schema}:views`,
            label: "views",
            type: "folder" as const,
            href: buildObjectHref(connection, database, schema, "views"),
            children: viewNodes,
          } satisfies SidebarNode,
        ]
      : []),
  ];
}

function buildSchemaNode(connection: ConnectionSummary, database: string, schema: string): SidebarNode {
  return {
    id: `${connection.id}:${database}:${schema}`,
    label: schema,
    type: "schema",
    href: buildObjectHref(connection, database, schema),
    selection: {
      connectionId: connection.id,
      database,
      schema,
    },
    childrenQuery: {
      emptyMessage: "テーブルがありません。",
      queryKey: ["sidebar-tree", "tables", connection.id, database, schema],
      queryFn: async () => {
        const { tables } = await metadataApi.tables(connection.id, database, schema);
        return buildObjectFolders(connection, database, schema, tables);
      },
    },
  };
}

function buildDatabaseNode(connection: ConnectionSummary, database: string): SidebarNode {
  if (connection.dialect !== "postgresql") {
    return {
      id: `${connection.id}:${database}`,
      label: database,
      type: "database",
      href: buildObjectHref(connection, database, database),
      selection: {
        connectionId: connection.id,
        database,
        schema: database,
      },
      childrenQuery: {
        emptyMessage: "テーブルがありません。",
        queryKey: ["sidebar-tree", "tables", connection.id, database, database],
        queryFn: async () => {
          const { tables } = await metadataApi.tables(connection.id, database, database);
          return buildObjectFolders(connection, database, database, tables);
        },
      },
    };
  }

  return {
    id: `${connection.id}:${database}`,
    label: database,
    type: "database",
    href: buildObjectHref(connection, database),
    selection: {
      connectionId: connection.id,
      database,
    },
    children: [
      {
        id: `${connection.id}:${database}:schemas`,
        label: "schemas",
        type: "folder",
        href: buildObjectHref(connection, database, undefined, "schemas"),
        childrenQuery: {
          emptyMessage: "schema がありません。",
          queryKey: ["sidebar-tree", "schemas", connection.id, database],
          queryFn: async () => {
            const { schemas } = await metadataApi.schemas(connection.id, database);
            return schemas.map((schema) => buildSchemaNode(connection, database, schema.name));
          },
        },
      },
    ],
  };
}

function fallbackDatabaseNode(connection: ConnectionSummary): SidebarNode | null {
  if (!connection.database) {
    return null;
  }

  return buildDatabaseNode(connection, connection.database);
}

function buildConnectionNode(
  connection: ConnectionSummary,
  defaultExpanded: boolean,
): SidebarNode {
  return {
    id: connection.id,
    label: connection.name,
    type: "connection",
    href: `/app/table${buildSelectionSearch({ connectionId: connection.id })}`,
    selection: {
      connectionId: connection.id,
    },
    defaultExpanded,
    childrenQuery: {
      emptyMessage: "database がありません。",
      queryKey: ["sidebar-tree", "databases", connection.id],
      queryFn: async () => {
        const { databases } = await metadataApi.databases(connection.id);
        if (databases.length > 0) {
          return databases.map((database) => buildDatabaseNode(connection, database.name));
        }

        const fallbackNode = fallbackDatabaseNode(connection);
        return fallbackNode ? [fallbackNode] : [];
      },
    },
  };
}

async function loadConnectionNodes(): Promise<SidebarNode[]> {
  const { connections } = await connectionsApi.list();
  const expandSingleConnection = connections.length === 1;
  return connections.map((connection) => buildConnectionNode(connection, expandSingleConnection));
}

function readRouteState(pathname: string, search: string): RouteState {
  const searchParams = new URLSearchParams(search);
  return {
    pathname,
    currentHref: `${pathname}${search}`,
    selection: {
      connectionId: searchParams.get("connectionId") ?? undefined,
      database: searchParams.get("database") ?? undefined,
      schema: searchParams.get("schema") ?? undefined,
      table: searchParams.get("table") ?? undefined,
    },
  };
}

function isExactNodeMatch(nodeHref: string | undefined, routeState: RouteState) {
  return Boolean(nodeHref) && routeState.currentHref === nodeHref;
}

function isSelectionAncestor(
  nodeSelection: SidebarSelection | undefined,
  currentSelection: SidebarSelection,
) {
  if (!nodeSelection) {
    return false;
  }

  return selectionKeys.some((key) => nodeSelection[key] !== undefined)
    ? selectionKeys.every((key) => {
        const nodeValue = nodeSelection[key];
        return nodeValue === undefined || nodeValue === currentSelection[key];
      })
    : false;
}

function resolveNodeState(
  node: SidebarNode,
  routeState: RouteState,
  childNodes: SidebarNode[],
): TreeNodeState {
  if (isExactNodeMatch(node.href, routeState)) {
    return "current";
  }

  if (
    routeState.pathname === "/app/table" &&
    isSelectionAncestor(node.selection, routeState.selection)
  ) {
    return "ancestor";
  }

  if (
    childNodes.some((child) => resolveNodeState(child, routeState, child.children ?? []) !== "inactive")
  ) {
    return "ancestor";
  }

  return "inactive";
}

function resolveExpandedState(
  node: SidebarNode,
  nodeState: TreeNodeState,
  expansionState: ExpansionState,
) {
  const manualState = expansionState[node.id];
  if (manualState !== undefined) {
    return manualState;
  }

  if (nodeState !== "inactive") {
    return true;
  }

  return node.defaultExpanded ?? false;
}

function TreeItem({
  depth,
  expansionState,
  node,
  onToggle,
  routeState,
}: {
  depth: number;
  expansionState: ExpansionState;
  node: SidebarNode;
  onToggle: (nodeId: string, nextExpanded: boolean) => void;
  routeState: RouteState;
}) {
  const staticChildren = node.children ?? [];
  const hasChildren = staticChildren.length > 0 || Boolean(node.childrenQuery);
  const hasChildQuery = Boolean(node.childrenQuery);
  const initialState = resolveNodeState(node, routeState, staticChildren);
  const isExpanded = hasChildren ? resolveExpandedState(node, initialState, expansionState) : false;
  const childQuery = useQuery({
    queryKey: node.childrenQuery?.queryKey ?? ["sidebar-tree", "static", node.id],
    queryFn: node.childrenQuery?.queryFn ?? (() => Promise.resolve([])),
    enabled: hasChildQuery && isExpanded,
    staleTime: sidebarTreeStaleTimeMs,
  });
  const childNodes = hasChildQuery ? [...staticChildren, ...(childQuery.data ?? [])] : staticChildren;
  const nodeState = resolveNodeState(node, routeState, childNodes);
  const isCurrent = nodeState === "current";
  const isAncestor = nodeState === "ancestor";
  const isInteractive = Boolean(node.href);
  const childOffset = `${(depth + 1) * 14 + 35}px`;
  const content = (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 text-sm transition-colors",
        isInteractive
          ? "text-[var(--muted)] hover:bg-[var(--panel-soft)] hover:text-[var(--foreground)]"
          : "cursor-default text-[var(--muted)]",
        isAncestor && "text-[var(--foreground)]",
        isCurrent &&
          "border-[var(--border-strong)] bg-[var(--panel)] font-medium text-[var(--foreground)] shadow-[0_8px_18px_var(--shadow-color)]",
      )}
    >
      <NodeIcon
        className={cn(
          "size-4 shrink-0",
          isCurrent
            ? "text-[var(--accent)]"
            : isAncestor
              ? "text-[var(--muted-strong)]"
              : "text-[var(--muted)]",
        )}
        type={node.type}
      />
      <span className="truncate">{node.label}</span>
    </div>
  );

  return (
    <div>
      <div className="flex items-center gap-1" style={{ paddingLeft: `${depth * 14 + 4}px` }}>
        {hasChildren ? (
          <button
            aria-expanded={isExpanded}
            aria-label={isExpanded ? `${node.label} を折りたたむ` : `${node.label} を展開する`}
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-[var(--muted)] transition-colors hover:bg-[var(--panel-soft)] hover:text-[var(--foreground)]"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onToggle(node.id, !isExpanded);
            }}
            type="button"
          >
            <ChevronRight className={cn("size-3.5 transition-transform", isExpanded && "rotate-90")} />
          </button>
        ) : (
          <div className="size-6 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          {node.href ? (
            <Link aria-current={isCurrent ? "page" : undefined} to={node.href}>
              {content}
            </Link>
          ) : (
            content
          )}
        </div>
      </div>
      {hasChildren && isExpanded ? (
        <div>
          {childNodes.length > 0 ? (
            <TreeBranch
              depth={depth + 1}
              expansionState={expansionState}
              nodes={childNodes}
              onToggle={onToggle}
              routeState={routeState}
            />
          ) : null}
          {hasChildQuery && childQuery.isPending ? (
            <p className="px-2 pt-1 text-xs text-[var(--muted)]" style={{ paddingLeft: childOffset }}>
              読み込んでいます...
            </p>
          ) : null}
          {hasChildQuery && childQuery.isError ? (
            <p className="px-2 pt-1 text-xs text-[var(--danger)]" style={{ paddingLeft: childOffset }}>
              取得できませんでした。
            </p>
          ) : null}
          {hasChildQuery &&
          !childQuery.isPending &&
          !childQuery.isError &&
          childNodes.length === 0 &&
          node.childrenQuery?.emptyMessage ? (
            <p className="px-2 pt-1 text-xs text-[var(--muted)]" style={{ paddingLeft: childOffset }}>
              {node.childrenQuery.emptyMessage}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function TreeBranch({
  depth = 0,
  expansionState,
  nodes,
  onToggle,
  routeState,
}: {
  depth?: number;
  expansionState: ExpansionState;
  nodes: SidebarNode[];
  onToggle: (nodeId: string, nextExpanded: boolean) => void;
  routeState: RouteState;
}) {
  return (
    <div className="space-y-1">
      {nodes.map((node) => (
        <TreeItem
          depth={depth}
          expansionState={expansionState}
          key={node.id}
          node={node}
          onToggle={onToggle}
          routeState={routeState}
        />
      ))}
    </div>
  );
}

export function SidebarTree() {
  const location = useLocation();
  const [expansionState, setExpansionState] = useState<ExpansionState>({});
  const routeState = useMemo(
    () => readRouteState(location.pathname, location.search),
    [location.pathname, location.search],
  );
  const treeQuery = useQuery({
    queryKey: ["sidebar-tree", "connections"],
    queryFn: loadConnectionNodes,
    staleTime: sidebarTreeStaleTimeMs,
  });

  function handleToggle(nodeId: string, nextExpanded: boolean) {
    setExpansionState((current) => ({
      ...current,
      [nodeId]: nextExpanded,
    }));
  }

  const primaryLinks = [
    { href: "/app/dashboard", icon: LayoutGrid, label: "ダッシュボード" },
    { href: "/app/connections", icon: Database, label: "接続一覧" },
    { href: "/app/app-users", icon: Users2, label: "管理画面ユーザー" },
  ];

  return (
    <aside className="app-sidebar flex h-full flex-col border-r border-[var(--border)]">
      <div className="border-b border-[var(--border)] px-3 py-3">
        <nav className="space-y-1">
          {primaryLinks.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.href;

            return (
              <Link
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-xl border border-transparent px-3 py-2 text-sm transition",
                  isActive
                    ? "border-[var(--border-strong)] bg-[var(--panel)] font-medium text-[var(--foreground)] shadow-[0_8px_18px_var(--shadow-color)]"
                    : "text-[var(--muted)] hover:bg-[var(--panel-soft)] hover:text-[var(--foreground)]",
                )}
                key={item.href}
                to={item.href}
              >
                <Icon
                  className={cn("size-4", isActive ? "text-[var(--accent)]" : "text-[var(--muted)]")}
                />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {treeQuery.isLoading ? (
          <p className="px-2 text-sm text-[var(--muted)]">接続ツリーを読み込んでいます...</p>
        ) : treeQuery.isError ? (
          <p className="px-2 text-sm text-[var(--danger)]">接続ツリーを取得できませんでした。</p>
        ) : (
          <TreeBranch
            expansionState={expansionState}
            nodes={treeQuery.data ?? []}
            onToggle={handleToggle}
            routeState={routeState}
          />
        )}
      </div>
    </aside>
  );
}
