/// <reference types="@types/node" />

import fs from "node:fs";

type NilOr<T> = T | null | undefined;

const buffer = `
VITE_CLOUDFLARE_BEACON_TOKEN = '${process.env.VITE_CLOUDFLARE_BEACON_TOKEN}'
VITE_POSTHOG_TOKEN = '${process.env.VITE_POSTHOG_TOKEN}'`;

async function createEnvFile(): Promise<void> {
  return new Promise<void>((resolve) =>
    fs.writeFile(
      ".env.production",
      buffer,
      { encoding: "utf-8" },
      (err: NilOr<NodeJS.ErrnoException>) => {
        if (err) {
          throw err;
        } else {
          resolve(void 0);
        }
      },
    ),
  );
}

(async () => {
  await createEnvFile();
})();
