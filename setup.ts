import { DNS } from "@cloudgear/dns";
import { SecretStore } from "@cloudgear/secrets";
import { cron, permissions, policy } from "@cloudgear/core";
import { BlobStore } from "@cloudgear/blob";
import { Cert, CDN } from "@cloudgear/cdn";
import { FunctionRouter, VercelResponse } from "@cloudgear/functions";

{ // web
   const dns = new DNS(
    "gandi",
    "web.tranquilo.art",
    { zone: "tranquilo.art" },
  );
  const cert = new Cert("aws", dns);
  const bucket = new BlobStore(
    "aws",
    "s3://web.tranquilo.art",
  );
  const cdn = new CDN(
    "aws",
    cert,
    { webAcl: true, bucket, options: {
      default_root_object: ""
    } }
  );
  await cdn.url();
}

const $functions = async () => {
  const secrets = new SecretStore("aws", { service: "ssm" });
  const env = secrets.path("/cloudgear/tranquilo-app");
  const dns = new DNS(
    "gandi",
    "api.tranquilo.art",
    { zone: "tranquilo.art" }
  );
  const cert = new Cert("aws", dns);

  const router = new FunctionRouter("aws", {
    authenticated: "iam",
    mode: "remote",
    region: "us-east-1",
    optionalEnv: [
      "BLOB_USAGE_SOFT_CAP_BYTES",
      "IMG_ADMIT_FASTPATH_REQUESTS",
      "IMG_ADMIT_FASTPATH_WINDOW_SECONDS",
      "ITEMS_CURSOR_SECRET",
      "OPS_ALERT_EMAIL",
      "PRINT_REGION_DEV_COUNTRY",
      "RESEND_FROM_EMAIL",
      "VERCEL_TEAM_ID",
      "SENTRY_DSN",
    ],
  })
    .url("*", "/",  "./api/index.ts", {
      include: [
        "./dist/index.html",
      ],
      request: true,
      response: VercelResponse,
      env: env({
        BLOB_READ_WRITE_TOKEN: "BLOB_READ_WRITE_TOKEN",
        DATABASE_URL: "DATABASE_URL",
        PATREON_WEBHOOK_SECRET: "PATREON_WEBHOOK_SECRET",
        RESEND_API_KEY: "RESEND_API_KEY",
        RESEND_WEBHOOK_SECRET: "RESEND_WEBHOOK_SECRET",
        SENTRY_DSN: "SENTRY_DSN",
        SENTRY_TRACES_SAMPLE_RATE: "SENTRY_TRACES_SAMPLE_RATE",
        SUBMIT_NOTIFY_EMAIL: "SUBMIT_NOTIFY_EMAIL",
        VERCEL_ENV: "VERCEL_ENV",

      }),
    })
    // cron jobs
    .url("GET", "/api/cron", "./api/cron/index.ts", {
      request: true,
      response: VercelResponse,
      env: env({
        BLOB_READ_WRITE_TOKEN: "BLOB_READ_WRITE_TOKEN",
        CRON_SECRET: "CRON_SECRET",
        DATABASE_URL: "DATABASE_URL",
        GITHUB_BACKUP_TOKEN: "GITHUB_BACKUP_TOKEN",
        RESEND_API_KEY: "RESEND_API_KEY",
        SENTRY_DSN: "SENTRY_DSN",
        SENTRY_TRACES_SAMPLE_RATE: "SENTRY_TRACES_SAMPLE_RATE",
        SUBMIT_NOTIFY_EMAIL: "SUBMIT_NOTIFY_EMAIL",
        VERCEL_API_TOKEN: "VERCEL_API_TOKEN",
        VERCEL_ENV: "VERCEL_ENV",
        VERCEL_ORG_ID: "VERCEL_ORG_ID",
        VERCEL_PROJECT_ID: "VERCEL_PROJECT_ID",
      }),
      schedule: [
        { cron: cron`11 9 1 1,4,7,10 *`, query: { job: "analytics-report", days: "92", label: "Quarterly" } },
        { cron: cron` 7 9 1 * *`, query: { job: "analytics-report", days: "30", label: "Monthly" } },
        { cron: cron`27 7 * * *`, query: { job: "db-backup" } },
        { cron: cron`41 3 * * *`, query: { job: "db-backup", task: "reshuffle" } },
        { cron: cron`13 8 * * *`, query: { job: "health-check" } },
        { cron: cron`19 4 * * *`, query: { job: "vercel-deployment-cleanup", commit: "1" } },
      ],
    })
  ;

  const cdn = new CDN(
    "aws",
    cert,
    { webAcl: true, router }
  );

  await cdn.url();

  return cdn;
}

const $cdn = async () => {
  const dns = new DNS(
    "gandi",
    "cdn.prod.tranquilo.art",
    { zone: "tranquilo.art" }
  );
  const cert = new Cert("aws", dns);
  const bucket = new BlobStore(
    "aws",
    "s3://cdn.prod.tranquilo.art"
  );
  const cdn = new CDN(
    "aws",
    cert,
    { webAcl: true, bucket, options: {
      default_root_object: "",
    } }
  );
  await cdn.url();

  return cdn;
}

export {
  /**
   * import { $cdn } from "./setup.ts";
   *
   * const cdn = await $cdn();
   * const response = await cdn.fetch("xyz");
   */
  $cdn,

  /**
   * import { $functions } from "./setup.ts";
   *
   * const functions = await $functions();
   * const response = await functions.fetch("/?path=api/items", {
   *   headers: {},
   *   body: JSON.stringify({}),
   *   method: "POST",
   * });
   */
  $functions,
}
