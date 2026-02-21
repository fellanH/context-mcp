/**
 * logger.js — Structured JSON request logging middleware.
 *
 * Generates a request ID (or reads from X-Request-Id header),
 * sets it on Hono context, and logs JSON after response completes.
 */

import { randomUUID } from "node:crypto";

/**
 * Hono middleware that logs each request as structured JSON.
 */
export function requestLogger() {
  return async (c, next) => {
    const requestId = c.req.header("x-request-id") || randomUUID();
    c.set("requestId", requestId);

    const start = Date.now();
    await next();
    const ms = Date.now() - start;

    console.log(
      JSON.stringify({
        level: "info",
        requestId,
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        ms,
        userId: c.get("user")?.userId || null,
        ts: new Date().toISOString(),
      }),
    );
  };
}
