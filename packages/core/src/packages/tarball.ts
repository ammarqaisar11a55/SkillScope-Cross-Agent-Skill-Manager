import { gunzipSync } from 'node:zlib';
import { extract as tarExtract } from 'tar-stream';
import { SkillScopeError } from '@skillscope/shared';

export const ARCHIVE_LIMITS = {
  maxEntries: 5_000,
  maxFileBytes: 20 * 1024 * 1024,
  maxTotalBytes: 100 * 1024 * 1024,
  maxPathLength: 240,
};

export interface ArchiveFile {
  /** Package-relative POSIX path (first path segment, normally "package/", removed). */
  path: string;
  data: Buffer;
  executable: boolean;
}

function unsafe(message: string): SkillScopeError {
  return new SkillScopeError('UNSAFE_ARCHIVE', `Unsafe package archive: ${message}`, {
    hint: 'The package was rejected and nothing was written outside the temporary folder. Report it to the maintainer.',
  });
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/**
 * Validate one archive path and strip npm's leading folder. Rejects absolute paths, drive letters,
 * backslashes, traversal, control characters and names Windows cannot represent.
 */
export function sanitizeArchivePath(raw: string): string | null {
  if (raw.includes('\0')) throw unsafe(`entry name contains a NUL byte`);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(raw))
    throw unsafe(`entry "${JSON.stringify(raw)}" contains control characters`);
  if (raw.includes('\\')) throw unsafe(`entry "${raw}" uses backslashes`);
  if (raw.startsWith('/') || /^[A-Za-z]:/.test(raw))
    throw unsafe(`entry "${raw}" is an absolute path`);
  const segments = raw.split('/').filter((s) => s !== '' && s !== '.');
  if (segments.some((s) => s === '..'))
    throw unsafe(`entry "${raw}" tries to leave the package directory`);
  if (segments.length <= 1) return null; // the top-level folder itself
  const rel = segments.slice(1);
  for (const seg of rel) {
    if (WINDOWS_RESERVED.test(seg) || /[<>:"|?*]/.test(seg) || /[. ]$/.test(seg)) {
      throw unsafe(`entry "${raw}" has a name that is not portable to Windows`);
    }
  }
  const out = rel.join('/');
  if (out.length > ARCHIVE_LIMITS.maxPathLength)
    throw unsafe(`entry "${raw}" has an overly long path`);
  return out;
}

/**
 * Parse a gzipped npm tarball entirely in memory. Only regular files and directories are
 * accepted; symlinks, hard links, devices and FIFOs cause the whole archive to be rejected.
 */
export async function readTarball(gz: Uint8Array): Promise<ArchiveFile[]> {
  let tar: Buffer;
  try {
    tar = gunzipSync(gz, { maxOutputLength: ARCHIVE_LIMITS.maxTotalBytes + 1024 * 1024 });
  } catch (error) {
    const msg = (error as Error).message;
    throw unsafe(
      /maxOutputLength|buffer/i.test(msg)
        ? 'it expands beyond the size limit'
        : `it is not a valid gzip file (${msg})`,
    );
  }

  const files: ArchiveFile[] = [];
  const seen = new Set<string>();
  let total = 0;
  let entries = 0;
  const extractor = tarExtract();
  const done = (async () => {
    for await (const entry of extractor) {
      const header = entry.header;
      entries += 1;
      if (entries > ARCHIVE_LIMITS.maxEntries)
        throw unsafe(`more than ${ARCHIVE_LIMITS.maxEntries} entries`);
      const rel = sanitizeArchivePath(header.name);
      const type = header.type ?? 'file';
      if (type === 'directory') {
        entry.resume();
        continue;
      }
      if (type !== 'file' && type !== 'contiguous-file') {
        throw unsafe(`entry "${header.name}" is a ${type}; only regular files are allowed`);
      }
      if (rel === null) throw unsafe(`file "${header.name}" is outside the package folder`);
      const key = rel.toLowerCase();
      if (seen.has(key))
        throw unsafe(`entry "${rel}" appears more than once (or differs only by case)`);
      seen.add(key);
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of entry) {
        size += (chunk as Buffer).length;
        if (size > ARCHIVE_LIMITS.maxFileBytes) throw unsafe(`file "${rel}" is larger than 20 MB`);
        chunks.push(chunk as Buffer);
      }
      total += size;
      if (total > ARCHIVE_LIMITS.maxTotalBytes)
        throw unsafe('the unpacked package is larger than 100 MB');
      files.push({
        path: rel,
        data: Buffer.concat(chunks),
        executable: ((header.mode ?? 0o644) & 0o111) !== 0,
      });
    }
  })();
  extractor.end(tar);
  try {
    await done;
  } catch (error) {
    extractor.destroy();
    if (error instanceof SkillScopeError) throw error;
    throw unsafe(`it is not a valid tar archive (${(error as Error).message})`);
  }
  // A file and a directory with the same name (e.g. "a" and "a/b") cannot both exist on disk.
  for (const f of files) {
    const parts = f.path.toLowerCase().split('/');
    for (let i = 1; i < parts.length; i += 1) {
      if (seen.has(parts.slice(0, i).join('/'))) throw unsafe(`"${f.path}" is nested under a file`);
    }
  }
  return files;
}
