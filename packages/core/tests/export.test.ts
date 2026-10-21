import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { InventorySnapshot } from '@skillscope/shared';
import {
  AdapterRegistry,
  CSV_COLUMNS,
  EXPORT_SCHEMA,
  csvCell,
  exportInventory,
  scanInventory,
} from '../src/index.js';
import { adapterContext, cleanup, copyFixture } from './helpers.js';

/** Minimal RFC 4180 parser used to check that the CSV round-trips. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i] as string;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\r' && text[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i += 1;
    } else cell += c;
  }
  return rows;
}

describe('inventory export', () => {
  let home: string;
  let snapshot: InventorySnapshot;

  beforeEach(async () => {
    home = await copyFixture('home/basic');
    snapshot = await scanInventory(new AdapterRegistry(), adapterContext(home), {
      followSymlinks: true,
    });
  });
  afterEach(async () => cleanup(home));

  it('exports JSON that matches the inventory exactly', () => {
    const data = JSON.parse(exportInventory(snapshot, 'json'));
    expect(data.schema).toBe(EXPORT_SCHEMA);
    expect(data.skills).toHaveLength(snapshot.stats.uniqueSkills);
    expect(data.stats).toEqual(snapshot.stats);
    const availability = data.skills.reduce(
      (n: number, s: { agents: unknown[] }) => n + s.agents.length,
      0,
    );
    expect(availability).toBe(snapshot.stats.availabilityRecords);
    expect(data.note).toMatch(/does not prove/);
  });

  it('exports CSV with a header, one row per skill and paths preserved', () => {
    const rows = parseCsv(exportInventory(snapshot, 'csv'));
    expect(rows[0]).toEqual([...CSV_COLUMNS]);
    expect(rows).toHaveLength(snapshot.skills.length + 1);
    const pathIndex = CSV_COLUMNS.indexOf('path');
    expect(
      rows
        .slice(1)
        .map((r) => r[pathIndex])
        .sort(),
    ).toEqual(snapshot.skills.map((s) => s.path).sort());
  });

  it('escapes CSV cells and neutralises spreadsheet formulas', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell(null)).toBe('');
  });

  it('exports Markdown with escaped pipes and the detection disclaimer', () => {
    const tweaked: InventorySnapshot = {
      ...snapshot,
      skills: snapshot.skills.map((s, i) => (i === 0 ? { ...s, name: 'pipe|name' } : s)),
    };
    const md = exportInventory(tweaked, 'markdown');
    expect(md).toContain('# SkillScope inventory report');
    expect(md).toContain('pipe\\|name');
    expect(md).toContain('does not prove');
    const tableRows = md
      .split('\n')
      .filter((l) => l.startsWith('| ') && !l.startsWith('| Name') && !l.startsWith('| ---'));
    expect(tableRows).toHaveLength(snapshot.skills.length);
  });
});
