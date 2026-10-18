// @vitest-environment node
import { createPublicKey, createVerify, generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COLUMNS, MSG, buildRow, colLetter, detectDateFormat, detroitDay, findHeader, formatDate, googleSheets, googleToken, guessTrack,
  columnOptions, dropTrailingNulls, hasDuplicate, parseInput, pickTable, rowHash, safeCell, resetTokenCache, resolveRow, rowFromUpdatedRange,
  runOp, signJwt, startColumn, statusOptions, type AppMatch, type AppRow, type Cell, type StatusPatch, type Table, type AppStore, type NewApplication, type PostingRow, type SheetsApi,
} from '../../api/sheet';

const HEADER = ['Company', 'Role / title', 'Track', 'Start / term', 'Location', 'Status', 'Priority', 'Applied date'];
const TITLE = [['Adam Kuhn - Application Tracker'], ['Records logged', '80'], [], []];
const VALUES = (): string[][] => [
  ...TITLE,
  HEADER, // row 5
  ['Greenboard', 'Software Engineer - 2027 Grads', 'New grad', '2027', '', 'Submitted', 'Unranked', '10/7/2026'], // row 6
  ['Ramp', 'Software Engineer Intern', 'Internship', 'Summer 2027', 'New York, NY', 'Applied', 'Unranked', '10/8/2026'], // row 7
];
const opt = (v: string) => ({ userEnteredValue: v });
const list = (...vs: string[]) => ({ condition: { type: 'ONE_OF_LIST', values: vs.map(opt) } });
const META = {
  sheets: [{
    // first data row A6:Z6; only the Status cell (F) has validation
    data: [{ startColumn: 0, rowData: [{ values: [{}, {}, {}, {}, {}, { dataValidation: list('Submitted', 'Applied') }] }] }],
    tables: [{
      name: 'OtherTable', range: { startRowIndex: 100, endRowIndex: 120, startColumnIndex: 0, endColumnIndex: 3 },
      columnProperties: [{ columnName: 'Status', dataValidationRule: list('Elsewhere') }],
    }, {
      name: 'ApplicationsTable', range: { sheetId: 1, startRowIndex: 4, endRowIndex: 7, startColumnIndex: 0, endColumnIndex: 8 },
      columnProperties: [
        { columnIndex: 0, columnName: 'Company' },
        { columnIndex: 5, columnName: 'Status', columnType: 'DROPDOWN', dataValidationRule: { condition: { type: 'ONE_OF_LIST', values: [opt('Applied'), opt('OA invited'), opt('Rejected after OA')] } } },
        { columnIndex: 6, columnName: 'Priority', columnType: 'DROPDOWN', dataValidationRule: { condition: { type: 'ONE_OF_LIST', values: [opt('Unranked'), opt('Top')] } } },
      ],
    }],
  }],
};

