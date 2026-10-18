import { createHash, createSign } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
// .js: Vercel runs this file as native ESM, which needs the extension; TS/Vite map it to stages.ts.
import { statusStage } from '../src/lib/stages.js';

/*
 * /api/sheet: the only writer to Adam's application Sheet (tab "Applications").
 *   GET  ?op=statuses                                → { statuses: string[] }  (the Status dropdown options)
 *   POST { op: 'set_status', application_id, company, role, sheet_row?, status } → writes only that row's Status cell
 *   POST { op: 'applied', posting_id? | outreach_id?, force? } → appends one row at the end of the table
 *   POST { op: 'unapply', company, role, sheet_row? } → deletes that row, only if it's still Applied with today's date
 * The Sheet id comes only from env SHEET_ID. Supabase is used as the signed-in user (RLS).
 */

export const TAB = 'Applications';
export const VALUES_RANGE = `${TAB}!A1:Z2000`;
export const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
export const GOOGLE_TIMEOUT_MS = 8_000;
export const TZ = 'America/Detroit';

/** Header aliases; identical to worker/lockin_worker/sheet.py COLUMNS (a test keeps them in sync). */
export const COLUMNS = {
  'company': 'company', 'role / title': 'role', 'role': 'role', 'track': 'track',
  'start / term': 'term', 'term': 'term', 'location': 'location', 'status': 'status',
  'priority': 'priority', 'applied date': 'applied_on', 'applied': 'applied_on',
} as const satisfies Record<string, string>;
export type ColKey = (typeof COLUMNS)[keyof typeof COLUMNS];

export const MSG = {
  google: "Couldn't reach Google. Try again.",
  notFound: "Couldn't find that row in your Sheet; it may have moved. Refresh and try again.",
  dropdown: "That status isn't in your Sheet's Status dropdown. Add it there first.",
  duplicate: 'Already in your Sheet.',
  noJob: "Couldn't find that job.",
  bad: 'Bad request',
  forbidden: 'Not allowed.',
  config: "Sheet writes aren't configured.",
  session: 'Invalid or expired session',
  missingToken: 'Missing bearer token',
  retry: 'Try again',
  layout: 'Sheet layout changed; nothing else was written.',
  undoLate: "Only an application added today and still marked Applied can be undone here. Edit the Sheet directly.",
} as const;
export const TABLE_NAME = 'ApplicationsTable';

export class GoogleError extends Error {
  constructor(message: string) { super(message); this.name = 'GoogleError'; }
}

// ---------- pure helpers ----------

export const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean).join(' ');

export interface Header { row: number; cols: Partial<Record<ColKey, number>>; width: number }

/** First row containing both Company and Status (like map_rows). `row` is 1-based (values start at A1). */
export function findHeader(values: string[][]): Header {
  const i = values.findIndex((r) => { const set = new Set((r ?? []).map(norm)); return set.has('company') && set.has('status'); });
  if (i < 0) throw new Error("no header row with 'Company' and 'Status' in the Applications tab");
  const cols: Partial<Record<ColKey, number>> = {};
  values[i].forEach((cell, j) => {
    const key = (COLUMNS as Record<string, ColKey>)[norm(cell)];
    if (key && cols[key] === undefined) cols[key] = j;
  });
  return { row: i + 1, cols, width: values[i].length };
}

