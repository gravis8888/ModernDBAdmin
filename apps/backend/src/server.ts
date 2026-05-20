import Fastify from "fastify";
import type { FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";

import { env } from "./plugins/env";
import { registerAppRoleRoutes } from "./routes/app-roles.routes";
import { registerAppUserRoutes } from "./routes/app-users.routes";
import { registerAuthRoutes } from "./routes/auth.routes";
import { registerConnectionRoutes } from "./routes/connections.routes";
import { registerDashboardRoutes } from "./routes/dashboard.routes";
import { registerDbPrivilegeRoutes } from "./routes/db-privileges.routes";
import { registerDbUserRoutes } from "./routes/db-users.routes";
import { registerHealthRoutes } from "./routes/health.routes";
import { registerMetadataRoutes } from "./routes/metadata.routes";
import { registerMonitorRoutes } from "./routes/monitor.routes";
import { registerQueryRoutes } from "./routes/query.routes";
import { registerRowRoutes } from "./routes/rows.routes";
import { registerSqlBookmarkRoutes } from "./routes/sql-bookmarks.routes";
import { registerWorkbenchRoutes } from "./routes/workbench.routes";
import { sqlite } from "./db";
import { createAppServices } from "./services/app-services";
import { ApiError } from "./utils/api-error";

function isDatabaseOperationErrorCode(code: string) {
  return /^(MYSQL|POSTGRES)_(OPERATION_FAILED|UNKNOWN_ERROR|QUERY_TIMEOUT)$/.test(code);
}

async function createServer() {
  const app = Fastify({
    bodyLimit: 2_500_000,
    logger: {
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          'res.headers["set-cookie"]',
          "password",
          "*.password",
          "encryptedPassword",
          "*.encryptedPassword",
        ],
        remove: true,
      },
      transport:
        env.NODE_ENV === "development"
          ? {
              target: "pino-pretty",
              options: {
                colorize: true,
                translateTime: "SYS:standard",
              },
            }
          : undefined,
    },
  });

  await app.register(cors, {
    origin: env.CORS_ORIGIN,
    credentials: true,
  });
  await app.register(cookie);
  await app.register(helmet);
  await app.register(jwt, {
    secret: env.JWT_SECRET,
    cookie: {
      cookieName: "modern_db_admin_session",
      signed: false,
    },
  });
  await app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
  });
  await app.register(swagger, {
    openapi: {
      info: {
        title: "Modern DB Admin API",
        version: "0.1.0",
      },
    },
  });

  const services = createAppServices(app.log);
  app.decorate("services", services);
  app.decorateRequest("sessionUser", null);
  const loadSessionUser = (request: FastifyRequest) => {
    if (request.sessionUser) {
      return request.sessionUser;
    }

    const userId = request.user?.userId;
    if (!userId) {
      throw new ApiError(401, "AUTH_REQUIRED", "認証が必要です。");
    }

    const sessionUser = services.permissions.buildSessionUser(userId);
    request.sessionUser = sessionUser;
    return sessionUser;
  };
  app.addHook("onClose", async () => {
    await services.adapters.closeAll();
    if (sqlite.open) {
      sqlite.close();
    }
  });
  app.decorate("requireAuth", async (request) => {
    await request.jwtVerify();
    const sessionUser = loadSessionUser(request);
    if (!sessionUser.enabled) {
      throw new ApiError(403, "USER_DISABLED", "このユーザーは無効化されています。");
    }
  });
  app.decorate("currentSessionUser", (request) => loadSessionUser(request));
  app.decorate("authorize", (request, requiredPermissions, mode = "all") => {
    const sessionUser = app.currentSessionUser(request);
    services.permissions.assertPermissions(sessionUser, requiredPermissions, mode);
    return sessionUser;
  });
  await app.register(swaggerUi, {
    routePrefix: "/api/docs",
    uiHooks: {
      preHandler: app.requireAuth,
    },
  });

  await registerHealthRoutes(app);
  await registerAuthRoutes(app);
  await registerAppUserRoutes(app);
  await registerAppRoleRoutes(app);
  await registerConnectionRoutes(app);
  await registerDashboardRoutes(app);
  await registerMetadataRoutes(app);
  await registerRowRoutes(app);
  await registerQueryRoutes(app);
  await registerWorkbenchRoutes(app);
  await registerMonitorRoutes(app);
  await registerSqlBookmarkRoutes(app);
  await registerDbUserRoutes(app);
  await registerDbPrivilegeRoutes(app);

  app.setErrorHandler((error, _request, reply) => {
    const errorWithStatus =
      typeof error === "object" && error !== null && "statusCode" in error
        ? (error as { statusCode?: number })
        : null;
    const errorWithValidation =
      typeof error === "object" && error !== null && "validation" in error
        ? (error as { validation?: unknown })
        : null;
    const errorWithMessage =
      error instanceof Error
        ? error
        : typeof error === "object" && error !== null && "message" in error
          ? (error as { message?: string })
          : null;
    const statusCode =
      error instanceof ApiError
        ? error.statusCode
        : typeof errorWithStatus?.statusCode === "number"
          ? errorWithStatus.statusCode
          : 500;
    const code =
      error instanceof ApiError
        ? error.code
        : errorWithValidation?.validation
          ? "VALIDATION_ERROR"
          : "INTERNAL_SERVER_ERROR";
    const message =
      error instanceof ApiError
        ? error.message
        : statusCode >= 500
          ? "内部エラーが発生しました。"
          : (errorWithMessage?.message ?? "リクエストに失敗しました。");

    if (statusCode >= 500) {
      app.log.error(error);
    } else if (error instanceof ApiError && isDatabaseOperationErrorCode(error.code)) {
      app.log.warn(error);
    }

    reply.status(statusCode).send({
      error: {
        code,
        message,
        details:
          error instanceof ApiError && !isDatabaseOperationErrorCode(error.code)
            ? error.details
            : undefined,
      },
    });
  });

  app.get("/", async () => ({
    name: "Modern DB Admin Backend",
    docs: "/api/docs",
    health: "/api/health",
  }));

  return app;
}

const app = await createServer();
let shutdownPromise: Promise<void> | null = null;

async function shutdown(signal: NodeJS.Signals) {
  if (shutdownPromise) {
    return shutdownPromise;
  }

  shutdownPromise = (async () => {
    app.log.info({ signal }, "バックエンドを終了します");
    try {
      await app.close();
    } catch (error) {
      app.log.error({ err: error, signal }, "バックエンドの終了に失敗しました");
      process.exitCode = 1;
    }
  })();

  return shutdownPromise;
}

for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK"] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}

try {
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
} catch (error) {
  app.log.error(error);
  await shutdown("SIGTERM");
  process.exit(1);
}