describe('COLUMNS', () => {
  it('uses the same header aliases as worker sheet.py', () => {
    const py = readFileSync(fileURLToPath(new URL('../../../worker/lockin_worker/sheet.py', import.meta.url)), 'utf8');
    const block = py.split('COLUMNS = {')[1].split('}')[0];
    const pairs = Object.fromEntries([...block.matchAll(/"([^"]+)":\s*"(\w+)"/g)].map((m) => [m[1], m[2]]));
    expect(Object.keys(pairs).length).toBeGreaterThan(5);
    expect(COLUMNS).toEqual(pairs);
  });
});

describe('findHeader', () => {
  it('finds the first row with Company and Status and maps columns by alias', () => {
    const h = findHeader(VALUES());
    expect(h.row).toBe(5);
    expect(h.cols).toEqual({ company: 0, role: 1, track: 2, term: 3, location: 4, status: 5, priority: 6, applied_on: 7 });
    expect(h.width).toBe(8);
  });
  it('handles moved/reordered headers and short aliases; first alias wins', () => {
    const h = findHeader([[], [' status ', 'COMPANY', 'Applied', 'Role', 'Role / Title']]);
    expect(h.row).toBe(2);
    expect(h.cols).toEqual({ status: 0, company: 1, applied_on: 2, role: 3 });
  });
  it('throws without a header', () => {
    expect(() => findHeader([['foo'], ['bar']])).toThrow();
  });
});

describe('colLetter', () => {
  it('maps indexes to A1 letters', () => {
    expect([0, 5, 25, 26, 27].map(colLetter)).toEqual(['A', 'F', 'Z', 'AA', 'AB']);
  });
});

describe('pickTable / statusOptions / columnOptions', () => {
  const H = findHeader(VALUES());
  it('picks ApplicationsTable by name, else the table containing the header row', () => {
    expect(pickTable(META, H)?.name).toBe('ApplicationsTable');
    const unnamed = { sheets: [{ tables: [
      { name: 'Far', range: { startRowIndex: 50, endRowIndex: 60 } },
      { name: 'Here', range: { startRowIndex: 4, endRowIndex: 40, startColumnIndex: 1, endColumnIndex: 9 } },
    ] }] };
    expect(pickTable(unnamed, H)?.name).toBe('Here');
    expect(pickTable({ sheets: [{ tables: [{ name: 'Far', range: { startRowIndex: 50, endRowIndex: 60 } }] }] }, H)).toBeNull();
    expect(pickTable(null, H)).toBeNull();
  });
  it('unions the applications Table Status rule with the Status cell validation; other tables and columns are ignored', () => {
    expect(statusOptions(META, H)).toEqual(['Applied', 'OA invited', 'Rejected after OA', 'Submitted']);
  });
  it('reads Priority and Track the same way ([] when no dropdown)', () => {
    expect(columnOptions(META, H, 'priority')).toEqual(['Unranked', 'Top']);
    expect(columnOptions(META, H, 'track')).toEqual([]);
  });
  it('maps cell validation by startColumn', () => {
    const meta = { sheets: [{ data: [{ startColumn: 4, rowData: [{ values: [{}, { dataValidation: list('X') }] }] }] }] };
    expect(statusOptions(meta, H)).toEqual(['X']);
  });
  it('ignores non-list rules and returns [] when there is no dropdown', () => {
    expect(statusOptions({ sheets: [{ data: [{ rowData: [{ values: [{}, {}, {}, {}, {}, { dataValidation: { condition: { type: 'NUMBER_GREATER' } } }] }] }] }] }, H)).toEqual([]);
    expect(statusOptions({}, H)).toEqual([]);
    expect(statusOptions(null, H)).toEqual([]);
  });
});

describe('resolveRow', () => {
  const h = findHeader(VALUES());
  it('uses sheet_row when Company and Role still match (normalized)', () => {
    expect(resolveRow(VALUES(), h, 7, '  ramp ', 'software engineer  intern')).toBe(7);
  });
  it('falls back to a unique search when the row moved', () => {
    expect(resolveRow(VALUES(), h, 6, 'Ramp', 'Software Engineer Intern')).toBe(7);
    expect(resolveRow(VALUES(), h, null, 'Greenboard', 'Software Engineer - 2027 Grads')).toBe(6);
  });
  it('returns null on zero or multiple matches, and never matches the header row', () => {
    expect(resolveRow(VALUES(), h, 7, 'Nope', 'x')).toBeNull();
    const dup = [...VALUES(), ['Ramp', 'Software Engineer Intern']];
    expect(resolveRow(dup, h, null, 'Ramp', 'Software Engineer Intern')).toBeNull();
    expect(resolveRow(VALUES(), h, 5, 'Company', 'Role / title')).toBeNull();
  });
  it('treats a missing role as blank', () => {
    const v = [HEADER, ['Visa']];
    expect(resolveRow(v, findHeader(v), 2, 'Visa', null)).toBe(2);
  });
});

describe('hasDuplicate', () => {
  it('matches Company and Role normalized', () => {
    const h = findHeader(VALUES());
    expect(hasDuplicate(VALUES(), h, 'RAMP', ' Software Engineer Intern ')).toBe(true);
    expect(hasDuplicate(VALUES(), h, 'Ramp', 'Other role')).toBe(false);
  });
});

describe('dates', () => {
  it('detects the format from the first non-empty Applied date cell', () => {
    const at = (d: string) => { const v = VALUES(); v[5][7] = ''; v[6][7] = d; return detectDateFormat(v, findHeader(v)); };
    expect(at('10/8/2026')).toBe('M/D/YYYY');
    expect(at('10/08/2026')).toBe('MM/DD/YYYY');
    expect(at('2026-10-08')).toBe('YYYY-MM-DD');
    expect(at('10/8/26')).toBe('M/D/YY');
    expect(at('Oct 8, 2026')).toBe('MMM D, YYYY');
    expect(at('sometime')).toBe('M/D/YYYY');
    expect(at('')).toBe('M/D/YYYY');
  });
  it('formats a day in each format', () => {
    const d = { y: 2026, m: 3, d: 9 };
    expect(formatDate(d, 'M/D/YYYY')).toBe('3/9/2026');
    expect(formatDate(d, 'MM/DD/YYYY')).toBe('03/09/2026');
    expect(formatDate(d, 'M/D/YY')).toBe('3/9/26');
    expect(formatDate(d, 'YYYY-MM-DD')).toBe('2026-03-09');
    expect(formatDate(d, 'MMM D, YYYY')).toBe('Mar 9, 2026');
  });
  it('uses the America/Detroit calendar day', () => {
    expect(detroitDay(new Date('2026-10-15T03:30:00Z'))).toEqual({ y: 2026, m: 10, d: 14 });
    expect(detroitDay(new Date('2026-10-15T04:30:00Z'))).toEqual({ y: 2026, m: 10, d: 15 });
  });
});

describe('guessTrack', () => {
  it('guesses from the title', () => {
    expect(guessTrack('Software Engineer Intern, Summer 2027')).toBe('Internship');
    expect(guessTrack('SWE Internship')).toBe('Internship');
    expect(guessTrack('Software Engineering Co-op')).toBe('Co-op');
    expect(guessTrack('Software Engineer Coop')).toBe('Co-op');
    expect(guessTrack('Software Engineer, New Grad')).toBe('New grad');
    expect(guessTrack('Early Career Software Engineer')).toBe('New grad');
    expect(guessTrack('University Grad SWE')).toBe('New grad');
    expect(guessTrack('Senior Software Engineer')).toBe('Confirm');
    expect(guessTrack('International Payments Engineer')).toBe('Confirm');
  });
});

describe('buildRow / rowFromUpdatedRange', () => {
  it('aligns values to header columns; unmapped and null fields are null (skipped by Sheets)', () => {
    const h = findHeader([['Notes', 'Company', 'Status', 'Role / title', 'Score', 'Priority']]);
    const row = buildRow(h, { company: 'Ramp', role: 'SWE', status: 'Applied', track: 'Internship', priority: null });
    expect(row).toEqual([null, 'Ramp', 'Applied', 'SWE', null, null]);
    expect(dropTrailingNulls(row)).toEqual([null, 'Ramp', 'Applied', 'SWE']);
  });
  it('rowHash treats null as empty', () => {
    expect(rowHash(['a', null, 'b'] as Cell[])).toBe(rowHash(['a', '', 'b']));
    expect(rowHash(['a', null])).toBe(rowHash(['a']));
  });
  it('reads the start column of an A1 range', () => {
    expect(startColumn('Applications!B42:I42')).toBe('B');
    expect(startColumn("'Applications'!$AA$3:AB3")).toBe('AA');
    expect(startColumn(undefined)).toBeNull();
  });
  it('reads the appended row from updatedRange', () => {
    expect(rowFromUpdatedRange("Applications!A42:H42")).toBe(42);
    expect(rowFromUpdatedRange("'Applications'!A8:Z8")).toBe(8);
    expect(rowFromUpdatedRange(undefined)).toBeNull();
    expect(rowFromUpdatedRange('garbage')).toBeNull();
  });
});

describe('safeCell (formula injection)', () => {
  it('prefixes values Sheets would parse as formulas and strips control characters', () => {
    expect(safeCell('=IMPORTXML("http://x")')).toBe(`'=IMPORTXML("http://x")`);
    expect(safeCell('+1-555')).toBe("'+1-555");
    expect(safeCell('-5')).toBe("'-5");
    expect(safeCell('@me')).toBe("'@me");
    expect(safeCell('\t=HYPERLINK("x")')).toBe(`'=HYPERLINK("x")`);
    expect(safeCell('\r+1')).toBe("'+1");
    expect(safeCell('Soft\u0000ware\u0007 Engineer')).toBe('Software Engineer');
    expect(safeCell('Software Engineer Intern, Winter 2027')).toBe('Software Engineer Intern, Winter 2027');
    expect(safeCell('10/14/2026')).toBe('10/14/2026');
    expect(safeCell('')).toBe('');
  });
  it('checks after leading whitespace and protects an existing leading apostrophe', () => {
    expect(safeCell('  =1+1')).toBe("'  =1+1");
    expect(safeCell(' \t@x')).toBe("' @x");
    expect(safeCell("'quoted")).toBe("''quoted");
    expect(safeCell("  'quoted")).toBe("'  'quoted");
    expect(safeCell('Rock \'n\' roll')).toBe("Rock 'n' roll");
  });
});

describe('parseInput', () => {
  it('accepts the three ops and rejects junk', () => {
    expect(parseInput('GET', { op: 'statuses' }, undefined)).toEqual({ op: 'statuses' });
    expect(parseInput('POST', {}, { op: 'set_status', application_id: 3, company: 'Ramp', role: null, status: ' OA invited ' }))
      .toEqual({ op: 'set_status', application_id: 3, company: 'Ramp', role: null, status: 'OA invited' });
    expect(parseInput('POST', {}, { op: 'set_status', application_id: 3, company: 'Ramp', role: 'SWE', sheet_row: 7, status: 'x' }))
      .toEqual({ op: 'set_status', application_id: 3, company: 'Ramp', role: 'SWE', sheet_row: 7, status: 'x' });
    expect(parseInput('POST', {}, { op: 'set_status', application_id: 3, status: 'x' })).toBeNull(); // company required
    expect(parseInput('POST', {}, { op: 'set_status', application_id: 3, company: 'Ramp', role: 5, status: 'x' })).toBeNull();
    expect(parseInput('POST', {}, { op: 'set_status', application_id: 3, company: 'Ramp', sheet_row: -1, status: 'x' }))
      .toEqual({ op: 'set_status', application_id: 3, company: 'Ramp', role: null, status: 'x' });
    expect(parseInput('POST', {}, JSON.stringify({ op: 'applied', posting_id: 'p1' }))).toEqual({ op: 'applied', posting_id: 'p1', force: false });
    expect(parseInput('POST', {}, { op: 'applied', outreach_id: 'o1', force: true })).toEqual({ op: 'applied', outreach_id: 'o1', force: true });
    expect(parseInput('POST', {}, { op: 'applied' })).toBeNull();
    expect(parseInput('POST', {}, { op: 'set_status', application_id: 'x', status: 'a' })).toBeNull();
    expect(parseInput('POST', {}, { op: 'set_status', application_id: 1, status: '' })).toBeNull();
    expect(parseInput('POST', {}, { op: 'nuke' })).toBeNull();
    expect(parseInput('POST', {}, 'not json')).toBeNull();
    expect(parseInput('GET', { op: 'set_status' }, undefined)).toBeNull();
    // the Sheet id never comes from the request
    expect(parseInput('POST', {}, { op: 'applied', posting_id: 'p1', sheet_id: 'evil' })).toEqual({ op: 'applied', posting_id: 'p1', force: false });
  });
});

// ---- runOp with fakes ----

function fakeSheets(values = VALUES(), meta: unknown = META, updatedRange?: string) {
  const calls = { updates: [] as [string, string][], appends: [] as [string, Cell[]][], metaRanges: [] as string[], deletes: [] as number[] };
  const sheets: SheetsApi = {
    values: async () => structuredClone(values),
    meta: async (r) => { calls.metaRanges.push(r); return meta; },
    updateCell: async (a1, v) => { calls.updates.push([a1, v]); },
    append: async (range, row) => {
      calls.appends.push([range, row]);
      return updatedRange ?? `Applications!A${values.length + 1}:H${values.length + 1}`;
    },
    deleteRow: async (row) => { calls.deletes.push(row); },
  };
  return { sheets, calls };
}

const RAMP: AppRow = { id: 11, company: 'Ramp', role: 'Software Engineer Intern', status: 'Applied', sheet_row: 7 };

function fakeStore(over: Partial<{ apps: AppRow[]; postings: PostingRow[]; dbRows: (AppRow & { id: number })[] }> = {}) {
  const state = {
    apps: over.apps ?? [RAMP],
    // what an update can hit (the rows "in the DB" right now); defaults to apps
    dbRows: over.dbRows ?? over.apps ?? [RAMP],
    postings: over.postings ?? [{ id: 'p1', company: 'Stripe', title: 'Software Engineer Intern, Winter 2027', term: 'Winter 2027', location: 'Chicago, IL', url: 'https://stripe.com/jobs/1' }] as PostingRow[],
    outreach: [{ id: 'o1', company: 'Figma', role: 'Software Engineer Co-op', job_url: 'https://figma.com/jobs/9' }, { id: 'o2', company: null, role: null, job_url: 'https://stripe.com/jobs/1' }],
    updated: [] as [AppMatch, StatusPatch][],
    inserted: [] as NewApplication[],
    applied: [] as string[],
    removed: [] as [string, string | null, string][],
    failUpdate: false,
    failInsert: false,
  };
  const hits = (m: AppMatch) => state.dbRows.filter((r) =>
    'id' in m ? r.id === m.id : 'sheet_row' in m ? r.sheet_row === m.sheet_row && r.company === m.company : r.company === m.company && r.role === m.role).length;
  const store: AppStore = {
    application: async (id) => state.apps.find((a) => a.id === id) ?? null,
    updateApplications: async (m, patch) => {
      if (state.failUpdate) throw new Error('db down');
      state.updated.push([m, patch]);
      return hits(m);
    },
    posting: async (id) => state.postings.find((p) => p.id === id) ?? null,
    outreach: async (id) => state.outreach.find((o) => o.id === id) ?? null,
    postingByUrl: async (url) => state.postings.find((p) => p.url === url) ?? null,
    insertApplication: async (row) => { if (state.failInsert) throw new Error('db down'); state.inserted.push(row); },
    markPostingApplied: async (id) => { state.applied.push(id); },
    removeApplied: async (company, role, day) => { state.removed.push([company, role, day]); },
  };
  return { store, state };
}

const NOW = new Date('2026-10-14T16:00:00Z');
const SET = (status: string, over: Partial<{ application_id: number; company: string; role: string | null; sheet_row: number }> = {}) =>
  ({ op: 'set_status' as const, application_id: 11, company: 'Ramp', role: 'Software Engineer Intern', sheet_row: 7, status, ...over });

describe('runOp statuses', () => {
  it('reads validation for the first data row', async () => {
    const { sheets, calls } = fakeSheets();
    const out = await runOp({ op: 'statuses' }, { sheets, store: fakeStore().store, now: NOW });
    expect(out).toEqual({ code: 200, body: { statuses: ['Applied', 'OA invited', 'Rejected after OA', 'Submitted'] } });
    expect(calls.metaRanges).toEqual(['Applications!A6:Z6']);
  });
});

describe('runOp set_status', () => {
  it('sanitizes the status written to the cell', async () => {
    const { sheets, calls } = fakeSheets(VALUES(), {});
    await runOp(SET('=HYPERLINK("x")'), { sheets, store: fakeStore().store, now: NOW });
    expect(calls.updates).toEqual([['Applications!F7', `'=HYPERLINK("x")`]]);
  });
  it('writes only the Status cell of the sheet_row and updates the app row by id with the recomputed stage', async () => {
    const { sheets, calls } = fakeSheets();
    const { store, state } = fakeStore();
    const out = await runOp(SET('rejected after oa'), { sheets, store, now: NOW });
    expect(calls.updates).toEqual([['Applications!F7', 'Rejected after OA']]);
    expect(calls.appends).toEqual([]);
    expect(state.updated).toEqual([[{ id: 11 }, { status: 'Rejected after OA', stage: 'closed', sheet_row: 7 }]]);
    expect(out).toEqual({ code: 200, body: { ok: true, synced: true } });
  });
  it('finds a moved row by search', async () => {
    const { sheets, calls } = fakeSheets();
    const { store } = fakeStore({ apps: [{ ...RAMP, sheet_row: 6 }] });
    await runOp(SET('OA invited'), { sheets, store, now: NOW });
    expect(calls.updates).toEqual([['Applications!F7', 'OA invited']]);
  });
  it('a stale id (rows re-inserted by a sync) still writes the right row, then updates by sheet_row + company', async () => {
    const { sheets, calls } = fakeSheets();
    const { store, state } = fakeStore({ apps: [], dbRows: [{ ...RAMP, id: 512 }] });
    const out = await runOp(SET('OA invited', { application_id: 11 }), { sheets, store, now: NOW });
    expect(calls.updates).toEqual([['Applications!F7', 'OA invited']]);
    expect(state.updated).toEqual([[{ sheet_row: 7, company: 'Ramp' }, { status: 'OA invited', stage: 'oa', sheet_row: 7 }]]);
    expect(out).toEqual({ code: 200, body: { ok: true, synced: true } });
  });
  it('a stale id with no sheet_row match falls back to company + role', async () => {
    const { sheets } = fakeSheets();
    const { store, state } = fakeStore({ apps: [], dbRows: [{ ...RAMP, id: 512, sheet_row: null }] });
    const out = await runOp(SET('OA invited', { sheet_row: undefined }), { sheets, store, now: NOW });
    expect(state.updated.map(([m]) => m)).toEqual([{ sheet_row: 7, company: 'Ramp' }, { company: 'Ramp', role: 'Software Engineer Intern' }]);
    expect(out.body).toEqual({ ok: true, synced: true });
  });
  it('a stale id cannot redirect the write to a different job: Company/Role are re-checked against the Sheet', async () => {
    const { sheets, calls } = fakeSheets();
    const { store } = fakeStore({ apps: [] });
    // claims Ramp but points sheet_row at Greenboard's row 6 → search finds Ramp at row 7, never row 6
    await runOp(SET('OA invited', { sheet_row: 6 }), { sheets, store, now: NOW });
    expect(calls.updates).toEqual([['Applications!F7', 'OA invited']]);
    const out = await runOp(SET('OA invited', { company: 'Nobody', sheet_row: 6 }), { sheets, store, now: NOW });
    expect(out).toEqual({ code: 409, body: { error: MSG.notFound } });
    expect(calls.updates).toHaveLength(1);
  });
  it('409s when the id exists but its company/role differ from what the client sent', async () => {
    const { sheets, calls } = fakeSheets();
    const { store, state } = fakeStore();
    expect(await runOp(SET('OA invited', { company: 'Greenboard', role: 'Software Engineer - 2027 Grads', sheet_row: 6 }), { sheets, store, now: NOW }))
      .toEqual({ code: 409, body: { error: MSG.notFound } });
    expect(calls.updates).toEqual([]);
    expect(state.updated).toEqual([]);
  });
  it('the app row vanishing after the Sheet write (sync race) is ok with synced:false', async () => {
    const { sheets, calls } = fakeSheets();
    const { store } = fakeStore({ apps: [RAMP], dbRows: [] });
    expect(await runOp(SET('OA invited'), { sheets, store, now: NOW })).toEqual({ code: 200, body: { ok: true, synced: false } });
    expect(calls.updates).toHaveLength(1);
  });
  it('a Supabase failure after the Sheet write is still 200 ok, synced:false', async () => {
    const { sheets } = fakeSheets();
    const { store, state } = fakeStore();
    state.failUpdate = true;
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await runOp(SET('OA invited'), { sheets, store, now: NOW })).toEqual({ code: 200, body: { ok: true, synced: false } });
    err.mockRestore();
  });
  it('409s when the row is gone or ambiguous', async () => {
    const { sheets, calls } = fakeSheets([...VALUES(), ['Ramp', 'Software Engineer Intern']]);
    const { store, state } = fakeStore({ apps: [{ ...RAMP, sheet_row: null }] });
    expect(await runOp(SET('OA invited', { sheet_row: undefined }), { sheets, store, now: NOW }))
      .toEqual({ code: 409, body: { error: MSG.notFound } });
    expect(calls.updates).toEqual([]);
    expect(state.updated).toEqual([]);
  });
  it('refuses a status that is not in the dropdown', async () => {
    const { sheets, calls } = fakeSheets();
    const out = await runOp(SET('Ghosted'), { sheets, store: fakeStore().store, now: NOW });
    expect(out).toEqual({ code: 400, body: { error: MSG.dropdown } });
    expect(calls.updates).toEqual([]);
  });
  it('accepts any status when the Sheet has no dropdown', async () => {
    const { sheets, calls } = fakeSheets(VALUES(), {});
    await runOp(SET('Ghosted'), { sheets, store: fakeStore().store, now: NOW });
    expect(calls.updates).toEqual([['Applications!F7', 'Ghosted']]);
  });
});