export function colLetter(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

const cell = (row: string[] | undefined, j: number | undefined) => (row && j !== undefined ? row[j] ?? '' : '');

type Condition = { type?: string; values?: { userEnteredValue?: string }[] };
const listValues = (c: Condition | undefined): string[] =>
  c?.type === 'ONE_OF_LIST' ? (c.values ?? []).map((v) => String(v.userEnteredValue ?? '').trim()).filter(Boolean) : [];

export interface GridRange { startRowIndex?: number; endRowIndex?: number; startColumnIndex?: number; endColumnIndex?: number }
export interface Table {
  name?: string;
  range?: GridRange;
  columnProperties?: { columnIndex?: number; columnName?: string; columnType?: string; dataValidationRule?: { condition?: Condition } }[];
}
type MetaSheet = { tables?: Table[]; data?: { startColumn?: number; rowData?: { values?: { dataValidation?: { condition?: Condition } }[] }[] }[] };
const metaSheets = (meta: unknown): MetaSheet[] => ((meta as { sheets?: MetaSheet[] } | null)?.sheets) ?? [];

/** The applications Table: ApplicationsTable by name, else the table whose range contains the header row; null if none. */
export function pickTable(meta: unknown, h: Header): Table | null {
  const tables = metaSheets(meta).flatMap((s) => s.tables ?? []);
  const named = tables.find((t) => t.name === TABLE_NAME);
  if (named) return named;
  const r0 = h.row - 1;
  return tables.find((t) => t.range && (t.range.startRowIndex ?? 0) <= r0 && r0 < (t.range.endRowIndex ?? Infinity)) ?? null;
}

/**
 * Dropdown (ONE_OF_LIST) options for a column: the applications Table's column rule (matched by header alias),
 * unioned with the first data row's cell validation in that column. [] when the column has no dropdown.
 */
export function columnOptions(meta: unknown, h: Header, key: ColKey): string[] {
  const out: string[] = [];
  const add = (vs: string[]) => { for (const v of vs) if (!out.includes(v)) out.push(v); };
  for (const c of pickTable(meta, h)?.columnProperties ?? []) {
    if ((COLUMNS as Record<string, ColKey>)[norm(c.columnName)] === key) add(listValues(c.dataValidationRule?.condition));
  }
  const j = h.cols[key];
  if (j !== undefined) {
    for (const s of metaSheets(meta)) {
      for (const d of s.data ?? []) {
        const v = d.rowData?.[0]?.values?.[j - (d.startColumn ?? 0)];
        add(listValues(v?.dataValidation?.condition));
      }
    }
  }
  return out;
}

export const statusOptions = (meta: unknown, h: Header) => columnOptions(meta, h, 'status');

const sameJob = (row: string[] | undefined, h: Header, company: string, role: string | null) =>
  !!row && norm(cell(row, h.cols.company)) === norm(company) && norm(cell(row, h.cols.role)) === norm(role);

function matches(values: string[][], h: Header, company: string, role: string | null): number[] {
  const out: number[] = [];
  for (let i = h.row; i < values.length; i++) if (norm(company) && sameJob(values[i], h, company, role)) out.push(i + 1);
  return out;
}

/** The 1-based Sheet row for an application: its stored sheet_row if Company+Role still match, else a unique search; null otherwise. */
export function resolveRow(values: string[][], h: Header, sheetRow: number | null | undefined, company: string, role: string | null): number | null {
  if (sheetRow && sheetRow > h.row && sameJob(values[sheetRow - 1], h, company, role)) return sheetRow;
  const found = matches(values, h, company, role);
  return found.length === 1 ? found[0] : null;
}

export const hasDuplicate = (values: string[][], h: Header, company: string, role: string | null) => matches(values, h, company, role).length > 0;

export type DateFmt = 'M/D/YYYY' | 'MM/DD/YYYY' | 'M/D/YY' | 'YYYY-MM-DD' | 'MMM D, YYYY';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The format of the first non-empty Applied date cell; M/D/YYYY when unknown. */
export function detectDateFormat(values: string[][], h: Header): DateFmt {
  const sample = values.slice(h.row).map((r) => cell(r, h.cols.applied_on).trim()).find(Boolean) ?? '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(sample)) return 'YYYY-MM-DD';
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(sample)) return 'MM/DD/YYYY';
  if (/^\d{1,2}\/\d{1,2}\/\d{2}$/.test(sample)) return 'M/D/YY';
  if (/^[A-Za-z]{3,9} \d{1,2}, \d{4}$/.test(sample)) return 'MMM D, YYYY';
  return 'M/D/YYYY';
}

export interface Day { y: number; m: number; d: number }
const pad = (n: number) => String(n).padStart(2, '0');

export function formatDate({ y, m, d }: Day, fmt: DateFmt): string {
  switch (fmt) {
    case 'YYYY-MM-DD': return `${y}-${pad(m)}-${pad(d)}`;
    case 'MM/DD/YYYY': return `${pad(m)}/${pad(d)}/${y}`;
    case 'M/D/YY': return `${m}/${d}/${pad(y % 100)}`;
    case 'MMM D, YYYY': return `${MONTHS[m - 1]} ${d}, ${y}`;
    default: return `${m}/${d}/${y}`;
  }
}

