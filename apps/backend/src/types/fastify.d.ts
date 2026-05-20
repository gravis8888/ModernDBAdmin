import type { AppPermission, SessionUser } from "@modern-db-admin/shared";
import type { FastifyReply } from "fastify";

import type { AppServices } from "../services/app-services";

declare module "fastify" {
  interface FastifyInstance {
    services: AppServices;
    requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void>;
    currentSessionUser(request: FastifyRequest): SessionUser;
    authorize(
      request: FastifyRequest,
      requiredPermissions: AppPermission[],
      mode?: "all" | "any",
    ): SessionUser;
  }

  interface FastifyRequest {
    sessionUser?: SessionUser | null;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: {
      userId: string;
    };
    user: {
      userId: string;
    };
  }
}
