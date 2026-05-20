import type { FastifyInstance, FastifyReply } from "fastify";

import { authLoginSchema, authSetupSchema } from "@modern-db-admin/shared";

import { env } from "../plugins/env";

const sessionMaxAgeSeconds = 60 * 60 * 12;
const loginRateLimit = { max: 10, timeWindow: "1 minute" };
const setupRateLimit = { max: 5, timeWindow: "1 minute" };

function setSessionCookie(reply: FastifyReply, token: string) {
  reply.setCookie("modern_db_admin_session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: sessionMaxAgeSeconds,
  });
}

export async function registerAuthRoutes(app: FastifyInstance) {
  app.get("/api/auth/status", async () => ({
    setupCompleted: app.services.auth.isSetupCompleted(),
  }));

  app.post("/api/auth/setup", { config: { rateLimit: setupRateLimit } }, async (request, reply) => {
    const input = authSetupSchema.parse(request.body);
    const sessionUser = await app.services.auth.setupInitialAdmin(input);
    const token = await reply.jwtSign(
      { userId: sessionUser.id },
      {
        expiresIn: sessionMaxAgeSeconds,
      },
    );

    setSessionCookie(reply, token);

    return {
      setupCompleted: true,
      user: sessionUser,
    };
  });

  app.post("/api/auth/login", { config: { rateLimit: loginRateLimit } }, async (request, reply) => {
    const input = authLoginSchema.parse(request.body);
    const sessionUser = await app.services.auth.authenticate(input);
    const token = await reply.jwtSign(
      { userId: sessionUser.id },
      {
        expiresIn: sessionMaxAgeSeconds,
      },
    );

    setSessionCookie(reply, token);

    return {
      user: sessionUser,
    };
  });

  app.post("/api/auth/logout", async (_request, reply) => {
    reply.clearCookie("modern_db_admin_session", { path: "/" });
    return { ok: true };
  });

  app.get("/api/auth/me", { preHandler: app.requireAuth }, async (request) => ({
    setupCompleted: app.services.auth.isSetupCompleted(),
    user: app.currentSessionUser(request),
  }));
}
