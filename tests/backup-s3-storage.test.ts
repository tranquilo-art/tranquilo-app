// Backup S3 config gating and the retention sweep. Signing and transport
// are covered in tests/img-s3-signing.test.ts.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/img-s3.ts", () => ({
  deleteObject: vi.fn(),
  getObject: vi.fn(),
  listObjects: vi.fn(),
  putObject: vi.fn(),
}));

const s3 = await import("../lib/img-s3.ts");
const { backupS3ConfigFromEnv, pruneOldBackups } = await import(
  "../lib/cron/db-backup.ts"
);

const listObjects = vi.mocked(s3.listObjects);
const deleteObject = vi.mocked(s3.deleteObject);

const config = {
  bucket: "tranquilo-db-backups",
  region: "us-east-1",
  accessKeyId: "AKIAEXAMPLE",
  secret: () => "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
};

describe("backupS3ConfigFromEnv", () => {
  const FULL_ENV = {
    DB_BACKUP_S3_BUCKET: "tranquilo-db-backups",
    DB_BACKUP_S3_REGION: "us-east-1",
    DB_BACKUP_S3_ACCESS_KEY_ID: "AKIAEXAMPLE",
    DB_BACKUP_S3_SECRET_ACCESS_KEY: "shh",
  };

  it("is enabled only when all four vars are present", () => {
    expect(backupS3ConfigFromEnv(FULL_ENV).enabled).toBe(true);
    for (const key of Object.keys(FULL_ENV)) {
      const partial = { ...FULL_ENV, [key]: "" };
      expect(
        backupS3ConfigFromEnv(partial).enabled,
        `missing ${key} should disable it`,
      ).toBe(false);
    }
  });

  it("never exposes the secret as an enumerable property", () => {
    const config = backupS3ConfigFromEnv(FULL_ENV);
    expect(JSON.stringify(config)).not.toContain("shh");
    expect(Object.keys(config)).not.toContain("secret");
    expect(config.secret()).toBe("shh");
  });
});

describe("pruneOldBackups", () => {
  beforeEach(() => {
    listObjects.mockReset();
    deleteObject.mockReset();
  });

  function withKeys(keys: string[]) {
    listObjects.mockResolvedValueOnce({ ok: true, status: 200, keys: keys });
  }

  it("deletes dated backups past the retention window", async () => {
    const old = "2020-01-01";
    withKeys([`backups/items/${old}.json.gz`, "backups/items/latest.json.gz"]);
    deleteObject.mockResolvedValue({ ok: true, status: 204 });

    await pruneOldBackups(config);

    expect(deleteObject).toHaveBeenCalledTimes(1);
    expect(deleteObject).toHaveBeenCalledWith(
      config,
      `backups/items/${old}.json.gz`,
    );
  });

  it("never deletes latest.json.gz", async () => {
    withKeys(["backups/items/latest.json.gz"]);
    await pruneOldBackups(config);
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("keeps a backup within the retention window", async () => {
    const today = new Date().toISOString().slice(0, 10);
    withKeys([`backups/items/${today}.json.gz`]);
    await pruneOldBackups(config);
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("does nothing on the first run ever, an empty bucket", async () => {
    withKeys([]);
    await pruneOldBackups(config);
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("throws on a listing failure, rather than silently skipping the sweep", async () => {
    listObjects.mockResolvedValueOnce({ ok: false, status: 403 });
    await expect(pruneOldBackups(config)).rejects.toThrow(/HTTP 403/);
  });

  it("throws on a delete failure", async () => {
    withKeys(["backups/items/2020-01-01.json.gz"]);
    deleteObject.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(pruneOldBackups(config)).rejects.toThrow(/HTTP 500/);
  });
});
