// selectDeploymentsToDelete() is the pure decision logic behind the
// vercel-deployment-cleanup cron (dispatched via the lib/cron/ pattern):
// given the full deployment list, which ones are safe to delete. No network,
// so this is tested directly against fake deployment objects rather than a
// live Vercel account.
import { describe, expect, it } from "vitest";
import {
  KEEP_COUNT,
  selectDeploymentsToDelete,
} from "../lib/cron/vercel-deployment-cleanup.ts";

function deployment(uid: string, createdAt: number, opts?: any) {
  const options = opts || {};
  return {
    uid: uid,
    createdAt: createdAt,
    state: options.state || "READY",
    target: options.target || null,
  };
}

describe("selectDeploymentsToDelete", () => {
  it("keeps the most recent KEEP_COUNT deployments and deletes the rest", () => {
    const deployments = [];
    for (let i = 0; i < KEEP_COUNT + 5; i++) {
      deployments.push(deployment(`d${i}`, 1000 - i));
    }

    const toDelete = selectDeploymentsToDelete(deployments);

    expect(toDelete.length).toBe(5);
    // The 5 oldest (smallest createdAt).
    const deletedIds = toDelete.map((d: any) => d.uid).sort();
    expect(deletedIds).toEqual(["d10", "d11", "d12", "d13", "d14"]);
  });

  it("never selects the production deployment, even if it falls outside the keep window", () => {
    const deployments = [];
    for (let i = 0; i < KEEP_COUNT + 5; i++) {
      deployments.push(deployment(`d${i}`, 1000 - i));
    }
    deployments[deployments.length - 1].target = "production";

    const toDelete = selectDeploymentsToDelete(deployments);

    expect(toDelete.map((d: any) => d.uid)).not.toContain("d14");
    expect(toDelete.length).toBe(4);
  });

  it("never selects a deployment that is still building", () => {
    const deployments = [];
    for (let i = 0; i < KEEP_COUNT + 3; i++) {
      deployments.push(deployment(`d${i}`, 1000 - i));
    }
    deployments[deployments.length - 1].state = "BUILDING";
    deployments[deployments.length - 2].state = "QUEUED";

    const toDelete = selectDeploymentsToDelete(deployments);

    expect(toDelete.map((d: any) => d.uid)).toEqual(["d10"]);
  });

  it("deletes nothing when there are KEEP_COUNT or fewer deployments", () => {
    const deployments = [];
    for (let i = 0; i < KEEP_COUNT; i++) {
      deployments.push(deployment(`d${i}`, 1000 - i));
    }

    expect(selectDeploymentsToDelete(deployments)).toEqual([]);
  });
});