describe('runOp unapply', () => {
  const today = (status = 'Applied', date = '10/14/2026') =>
    [...VALUES(), ['Stripe', 'SWE Intern', 'Internship', '', '', status, 'Unranked', date]]; // row 8
  const UN = { op: 'unapply' as const, company: 'Stripe', role: 'SWE Intern', sheet_row: 8 };
  it('deletes the row added today and drops the app row', async () => {
    const { sheets, calls } = fakeSheets(today());
    const { store, state } = fakeStore();
    expect(await runOp(UN, { sheets, store, now: NOW })).toEqual({ code: 200, body: { ok: true, synced: true } });
    expect(calls.deletes).toEqual([8]);
    expect(state.removed).toEqual([['Stripe', 'SWE Intern', '2026-10-14']]);
  });
  it('finds the row by Company and Role when sheet_row is missing or stale', async () => {
    const { sheets, calls } = fakeSheets(today());
    await runOp({ ...UN, sheet_row: 6 }, { sheets, store: fakeStore().store, now: NOW });
    expect(calls.deletes).toEqual([8]);
  });
  it('refuses rows from another day or past Applied, and unknown rows', async () => {
    for (const values of [today('Applied', '10/13/2026'), today('OA invited')]) {
      const { sheets, calls } = fakeSheets(values);
      expect(await runOp(UN, { sheets, store: fakeStore().store, now: NOW })).toEqual({ code: 409, body: { error: MSG.undoLate } });
      expect(calls.deletes).toEqual([]);
    }
    const { sheets, calls } = fakeSheets();
    expect(await runOp(UN, { sheets, store: fakeStore().store, now: NOW })).toEqual({ code: 409, body: { error: MSG.notFound } });
    expect(calls.deletes).toEqual([]);
  });
  it('parses unapply input', () => {
    expect(parseInput('POST', {}, { op: 'unapply', company: ' Stripe ', role: null, sheet_row: 8 })).toEqual({ op: 'unapply', company: 'Stripe', role: null, sheet_row: 8 });
    expect(parseInput('POST', {}, { op: 'unapply', role: 'x' })).toBeNull();
  });
});

