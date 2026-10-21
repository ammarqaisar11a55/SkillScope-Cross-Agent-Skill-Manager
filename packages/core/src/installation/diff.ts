import type { FileDiff } from '@skillscope/shared';
import type { SkillTreeFile } from '../inventory/files.js';

/** Compare two skill trees file by file (directories are ignored). */
export function diffTrees(current: SkillTreeFile[], incoming: SkillTreeFile[]): FileDiff[] {
  const a = new Map(
    current.filter((f) => f.kind !== 'directory').map((f) => [f.path, f.sha256] as const),
  );
  const b = new Map(
    incoming.filter((f) => f.kind !== 'directory').map((f) => [f.path, f.sha256] as const),
  );
  const out: FileDiff[] = [];
  for (const [path, hash] of b) {
    if (!a.has(path)) out.push({ path, change: 'added' });
    else out.push({ path, change: a.get(path) === hash ? 'unchanged' : 'modified' });
  }
  for (const path of a.keys()) if (!b.has(path)) out.push({ path, change: 'removed' });
  return out.sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
}
