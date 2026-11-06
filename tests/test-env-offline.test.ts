// Unit tests run offline even when the shell has production credentials loaded.
import { describe, expect, it } from "vitest";
import { Sentry } from "../lib/sentry.ts";

const PRODUCTION_ONLY = [
  "SENTRY_DSN",
  "VERCEL_ENV",
  "DATABASE_URL",
  "RESEND_API_KEY",
  "RESEND_WEBHOOK_SECRET",
  "SUBMIT_NOTIFY_EMAIL",
  "OPS_ALERT_EMAIL",
  "VERCEL_API_TOKEN",
  "DB_BACKUP_S3_BUCKET",
  "DB_BACKUP_S3_REGION",
  "DB_BACKUP_S3_ACCESS_KEY_ID",
  "DB_BACKUP_S3_SECRET_ACCESS_KEY",
  "BLOB_READ_WRITE_TOKEN",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "CRON_SECRET",
  "FIREWALL_BYPASS_TOKEN",
];

describe("unit test environment", () => {
  it("never initialises Sentry with a DSN", () => {
    expect(Sentry.getClient()?.getDsn()).toBeUndefined();
  });

  it.each(PRODUCTION_ONLY)("blanks %s", (name) => {
    expect(process.env[name] ?? "").toBe("");
  });
});
