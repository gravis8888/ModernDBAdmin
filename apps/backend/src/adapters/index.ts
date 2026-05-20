import type { DatabaseDialect } from "@modern-db-admin/shared";

import { ApiError } from "../utils/api-error";
import type { DatabaseAdapter } from "./database-adapter";
import { MySqlAdapter } from "./mysql-adapter";
import { PostgreSqlAdapter } from "./postgresql-adapter";

export class AdapterRegistry {
  private readonly adapters: Record<DatabaseDialect, DatabaseAdapter> = {
    mysql: new MySqlAdapter(),
    mariadb: new MySqlAdapter(),
    postgresql: new PostgreSqlAdapter(),
  };

  getAdapter(dialect: DatabaseDialect) {
    const adapter = this.adapters[dialect];
    if (!adapter) {
      throw new ApiError(400, "ADAPTER_NOT_FOUND", `未対応の DB 種別です: ${dialect}`);
    }

    return adapter;
  }

  async closeConnection(connectionId: string) {
    await Promise.all(
      Object.values(this.adapters).map((adapter) => adapter.closeConnection(connectionId)),
    );
  }

  async closeAll() {
    await Promise.all(Object.values(this.adapters).map((adapter) => adapter.closeAll()));
  }
}
