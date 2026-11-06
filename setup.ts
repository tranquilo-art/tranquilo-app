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
    { zone: "tranquilo.art" }
  );
  const cert = new Cert("aws", dns);
  const bucket = new BlobStore(
    "aws",
    "s3://web.tranquilo.art"
  );
  const cdn = new CDN(
    "aws",
    cert,
    { bucket }
  );
  await cdn.url();
}

{ // api
  const secrets = new SecretStore("aws", { service: "ssm" });
  const env = secrets.path("/cloudgear/tranquilo-app");
  const dns = new DNS(
    "gandi",
    "api.prod.tranquilo.art",
    { zone: "tranquilo.art" }
  );
  const cert = new Cert("aws", dns);

  const router = new FunctionRouter("aws", {
    authenticated: "iam",
    mode: "remote",
    region: "us-east-1",
  })
    .url("GET", "/api/items", "./api/items.ts", {
      request: true,
      response: VercelResponse,
      env: env({
        DATABASE_URL: "DATABASE_URL",
        ITEMS_CURSOR_SECRET: "ITEMS_CURSOR_SECRET",
        PRINT_REGION_DEV_COUNTRY: "PRINT_REGION_DEV_COUNTRY",
        SENTRY_DSN: "SENTRY_DSN",
        SENTRY_TRACES_SAMPLE_RATE: "SENTRY_TRACES_SAMPLE_RATE",
        VERCEL_ENV: "VERCEL_ENV",
      }),
    })
    .url("POST", "/api/submit-collection", "./api/submit-collection.ts", {
      request: true,
      response: VercelResponse,
      env: env({
        RESEND_API_KEY: "RESEND_API_KEY",
        SUBMIT_NOTIFY_EMAIL: "SUBMIT_NOTIFY_EMAIL",
        RESEND_FROM_EMAIL: "RESEND_FROM_EMAIL",
        SENTRY_DSN: "SENTRY_DSN",
        SENTRY_TRACES_SAMPLE_RATE: "SENTRY_TRACES_SAMPLE_RATE",
        VERCEL_ENV: "VERCEL_ENV",
      }),
    })
    .url("POST", "/api/subscribe", "./api/subscribe.ts", {
      request: true,
      response: VercelResponse,
      env: env({
        RESEND_API_KEY: "RESEND_API_KEY",
        SENTRY_DSN: "SENTRY_DSN",
        SENTRY_TRACES_SAMPLE_RATE: "SENTRY_TRACES_SAMPLE_RATE",
        VERCEL_ENV: "VERCEL_ENV",
      }),
    })
    .url("POST", "/api/track", "./api/track.ts", {
      request: true,
      response: VercelResponse,
      env: env({
        DATABASE_URL: "DATABASE_URL",
        SENTRY_DSN: "SENTRY_DSN",
        SENTRY_TRACES_SAMPLE_RATE: "SENTRY_TRACES_SAMPLE_RATE",
        VERCEL_ENV: "VERCEL_ENV",
      }),
    })
    .url("POST", "/api/webhooks/resend", "./api/webhooks/resend.ts", {
      request: true,
      response: VercelResponse,
      env: env({
        RESEND_API_KEY: "RESEND_API_KEY",
        SUBMIT_NOTIFY_EMAIL: "SUBMIT_NOTIFY_EMAIL",
        RESEND_WEBHOOK_SECRET: "RESEND_WEBHOOK_SECRET",
        OPS_ALERT_EMAIL: "OPS_ALERT_EMAIL",
        RESEND_FROM_EMAIL: "RESEND_FROM_EMAIL",
        SENTRY_DSN: "SENTRY_DSN",
        SENTRY_TRACES_SAMPLE_RATE: "SENTRY_TRACES_SAMPLE_RATE",
        VERCEL_ENV: "VERCEL_ENV",
      }),
    })
    .url("POST", "/api/webhooks/patreon", "/api/webhooks/patreon.ts", {
      request: true,
      response: VercelResponse,
      env: env({
        DATABASE_URL: "DATABASE_URL",
        PATREON_WEBHOOK_SECRET: "PATREON_WEBHOOK_SECRET",
        SENTRY_DSN: "SENTRY_DSN",
        SENTRY_TRACES_SAMPLE_RATE: "SENTRY_TRACES_SAMPLE_RATE",
        VERCEL_ENV: "VERCEL_ENV",
      }),
    })
    .url("GET", "/sitemap.xml", "./api/sitemap.ts", {
      request: true,
      response: VercelResponse,
      env: env({
        DATABASE_URL: "DATABASE_URL",
        SENTRY_DSN: "SENTRY_DSN",
        SENTRY_TRACES_SAMPLE_RATE: "SENTRY_TRACES_SAMPLE_RATE",
        VERCEL_ENV: "VERCEL_ENV",
      }),
    })
    .url("GET", "/v/{slug}", "./api/v/[slug].ts", {
      include: "./dist/index.html",
      request: true,
      response: VercelResponse,
      env: env({
        DATABASE_URL: "DATABASE_URL",
        SENTRY_DSN: "SENTRY_DSN",
        SENTRY_TRACES_SAMPLE_RATE: "SENTRY_TRACES_SAMPLE_RATE",
        VERCEL_ENV: "VERCEL_ENV",
      }),
    })
    .url("GET", "/s/{slug}", "./api/v/[slug].ts", {
      include: "./dist/index.html",
      request: true,
      response: VercelResponse,
      env: env({
        DATABASE_URL: "DATABASE_URL",
        SENTRY_DSN: "SENTRY_DSN",
        SENTRY_TRACES_SAMPLE_RATE: "SENTRY_TRACES_SAMPLE_RATE",
        VERCEL_ENV: "VERCEL_ENV",
      }),
    })
    .url("GET", "/img/{source}/{id}/{tier}", "./api/img/[source]/[id]/[tier].ts", {
      request: true,
      response: VercelResponse,
      env: env({
        DATABASE_URL: "DATABASE_URL",
        BLOB_READ_WRITE_TOKEN: "BLOB_READ_WRITE_TOKEN",
        BLOB_USAGE_SOFT_CAP_BYTES: "BLOB_USAGE_SOFT_CAP_BYTES",
        IMG_ADMIT_FASTPATH_REQUESTS: "IMG_ADMIT_FASTPATH_REQUESTS",
        IMG_ADMIT_FASTPATH_WINDOW_SECONDS: "IMG_ADMIT_FASTPATH_WINDOW_SECONDS",
        ITEMS_CURSOR_SECRET: "ITEMS_CURSOR_SECRET",
        SENTRY_DSN: "SENTRY_DSN",
        SENTRY_TRACES_SAMPLE_RATE: "SENTRY_TRACES_SAMPLE_RATE",
        VERCEL_ENV: "VERCEL_ENV",
      }),
    })
    .url("GET", "/og/{slug}.png", "./api/og/[slug].ts", {
      request: true,
      response: VercelResponse,
      env: env({
        DATABASE_URL: "DATABASE_URL",
        ITEMS_CURSOR_SECRET: "DATABASE_URL",
        SENTRY_DSN: "DATABASE_URL",
        SENTRY_TRACES_SAMPLE_RATE: "DATABASE_URL",
        VERCEL_ENV: "VERCEL_ENV"
      }),
    })
    // cron jobs
    .url("GET", "/api/cron", "./api/cron/index.ts", {
      request: true,
      response: VercelResponse,
      env: env({
        DATABASE_URL: "DATABASE_URL",
        BLOB_READ_WRITE_TOKEN: "BLOB_READ_WRITE_TOKEN",
        CRON_SECRET: "CRON_SECRET",
        GITHUB_BACKUP_TOKEN: "GITHUB_BACKUP_TOKEN",
        OPS_ALERT_EMAIL: "OPS_ALERT_EMAIL",
        RESEND_API_KEY: "RESEND_API_KEY",
        RESEND_FROM_EMAIL: "RESEND_FROM_EMAIL",
        SENTRY_DSN: "SENTRY_DSN",
        SENTRY_TRACES_SAMPLE_RATE: "SENTRY_TRACES_SAMPLE_RATE",
        SUBMIT_NOTIFY_EMAIL: "SUBMIT_NOTIFY_EMAIL",
        VERCEL_API_TOKEN: "VERCEL_API_TOKEN",
        VERCEL_ENV: "VERCEL_ENV",
        VERCEL_ORG_ID: "VERCEL_ORG_ID",
        VERCEL_PROJECT_ID: "VERCEL_PROJECT_ID",
        VERCEL_TEAM_ID: "VERCEL_TEAM_ID",
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
    { router }
  );

  await cdn.url();
}

{ // cdn
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
    { bucket }
  );
  await cdn.url();
}
