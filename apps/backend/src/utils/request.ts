import type { FastifyRequest } from "fastify";
import type { ZodType } from "zod";

export function parseRequestParams<T>(request: FastifyRequest, schema: ZodType<T>) {
  return schema.parse(request.params);
}

export function parseRequestQuery<T>(request: FastifyRequest, schema: ZodType<T>) {
  return schema.parse(request.query);
}
