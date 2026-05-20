import { Outlet } from "react-router-dom";
import { Group, Panel, Separator } from "react-resizable-panels";

import { SidebarTree } from "./sidebar-tree";
import { StatusBar } from "./status-bar";
import { Topbar } from "./topbar";

export function AppShell() {
  return (
    <div className="flex h-screen flex-col bg-[var(--background)] text-[var(--foreground)]">
      <Topbar />
      <div className="min-h-0 flex-1">
        <Group orientation="horizontal">
          <Panel defaultSize={22} minSize={18}>
            <SidebarTree />
          </Panel>
          <Separator className="w-px bg-[var(--border)]" />
          <Panel defaultSize={78}>
            <main className="app-shell-bg h-full overflow-y-auto">
              <div className="mx-auto w-full max-w-[1900px] px-5 py-5">
                <Outlet />
              </div>
            </main>
          </Panel>
        </Group>
      </div>
      <StatusBar />
    </div>
  );
}