export function detroitDay(now: Date): Day {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

export function guessTrack(title: string): string {
  const t = norm(title);
  if (/\bintern(ship)?s?\b/.test(t)) return 'Internship';
  if (/\bco-?op\b/.test(t)) return 'Co-op';
  if (/new grad|early career|university grad|college grad/.test(t)) return 'New grad';
  return 'Confirm';
}

/**
 * Cells are written with USER_ENTERED, so text that starts like a formula (=, +, -, @, or a leading tab/CR)
 * would run in Adam's Sheet (e.g. a scraped title "=IMPORTXML(...)"). Prefix it with ' so Sheets stores text,
 * and drop control characters.
 */
export function safeCell(value: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, '');
  // A leading ' is eaten by Sheets as the text marker, so a value that already starts with one needs another.
  return /^[=+\-@\t\r]/.test(value.trimStart()) || /^[=+\-@']/.test(clean.trimStart()) ? `'${clean}` : clean;
}

export type Cell = string | null;

/**
 * One row aligned to the header's columns. Unmapped (or null) fields are null, which the Sheets API skips,
 * so formula and calculated columns stay untouched. Every value passes through safeCell.
 */
export function buildRow(h: Header, fields: Partial<Record<ColKey, string | null>>): Cell[] {
  const width = Math.max(h.width, ...Object.values(h.cols).map((j) => (j ?? 0) + 1));
  const row = Array<Cell>(width).fill(null);
  for (const [k, v] of Object.entries(fields) as [ColKey, string | null][]) {
    const j = h.cols[k];
    if (j !== undefined && v !== null) row[j] = safeCell(v);
  }
  return row;
}

export const dropTrailingNulls = (cells: Cell[]): Cell[] => {
  const out = [...cells];
  while (out.length && out[out.length - 1] === null) out.pop();
  return out;
};

/** Leading column letters of an A1 range ("Applications!B42:H42" → "B"). */
export const startColumn = (range: string | undefined) => /!\$?([A-Z]+)\$?\d+/.exec(range ?? '')?.[1] ?? null;

export function rowFromUpdatedRange(range: string | undefined): number | null {
  const m = /!\$?[A-Z]+\$?(\d+)(?::\$?[A-Z]+\$?\d+)?$/.exec(range ?? '');
  return m ? Number(m[1]) : null;
}

/** Same shape as the worker's row_hash (sha1 of the cells joined by \x1f, trailing blanks dropped like the API). null is ''. */
export function rowHash(cells: Cell[]): string {
  const trimmed = cells.map((c) => c ?? '');
  while (trimmed.length && trimmed[trimmed.length - 1] === '') trimmed.pop();
  return createHash('sha1').update(trimmed.join('\x1f')).digest('hex');
}

// ---------- request parsing ----------

export type OpInput =
  | { op: 'statuses' }
  | { op: 'set_status'; application_id: number; company: string; role: string | null; sheet_row?: number; status: string }
  | { op: 'applied'; posting_id?: string; outreach_id?: string; force?: boolean }
  | { op: 'unapply'; company: string; role: string | null; sheet_row?: number };

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

export function parseInput(method: string | undefined, query: Record<string, unknown> | undefined, body: unknown): OpInput | null {
  if (method === 'GET') return query?.op === 'statuses' ? { op: 'statuses' } : null;
  let b = body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { return null; } }
  if (!b || typeof b !== 'object') return null;
  const o = b as Record<string, unknown>;
  if (o.op === 'statuses') return { op: 'statuses' };
  if (o.op === 'set_status') {
    const status = str(o.status);
    const company = str(o.company);
    if (!Number.isSafeInteger(o.application_id) || !status || status.length > 100 || !company) return null;
    if (o.role !== undefined && o.role !== null && typeof o.role !== 'string') return null;
    const sheetRow = Number.isSafeInteger(o.sheet_row) && (o.sheet_row as number) > 0 ? { sheet_row: o.sheet_row as number } : {};
    return { op: 'set_status', application_id: o.application_id as number, company, role: str(o.role) ?? null, ...sheetRow, status };
  }
  if (o.op === 'applied') {
    const posting_id = str(o.posting_id);
    const outreach_id = str(o.outreach_id);
    if (!posting_id && !outreach_id) return null;
    return { op: 'applied', ...(posting_id ? { posting_id } : { outreach_id }), force: o.force === true };
  }
  if (o.op === 'unapply') {
    const company = str(o.company);
    if (!company || (o.role !== undefined && o.role !== null && typeof o.role !== 'string')) return null;
    const sheetRow = Number.isSafeInteger(o.sheet_row) && (o.sheet_row as number) > 0 ? { sheet_row: o.sheet_row as number } : {};
    return { op: 'unapply', company, role: str(o.role) ?? null, ...sheetRow };
  }
  return null;
}

// ---------- Google (no SDK: a service-account JWT signed with node:crypto) ----------

export interface ServiceAccount { client_email: string; private_key: string }
const b64url = (s: string | Buffer) => Buffer.from(s).toString('base64url');

export function signJwt(sa: ServiceAccount, now: Date): string {
  const iat = Math.floor(now.getTime() / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 }));
  const sig = createSign('RSA-SHA256').update(`${head}.${claims}`).sign(sa.private_key);
  return `${head}.${claims}.${b64url(sig)}`;
}

let cached: { token: string; until: number } | null = null;
export const resetTokenCache = () => { cached = null; };

async function gfetch(fetchImpl: typeof fetch, url: string, init: RequestInit, what: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS) });
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    throw new GoogleError(`${what} ${timedOut ? 'timed out' : 'unreachable'}`);
  }
  // Never carry Google's body: it can echo request detail.
  if (res.status === 401) resetTokenCache(); // revoked/expired token: mint a new one next time
  if (!res.ok) throw new GoogleError(`${what} HTTP ${res.status}`);
  return res;
}

/** An access token for the service account, cached in module scope until ~60 s before it expires. */
export async function googleToken(sa: ServiceAccount, fetchImpl: typeof fetch = fetch, now: Date = new Date()): Promise<string> {
  if (cached && now.getTime() < cached.until) return cached.token;
  const res = await gfetch(fetchImpl, TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: signJwt(sa, now) }).toString(),
  }, 'Token');
  const body = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null;
  if (!body?.access_token) throw new GoogleError('Token response had no access_token');
  cached = { token: body.access_token, until: now.getTime() + ((body.expires_in ?? 3600) - 60) * 1000 };
  return body.access_token;
}

export interface SheetsApi {
  values(): Promise<string[][]>;
  /** Table definitions plus the given range's data validation. */
  meta(rangeA1: string): Promise<unknown>;
  updateCell(a1: string, value: string): Promise<void>;
  /** Returns the appended range (e.g. "Applications!A42:H42"). null cells are skipped. */
  append(range: string, row: Cell[]): Promise<string | undefined>;
  /** Deletes one whole 1-based row of the Applications tab (the Table shrinks with it). */
  deleteRow(row: number): Promise<void>;
}

export function googleSheets(sheetId: string, token: string, fetchImpl: typeof fetch = fetch): SheetsApi {
  const base = `${SHEETS_API}/${encodeURIComponent(sheetId)}`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const json = async (url: string, init: RequestInit = {}) =>
    (await gfetch(fetchImpl, url, { ...init, headers }, 'Sheets')).json().catch(() => null) as Promise<Record<string, unknown> | null>;
  return {
    async values() {
      const b = await json(`${base}/values/${encodeURIComponent(VALUES_RANGE)}`);
      return ((b?.values ?? []) as unknown[][]).map((r) => (r ?? []).map((c) => String(c ?? '')));
    },
    async meta(rangeA1) {
      const q = new URLSearchParams({ ranges: rangeA1, includeGridData: 'true', fields: 'sheets(data(startColumn,rowData(values(dataValidation))),tables)' });
      return json(`${base}?${q}`);
    },
    async updateCell(a1, value) {
      await json(`${base}/values/${encodeURIComponent(a1)}?valueInputOption=USER_ENTERED`, {
        method: 'PUT', body: JSON.stringify({ range: a1, majorDimension: 'ROWS', values: [[value]] }),
      });
    },
    async append(range, row) {
      const q = new URLSearchParams({ valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS' });
      const b = await json(`${base}/values/${encodeURIComponent(range)}:append?${q}`, {
        method: 'POST', body: JSON.stringify({ majorDimension: 'ROWS', values: [row] }),
      });
      return (b?.updates as { updatedRange?: string } | undefined)?.updatedRange;
    },
    async deleteRow(row) {
      const props = await json(`${base}?${new URLSearchParams({ fields: 'sheets(properties(sheetId,title))' })}`);
      const tab = ((props?.sheets ?? []) as { properties?: { sheetId?: number; title?: string } }[])
        .map((x) => x.properties).find((x) => x?.title === TAB);
      if (tab?.sheetId === undefined) throw new GoogleError(`no ${TAB} tab`);
      await json(`${base}:batchUpdate`, {
        method: 'POST',
        body: JSON.stringify({ requests: [{ deleteDimension: { range: { sheetId: tab.sheetId, dimension: 'ROWS', startIndex: row - 1, endIndex: row } } }] }),
      });
    },
  };
}

// ---------- Supabase (as the user) ----------

export interface AppRow { id: number; company: string; role: string | null; status: string | null; sheet_row: number | null }
export interface PostingRow { id: string; company: string; title: string; term: string | null; location: string | null; url: string | null }
export interface OutreachRow { id: string; company: string | null; role: string | null; job_url: string }
export interface NewApplication {
  company: string; role: string | null; track: string | null; term: string | null; location: string | null; status: string;
  stage: string; priority: string | null; applied_on: string; sheet_row: number | null; row_hash: string;
}
export type AppMatch = { id: number } | { sheet_row: number; company: string } | { company: string; role: string | null };
export interface StatusPatch { status: string; stage: string; sheet_row: number }

export interface AppStore {
  application(id: number): Promise<AppRow | null>;
  /** Updates matching rows; resolves to how many changed (0 is fine: the next sync reconciles). */
  updateApplications(match: AppMatch, patch: StatusPatch): Promise<number>;
  posting(id: string): Promise<PostingRow | null>;
  outreach(id: string): Promise<OutreachRow | null>;
  postingByUrl(url: string): Promise<PostingRow | null>;
  insertApplication(row: NewApplication): Promise<void>;
  markPostingApplied(id: string): Promise<void>;
  /** Undo of the two above: drops the matching app rows applied on `day` and puts applied postings back to seen. */
  removeApplied(company: string, role: string | null, day: string): Promise<void>;
}

type PgError = { message: string } | null;
async function one<T>(p: PromiseLike<{ data: unknown; error: PgError }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data as T;
}

const POSTING_COLS = 'id,company,title,term,location,url';

export function supabaseAppStore(sb: SupabaseClient): AppStore {
  return {
    application: (id) => one(sb.from('applications').select('id,company,role,status,sheet_row').eq('id', id).maybeSingle()),
    async updateApplications(match, patch) {
      let q = sb.from('applications').update(patch);
      if ('id' in match) q = q.eq('id', match.id);
      else if ('sheet_row' in match) q = q.eq('sheet_row', match.sheet_row).eq('company', match.company);
      else q = (match.role === null ? q.is('role', null) : q.eq('role', match.role)).eq('company', match.company);
      // No .single(): zero rows (ids changed under a sync) is not an error.
      return ((await one<unknown[] | null>(q.select('id'))) ?? []).length;
    },
    posting: (id) => one(sb.from('postings').select(POSTING_COLS).eq('id', id).maybeSingle()),
    outreach: (id) => one(sb.from('outreach').select('id,company,role,job_url').eq('id', id).maybeSingle()),
    postingByUrl: (url) => one(sb.from('postings').select(POSTING_COLS).eq('url', url).limit(1).maybeSingle()),
    async insertApplication(row) { await one(sb.from('applications').insert(row)); },
    async markPostingApplied(id) { await one(sb.from('postings').update({ status: 'applied' }).eq('id', id)); },
    async removeApplied(company, role, day) {
      const apps = sb.from('applications').delete().eq('company', company).eq('applied_on', day);
      await one(role === null ? apps.is('role', null) : apps.eq('role', role));
      const posts = sb.from('postings').update({ status: 'seen' }).eq('status', 'applied').eq('company', company);
      await one(role === null ? posts : posts.eq('title', role));
    },
  };
}

// ---------- ops ----------

export interface OpDeps { sheets: SheetsApi; store: AppStore; now: Date }
export interface OpResult { code: number; body: unknown }

async function readSheet(sheets: SheetsApi) {
  const values = await sheets.values();
  const header = findHeader(values);
  // The first data row across A:Z carries each column's cell validation; the response also lists the Tables.
  const meta = await sheets.meta(`${TAB}!A${header.row + 1}:Z${header.row + 1}`);
  return { values, header, meta, options: statusOptions(meta, header) };
}

/** The dropdown's own spelling of `value`, or null if it isn't there. Anything passes when the column has no dropdown. */
const allowed = (options: string[], value: string) => (options.length ? options.find((o) => norm(o) === norm(value)) ?? null : value);

/** After the Sheet write succeeded, a Supabase problem must not look like a failed write. */
async function syncAfterWrite(op: string, write: () => Promise<boolean>): Promise<OpResult> {
  try {
    return { code: 200, body: { ok: true, synced: await write() } };
  } catch (e) {
    console.error(`sheet: ${op} wrote the Sheet but the app row update failed:`, e instanceof Error ? e.name : typeof e);
    return { code: 200, body: { ok: true, synced: false } };
  }
}

export async function runOp(input: OpInput, { sheets, store, now }: OpDeps): Promise<OpResult> {
  if (input.op === 'statuses') return { code: 200, body: { statuses: (await readSheet(sheets)).options } };

  if (input.op === 'set_status') {
    const { values, header, options } = await readSheet(sheets);
    const status = allowed(options, input.status);
    if (!status) return { code: 400, body: { error: MSG.dropdown } };
    // Ids change on every worker sync (delete + insert), so a missing id falls back to what the client saw.
    // Either way resolveRow re-checks Company and Role against the Sheet, so the client can't aim at another job.
    const app = await store.application(input.application_id);
    if (app && (norm(app.company) !== norm(input.company) || norm(app.role) !== norm(input.role))) return { code: 409, body: { error: MSG.notFound } };
    const company = app?.company ?? input.company;
    const role = app ? app.role : input.role;
    const row = header.cols.status !== undefined ? resolveRow(values, header, app?.sheet_row ?? input.sheet_row, company, role) : null;
    if (row === null) return { code: 409, body: { error: MSG.notFound } };
    await sheets.updateCell(`${TAB}!${colLetter(header.cols.status!)}${row}`, safeCell(status));
    const patch = { status, stage: statusStage(status), sheet_row: row };
    return syncAfterWrite('set_status', async () => {
      if (app) return (await store.updateApplications({ id: app.id }, patch)) > 0;
      if ((await store.updateApplications({ sheet_row: row, company }, patch)) > 0) return true;
      return (await store.updateApplications({ company, role }, patch)) > 0;
    });
  }

  if (input.op === 'unapply') {
    const { values, header } = await readSheet(sheets);
    const row = resolveRow(values, header, input.sheet_row, input.company, input.role);
    if (row === null) return { code: 409, body: { error: MSG.notFound } };
    const cells = values[row - 1];
    const day = detroitDay(now);
    // Only the row "I applied" just added: still Applied, dated today. Anything older is real history.
    const fresh = norm(cell(cells, header.cols.status)) === 'applied'
      && norm(cell(cells, header.cols.applied_on)) === norm(formatDate(day, detectDateFormat(values, header)));
    if (!fresh) return { code: 409, body: { error: MSG.undoLate } };
    await sheets.deleteRow(row);
    return syncAfterWrite('unapply', async () => {
      await store.removeApplied(input.company, input.role, formatDate(day, 'YYYY-MM-DD'));
      return true;
    });
  }

  // applied
  let job: { company: string; role: string | null; term: string | null; location: string | null; postingId: string | null } | null = null;
  if (input.posting_id) {
    const p = await store.posting(input.posting_id);
    if (p) job = { company: p.company, role: p.title, term: p.term, location: p.location, postingId: p.id };
  } else if (input.outreach_id) {
    const o = await store.outreach(input.outreach_id);
    if (o) {
      const p = await store.postingByUrl(o.job_url);
      const company = o.company ?? p?.company;
      if (company) job = { company, role: o.role ?? p?.title ?? null, term: p?.term ?? null, location: p?.location ?? null, postingId: p?.id ?? null };
    }
  }
  if (!job) return { code: 404, body: { error: MSG.noJob } };

  const { values, header, meta, options } = await readSheet(sheets);
  const status = allowed(options, 'Applied');
  if (!status) return { code: 400, body: { error: MSG.dropdown } };
  if (!input.force && hasDuplicate(values, header, job.company, job.role)) return { code: 409, body: { duplicate: true, error: MSG.duplicate } };

  const day = detroitDay(now);
  // Track and Priority are dropdowns too: write only a value the dropdown allows, else leave the cell alone.
  const track = allowed(columnOptions(meta, header, 'track'), guessTrack(job.role ?? ''));
  const priority = allowed(columnOptions(meta, header, 'priority'), 'Unranked');
  const cells = buildRow(header, {
    company: job.company, role: job.role ?? '', track, term: job.term ?? '', location: job.location ?? '',
    status, priority, applied_on: formatDate(day, detectDateFormat(values, header)),
  });
  // Append inside the Table's columns so the Table extends; fall back to A:Z when the Sheet has no Table.
  const r = pickTable(meta, header)?.range;
  const start = r?.startColumnIndex ?? 0;
  const end = r?.endColumnIndex ?? Math.max(cells.length, start + 1);
  const range = r ? `${TAB}!${colLetter(start)}${header.row}:${colLetter(end - 1)}` : `${TAB}!A${header.row}:Z`;
  const updated = await sheets.append(range, dropTrailingNulls(cells.slice(start, end)));
  if (startColumn(updated) !== colLetter(start)) {
    console.error(`sheet: LAYOUT MISMATCH: appended at ${startColumn(updated) ?? '?'} but the table starts at ${colLetter(start)}; check the Applications tab`);
    return { code: 500, body: { error: MSG.layout } };
  }
  return syncAfterWrite('applied', async () => {
    await store.insertApplication({
      company: job.company, role: job.role, track, term: job.term, location: job.location, status, stage: statusStage(status),
      priority, applied_on: formatDate(day, 'YYYY-MM-DD'), sheet_row: rowFromUpdatedRange(updated), row_hash: rowHash(cells),
    });
    if (job.postingId) await store.markPostingApplied(job.postingId);
    return true;
  });
}

// ---------- handler ----------

export function bearer(header: string | string[] | undefined): string | null {
  const h = Array.isArray(header) ? header[0] : header;
  const m = /^Bearer\s+(.+)$/i.exec(h ?? '');
  return m ? m[1].trim() : null;
}

function isAuthRejection(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' && status >= 400 && status < 500;
}

function serviceAccount(raw: string | undefined): ServiceAccount | null {
  try {
    const sa = JSON.parse(raw ?? '') as Partial<ServiceAccount>;
    return sa.client_email && sa.private_key ? { client_email: sa.client_email, private_key: sa.private_key } : null;
  } catch {
    return null;
  }
}

const kind = (e: unknown) => (e instanceof Error ? e.name : typeof e);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'GET or POST only' });
  }
  const token = bearer(req.headers.authorization);
  if (!token) return res.status(401).json({ error: MSG.missingToken });
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  const sheetId = process.env.SHEET_ID;
  const ownerId = process.env.LOCKIN_OWNER_ID?.trim();
  const sa = serviceAccount(process.env.GOOGLE_SA_JSON);
  // Fail closed: without LOCKIN_OWNER_ID nobody may write.
  if (!url || !anon || !sheetId || !ownerId || !sa) {
    console.error('sheet: server is missing SUPABASE_URL / SUPABASE_ANON_KEY / SHEET_ID / LOCKIN_OWNER_ID / GOOGLE_SA_JSON');
    return res.status(500).json({ error: MSG.config });
  }
  const sb = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const { data, error } = await sb.auth.getUser(token);
    if (error && !isAuthRejection(error)) {
      console.error('sheet: getUser failed');
      return res.status(503).json({ error: MSG.retry });
    }
    if (error || !data.user) return res.status(401).json({ error: MSG.session });
    // Only Adam may write to the Sheet: the user must be LOCKIN_OWNER_ID and own the settings row.
    if (data.user.id !== ownerId) return res.status(403).json({ error: MSG.forbidden });
    const { data: s, error: sErr } = await sb.from('settings').select('owner').limit(1).maybeSingle();
    if (sErr) throw new Error(sErr.message);
    if (!s || (s as { owner?: string }).owner !== data.user.id) return res.status(403).json({ error: MSG.forbidden });
  } catch (e) {
    console.error('sheet: auth check threw:', kind(e));
    return res.status(503).json({ error: MSG.retry });
  }
  const input = parseInput(req.method, req.query as Record<string, unknown>, req.body);
  if (!input) return res.status(400).json({ error: MSG.bad });
  try {
    const gToken = await googleToken(sa);
    const out = await runOp(input, { sheets: googleSheets(sheetId, gToken), store: supabaseAppStore(sb), now: new Date() });
    return res.status(out.code).json(out.body);
  } catch (e) {
    // Log the kind only (e.g. "GoogleError: Sheets HTTP 403"); never Google bodies, tokens or row data.
    console.error(`sheet: ${input.op} failed:`, e instanceof GoogleError ? `GoogleError: ${e.message}` : kind(e));
    return res.status(e instanceof GoogleError ? 502 : 500).json({ error: MSG.google });
  }
}
