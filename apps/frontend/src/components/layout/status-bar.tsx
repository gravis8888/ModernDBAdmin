import { ShieldCheck, TimerReset } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { connectionsApi } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { useSelection } from "@/hooks/use-selection";
import { useRuntimeStore } from "@/stores/runtime-store";

export function StatusBar() {
  const { selection } = useSelection();
  const lastQuery = useRuntimeStore((state) => state.lastQuery);
  const connectionsQuery = useQuery({
    queryKey: ["connections"],
    queryFn: connectionsApi.list,
  });
  const activeConnection =
    connectionsQuery.data?.connections.find(
      (connection) => connection.id === selection.connectionId,
    ) ?? connectionsQuery.data?.connections[0];

  return (
    <footer className="flex items-center justify-between border-t border-[var(--border)] bg-[var(--panel-strong)] px-4 py-2 text-xs text-[var(--muted)]">
      <div className="flex items-center gap-4">
        <span>Rows: {formatNumber(lastQuery?.rowCount)}</span>
        <span>
          Latency: {lastQuery?.executionTimeMs == null ? "-" : `${lastQuery.executionTimeMs}ms`}
        </span>
        <span>
          Scope: {activeConnection?.name ?? "-"} /{" "}
          {selection.table ?? selection.schema ?? selection.database ?? "-"}
        </span>
      </div>
      <div className="flex items-center gap-4">
        <span className="inline-flex items-center gap-1">
          <ShieldCheck className="size-3.5" />
          Dangerous SQL requires confirm
        </span>
        <span className="inline-flex items-center gap-1">
          <TimerReset className="size-3.5" />
          {lastQuery?.statementTypes?.length
            ? lastQuery.statementTypes.join(", ")
            : "Pending changes: 0"}
        </span>
      </div>
    </footer>
  );
}
