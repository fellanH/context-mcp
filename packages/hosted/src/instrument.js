/**
 * Sentry initialization — must load before any other app code.
 *
 * Reads DSN from SENTRY_DSN env var only. Skips init if unset.
 * PII collection is disabled for production safety.
 */
import * as Sentry from "@sentry/node";

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    sendDefaultPii: false,
    environment: process.env.NODE_ENV || "development",
    release: process.env.npm_package_version || "unknown",
  });
} else {
  console.warn("[hosted] SENTRY_DSN not set — error tracking disabled");
}
