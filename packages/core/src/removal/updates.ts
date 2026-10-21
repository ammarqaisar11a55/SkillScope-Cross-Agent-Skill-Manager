import semver from 'semver';
import type { InstallPlan, InstallationReceipt, UpdateCheck } from '@skillscope/shared';
import type { StagedPackage } from '../packages/acquire.js';
import type { NpmRegistryClient } from '../packages/registry.js';

/** Compare each installed receipt with the registry's `latest` dist-tag. */
export async function checkUpdates(
  client: NpmRegistryClient,
  receipts: InstallationReceipt[],
): Promise<UpdateCheck[]> {
  const latestByPackage = new Map<string, { latest: string | null; error: string | null }>();
  for (const name of new Set(receipts.map((r) => r.packageName))) {
    try {
      const doc = await client.packument(name);
      latestByPackage.set(name, { latest: doc['dist-tags']?.latest ?? null, error: null });
    } catch (error) {
      latestByPackage.set(name, { latest: null, error: (error as Error).message });
    }
  }
  return receipts.map((r) => {
    const info = latestByPackage.get(r.packageName) ?? { latest: null, error: null };
    const updateAvailable =
      info.latest !== null &&
      semver.valid(info.latest) !== null &&
      semver.valid(r.version) !== null &&
      semver.gt(info.latest, r.version);
    return {
      receiptId: r.id,
      packageName: r.packageName,
      skillName: r.skillName,
      installed: r.version,
      latest: info.latest,
      updateAvailable,
      error: info.error,
    };
  });
}

/** An update replaces exactly one managed destination with the same skill from a newer version. */
export function updatePlan(receipt: InstallationReceipt, staged: StagedPackage): InstallPlan {
  return {
    id: `plan_update_${receipt.id}`,
    stagingId: staged.inspection.stagingId,
    packageName: staged.inspection.name,
    version: staged.inspection.version,
    integrity: staged.inspection.integrity.expected,
    targets: [
      {
        id: `tgt_${receipt.id}`,
        skillName: receipt.skillName,
        agentIds: [...receipt.agentIds],
        scope: receipt.scope,
        rootId: receipt.rootId,
        rootPath: receipt.rootPath,
        destination: receipt.destination,
        shared: receipt.agentIds.length > 1,
        note: null,
        conflict: {
          kind: 'managed',
          existingPath: receipt.destination,
          existingHash: receipt.contentHash,
          incomingHash: '',
          identical: false,
          diff: [],
          receiptId: receipt.id,
        },
      },
    ],
    warnings: [],
    createdAt: new Date().toISOString(),
  };
}