describe('runOp applied', () => {
  it('writes posting-derived formula-looking text as literal text', async () => {
    const { sheets, calls } = fakeSheets();
    const { store } = fakeStore({ postings: [
      { id: 'px', company: '@evil', title: '=IMPORTXML("http://x")', term: '+1-555', location: '-Remote', url: null },
    ] });
    await runOp({ op: 'applied', posting_id: 'px' }, { sheets, store, now: NOW });
    expect(calls.appends[0][1].slice(0, 5)).toEqual(["'@evil", `'=IMPORTXML("http://x")`, 'Confirm', "'+1-555", "'-Remote"]);
  });
  it('appends one aligned row inside the Table, then inserts the app row and marks the posting applied', async () => {
    const { sheets, calls } = fakeSheets();
    const { store, state } = fakeStore();
    const out = await runOp({ op: 'applied', posting_id: 'p1', force: false }, { sheets, store, now: NOW });
    expect(out).toEqual({ code: 200, body: { ok: true, synced: true } });
    expect(calls.updates).toEqual([]);
    expect(calls.appends).toEqual([['Applications!A5:H',
      ['Stripe', 'Software Engineer Intern, Winter 2027', 'Internship', 'Winter 2027', 'Chicago, IL', 'Applied', 'Unranked', '10/14/2026']]]);
    expect(state.inserted).toEqual([{
      company: 'Stripe', role: 'Software Engineer Intern, Winter 2027', track: 'Internship', term: 'Winter 2027', location: 'Chicago, IL',
      status: 'Applied', stage: 'applied', priority: 'Unranked', applied_on: '2026-10-14', sheet_row: 8, row_hash: expect.stringMatching(/^[0-9a-f]{40}$/),
    }]);
    expect(state.applied).toEqual(['p1']);
  });
  it('a Table starting at column B appends B:… with the row sliced to the Table, leaving formula columns (null) alone', async () => {
    const hdr = ['#', 'Company', 'Role / title', 'Track', 'Status', 'Priority', 'Days since', 'Applied date', 'Notes'];
    const values = [[], hdr, ['1', 'Ramp', 'SWE', 'Internship', 'Applied', 'Unranked', '5', '10/8/2026', '']];
    const meta = { sheets: [{ tables: [{ name: 'T', range: { startRowIndex: 1, endRowIndex: 3, startColumnIndex: 1, endColumnIndex: 9 } }] }] };
    const { sheets, calls } = fakeSheets(values, meta, 'Applications!B4:I4');
    const { store, state } = fakeStore();
    expect((await runOp({ op: 'applied', posting_id: 'p1' }, { sheets, store, now: NOW })).code).toBe(200);
    expect(calls.appends).toEqual([['Applications!B2:I',
      ['Stripe', 'Software Engineer Intern, Winter 2027', 'Internship', 'Applied', 'Unranked', null, '10/14/2026']]]);
    expect(state.inserted[0].sheet_row).toBe(4);
  });
  it('an updatedRange that does not start at the Table start is a 500 and nothing else is written', async () => {
    const { sheets } = fakeSheets(VALUES(), META, 'Applications!C8:J8');
    const { store, state } = fakeStore();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await runOp({ op: 'applied', posting_id: 'p1' }, { sheets, store, now: NOW }))
      .toEqual({ code: 500, body: { error: 'Sheet layout changed; nothing else was written.' } });
    expect(state.inserted).toEqual([]);
    expect(state.applied).toEqual([]);
    expect(err.mock.calls.flat().join(' ')).toContain('LAYOUT MISMATCH');
    err.mockRestore();
  });
  it('without a Table it falls back to A:Z', async () => {
    const { sheets, calls } = fakeSheets(VALUES(), {});
    await runOp({ op: 'applied', posting_id: 'p1' }, { sheets, store: fakeStore().store, now: NOW });
    expect(calls.appends[0][0]).toBe('Applications!A5:Z');
  });
  it('leaves Priority/Track null when the dropdown does not allow the value; uses the dropdown spelling when it does', async () => {
    const meta = structuredClone(META) as { sheets: { tables: Table[] }[] };
    const t = meta.sheets[0].tables[1];
    t.columnProperties = [
      ...(t.columnProperties ?? []).filter((c) => c.columnName !== 'Priority'),
      { columnIndex: 6, columnName: 'Priority', columnType: 'DROPDOWN', dataValidationRule: list('High', 'Low') },
      { columnIndex: 2, columnName: 'Track', columnType: 'DROPDOWN', dataValidationRule: list('New grad', 'Co-op') },
    ];
    const { sheets, calls } = fakeSheets(VALUES(), meta);
    const { store, state } = fakeStore();
    await runOp({ op: 'applied', posting_id: 'p1' }, { sheets, store, now: NOW });
    expect(calls.appends[0][1][2]).toBeNull(); // Internship isn't a Track option
    expect(calls.appends[0][1][6]).toBeNull(); // Unranked isn't a Priority option
    expect(state.inserted[0]).toMatchObject({ track: null, priority: null });
    const s2 = fakeSheets(VALUES(), meta);
    const st2 = fakeStore({ postings: [{ id: 'p9', company: 'Ford', title: 'Software Engineering COOP', term: null, location: null, url: null }] });
    await runOp({ op: 'applied', posting_id: 'p9' }, { sheets: s2.sheets, store: st2.store, now: NOW });
    expect(s2.calls.appends[0][1][2]).toBe('Co-op');
  });
  it('a Supabase failure after the append is 200 ok, synced:false', async () => {
    const { sheets, calls } = fakeSheets();
    const { store, state } = fakeStore();
    state.failInsert = true;
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await runOp({ op: 'applied', posting_id: 'p1' }, { sheets, store, now: NOW })).toEqual({ code: 200, body: { ok: true, synced: false } });
    expect(calls.appends).toHaveLength(1);
    err.mockRestore();
  });
  it('uses the outreach row, with term/location from the posting at its job_url, and marks that posting applied', async () => {
    const { sheets, calls } = fakeSheets();
    const { store, state } = fakeStore();
    await runOp({ op: 'applied', outreach_id: 'o2' }, { sheets, store, now: NOW });
    expect(calls.appends[0][1].slice(0, 5)).toEqual(['Stripe', 'Software Engineer Intern, Winter 2027', 'Internship', 'Winter 2027', 'Chicago, IL']);
    expect(state.applied).toEqual(['p1']);
    await runOp({ op: 'applied', outreach_id: 'o1' }, { sheets, store, now: NOW });
    expect(calls.appends[1][1].slice(0, 5)).toEqual(['Figma', 'Software Engineer Co-op', 'Co-op', '', '']);
    expect(state.applied).toEqual(['p1']);
  });
  it('409 duplicate unless forced', async () => {
    const { sheets, calls } = fakeSheets();
    const { store } = fakeStore({ postings: [{ id: 'p2', company: 'ramp', title: 'Software Engineer Intern', term: null, location: null, url: null }] });
    expect(await runOp({ op: 'applied', posting_id: 'p2' }, { sheets, store, now: NOW }))
      .toEqual({ code: 409, body: { duplicate: true, error: MSG.duplicate } });
    expect(calls.appends).toEqual([]);
    expect((await runOp({ op: 'applied', posting_id: 'p2', force: true }, { sheets, store, now: NOW })).code).toBe(200);
    expect(calls.appends).toHaveLength(1);
  });
  it('refuses when Applied is not in the dropdown', async () => {
    const meta = { sheets: [{ tables: [{ name: 'ApplicationsTable', columnProperties: [{ columnName: 'Status', dataValidationRule: list('Submitted') }] }] }] };
    const { sheets, calls } = fakeSheets(VALUES(), meta);
    expect(await runOp({ op: 'applied', posting_id: 'p1' }, { sheets, store: fakeStore().store, now: NOW }))
      .toEqual({ code: 400, body: { error: MSG.dropdown } });
    expect(calls.appends).toEqual([]);
  });
  it('404s an unknown posting', async () => {
    const { sheets } = fakeSheets();
    expect((await runOp({ op: 'applied', posting_id: 'nope' }, { sheets, store: fakeStore().store, now: NOW })).code).toBe(404);
  });
  it('writes dates in the Sheet format', async () => {
    const v = VALUES(); v[5][7] = '2026-10-07'; v[6][7] = '';
    const { sheets, calls } = fakeSheets(v);
    await runOp({ op: 'applied', posting_id: 'p1' }, { sheets, store: fakeStore().store, now: NOW });
    expect(calls.appends[0][1][7]).toBe('2026-10-14');
  });
});

// ---- Google client via mocked fetch ----

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const SA = { client_email: 'bot@x.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() };

describe('signJwt', () => {
  it('is an RS256 JWT for the spreadsheets scope', () => {
    const jwt = signJwt(SA, NOW);
    const [h, c, s] = jwt.split('.');
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
    expect(claims).toEqual({
      iss: SA.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets', aud: 'https://oauth2.googleapis.com/token',
      iat: NOW.getTime() / 1000, exp: NOW.getTime() / 1000 + 3600,
    });
    const ok = createVerify('RSA-SHA256').update(`${h}.${c}`).verify(createPublicKey(publicKey.export({ type: 'spki', format: 'pem' })), Buffer.from(s, 'base64url'));
    expect(ok).toBe(true);
  });
});

describe('googleToken', () => {
  beforeEach(() => resetTokenCache());
  it('exchanges the JWT and caches until ~60 s before expiry', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ access_token: 'tok1', expires_in: 3600 })));
    expect(await googleToken(SA, f, NOW)).toBe('tok1');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    expect(String(init.body)).toContain('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer');
    expect(await googleToken(SA, f, new Date(NOW.getTime() + 3000_000))).toBe('tok1');
    expect(f).toHaveBeenCalledTimes(1);
    await googleToken(SA, f, new Date(NOW.getTime() + 3541_000));
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('throws a GoogleError without the body on failure', async () => {
    const f = vi.fn(async () => new Response('{"error":"invalid_grant secret detail"}', { status: 400 }));
    await expect(googleToken(SA, f, NOW)).rejects.toThrow(/HTTP 400/);
    await expect(googleToken(SA, f, NOW)).rejects.not.toThrow(/secret detail/);
  });
});

describe('googleSheets', () => {
  const ok = (body: unknown) => new Response(JSON.stringify(body));
  it('reads values and validation, writes one cell, appends with INSERT_ROWS/USER_ENTERED', async () => {
    const f = vi.fn(async (url: string) => ok(url.includes(':append') ? { updates: { updatedRange: 'Applications!A9:H9' } } : url.includes('/values/') ? { values: [['a']] } : META));
    const s = googleSheets('SID', 'tok', f as unknown as typeof fetch);
    expect(await s.values()).toEqual([['a']]);
    await s.meta('Applications!F6');
    await s.updateCell('Applications!F7', 'OA invited');
    expect(await s.append('Applications!A5:Z', ['x', 'y'])).toBe('Applications!A9:H9');
    const calls = f.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0][0]).toBe('https://sheets.googleapis.com/v4/spreadsheets/SID/values/Applications!A1%3AZ2000');
    const meta = new URL(calls[1][0]);
    expect(meta.pathname).toBe('/v4/spreadsheets/SID');
    expect(meta.searchParams.get('ranges')).toBe('Applications!F6');
    expect(meta.searchParams.get('includeGridData')).toBe('true');
    expect(meta.searchParams.get('fields')).toBe('sheets(data(startColumn,rowData(values(dataValidation))),tables)');
    const upd = new URL(calls[2][0]);
    expect(upd.pathname).toBe('/v4/spreadsheets/SID/values/Applications!F7');
    expect(upd.searchParams.get('valueInputOption')).toBe('USER_ENTERED');
    expect(calls[2][1].method).toBe('PUT');
    expect(JSON.parse(String(calls[2][1].body))).toEqual({ range: 'Applications!F7', majorDimension: 'ROWS', values: [['OA invited']] });
    const app = new URL(calls[3][0]);
    expect(app.pathname).toBe('/v4/spreadsheets/SID/values/Applications!A5%3AZ:append');
    expect(app.searchParams.get('insertDataOption')).toBe('INSERT_ROWS');
    expect(app.searchParams.get('valueInputOption')).toBe('USER_ENTERED');
    expect(JSON.parse(String(calls[3][1].body))).toEqual({ majorDimension: 'ROWS', values: [['x', 'y']] });
    for (const [, init] of calls) expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });
  it('a Google 401 drops the cached token so the next call mints a new one', async () => {
    resetTokenCache();
    const tok = vi.fn(async () => new Response(JSON.stringify({ access_token: `t${tok.mock.calls.length}`, expires_in: 3600 })));
    expect(await googleToken(SA, tok, NOW)).toBe('t1');
    const s = googleSheets('SID', 't1', (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch);
    await expect(s.values()).rejects.toMatchObject({ name: 'GoogleError', message: 'Sheets HTTP 401' });
    expect(await googleToken(SA, tok, NOW)).toBe('t2');
    const s403 = googleSheets('SID', 't2', (async () => new Response('{}', { status: 403 })) as unknown as typeof fetch);
    await expect(s403.values()).rejects.toThrow();
    expect(await googleToken(SA, tok, NOW)).toBe('t2');
  });
  it('maps HTTP and network failures to GoogleError', async () => {
    const s = googleSheets('SID', 'tok', (async () => new Response('{"error":{"message":"PERMISSION_DENIED body"}}', { status: 403 })) as unknown as typeof fetch);
    await expect(s.values()).rejects.toMatchObject({ name: 'GoogleError', message: 'Sheets HTTP 403' });
    const n = googleSheets('SID', 'tok', (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch);
    await expect(n.values()).rejects.toMatchObject({ name: 'GoogleError' });
  });
});
