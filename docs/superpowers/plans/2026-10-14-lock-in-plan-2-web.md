# Lock In — Plan 2: Web app (PWA on Vercel)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The installable Lock In web app in `web/`: Today, LeetCode, Projects, Applications, Jobs, Outreach and Settings screens over Plan 1's Supabase tables, a `sync-leetcode` Vercel function that checks off solves seconds after they happen, and a demo mode that runs the whole UI on fixture data for tests and design review.

**Architecture:** React 19 + Vite + TypeScript (strict). All "what should this screen show" logic lives in pure functions under `src/lib/` with Vitest tests (plan day, today's list, streaks, funnel, job filters, outreach state, idea ordering, heatmap, staleness). Data goes through one `DataApi` interface with two implementations: `createSupabaseApi` (supabase-js with Adam's session, RLS does the scoping) and `createDemoApi` (in-memory fixtures, picked when `VITE_DEMO=1`). Screens read through TanStack Query hooks in `src/data/hooks.ts` and never touch supabase-js directly. `web/api/sync-leetcode.ts` is a Vercel Node function that authenticates the caller's Supabase JWT and inserts new `lc_solves` rows with that same token.

**Tech Stack (exact pins):** react 19.1.1, react-dom 19.1.1, react-router 7.8.2, @tanstack/react-query 5.87.1, @supabase/supabase-js 2.57.4, lucide-react 0.544.0; dev: vite 7.1.5, @vitejs/plugin-react 5.0.2, typescript 5.9.2, vite-plugin-pwa 1.0.3, @vite-pwa/assets-generator 1.0.1, workbox-window 7.3.0, vitest 3.2.4, jsdom 26.1.0, @testing-library/react 16.3.0, @testing-library/jest-dom 6.8.0, @testing-library/user-event 14.6.1, @playwright/test 1.55.0, @axe-core/playwright 4.10.2, @vercel/node 5.3.21, @types/node 22.18.0, @types/react 19.1.12, @types/react-dom 19.1.9, eslint 9.35.0, @eslint/js 9.35.0, typescript-eslint 8.43.0, eslint-plugin-react-hooks 5.2.0, globals 16.4.0.

**Spec:** `docs/superpowers/specs/2026-10-14-lock-in-design.md` (read §1, §3, §4, §5, §6 "Sync on open" and "Rating", §7, §8 steps 1, 5, 6, §10 stage mapping, §12, §13). Plan 1 (`docs/superpowers/plans/2026-10-14-lock-in-plan-1-backend.md`) Task 2 defines every table and column this plan reads; Task 7 defines `STAGE_RULES`; Task 10 defines `lc_daily_sets.items` as `[{slug, slot, order, done}]`.

**Depends on:** Plan 1 Tasks 1–2 (schema) and 7 (`worker/lockin_worker/sheet.py`, read by a drift test in Task 2). Plan 3 Task 1 (owner of `prompts/outreach.md` and `prompts/suggest_ideas.md`) must be committed before Task 10 of this plan; this plan never creates or edits files in `prompts/`.

## Global Constraints

- Every "today": time zone `America/Detroit`. **Plan day = local date of (now − 4 h)** (same as the worker). Streaks use the local calendar day of the event. A set item counts as done in the UI when `items[].done` is true **or** `lc_solves` has that slug with `accepted_at` in the plan day.
- Data access is supabase-js with Adam's session; RLS (`owner = auth.uid()`) does the scoping, inserts rely on the `owner` default. The web writes **only**: `lc_solves.rating/rated_at/note`; `ideas` (insert, `status`, `position`, `today_on`, `done_at`, `text`); `postings.status`; `outreach` (insert, `status`, `sent_on`, `follow_up_on = sent_on + 5 days`); `launch_requests` (insert); `settings` (`nudge_times`, `daily_lc_count`, `weekly_app_target`, `resume_root`, `app_url`, and `lc_focus_topic`/`lc_focus_since` for the spec §5/§6 focus override); `projects` (insert, `active`). The sync function additionally inserts `lc_solves` and upserts `worker_state` key `web_sync`. Everything else is read-only.
- Topic tags come from the `topics` table. `problems.lc_tags` is always an empty array (Plan 1 Task 11) and must not be read.
- Auth: Supabase email sign-in with sign-ups disabled server-side (`shouldCreateUser: false`). The sign-in screen accepts the emailed link **or** the 6-digit code from the same email, because an iPhone home-screen PWA doesn't share storage with Safari, so a link opened from Mail would sign in Safari, not the PWA.
- Links: any URL from data (postings, contacts, outreach, pasted text) is rendered as a link only if `safeHref()` returns it (http/https). Everything else renders as plain text. Never rely on the worker's sanitizing alone.
- UX rules (Adam: "it's pointless if it's confusing, overly wordy"): each screen leads with one primary element marked `data-primary`; details sit behind a tap (`<details>`); headings are 1–2 words; button labels are at most 3 words and 24 characters; empty states are at most 8 words; nothing renders unless it's actionable today (zero counts are hidden, not shown as 0).
- Visual: dark-first (light via `prefers-color-scheme`), one accent color, LeetCode difficulty colors easy teal / medium amber / hard red. Phone 390 px and desktop 1280 px are both first-class. Tap targets ≥ 44 × 44 px, visible `:focus-visible`, WCAG 2.2 AA contrast.
- Demo mode: `VITE_DEMO=1` swaps in `createDemoApi()` and a signed-in demo auth. Playwright and design review always run in demo mode; no test touches a real Supabase or LeetCode.
- The browser bundle contains only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. The service-role key never appears in `web/`.
- Commits keep the repo-local git identity (`adamkuhn1 <184679495+adamkuhn1@users.noreply.github.com>`; Vercel Hobby blocks other authors). Never run `git config`. Another agent may commit on the same branch: `git add` only the paths your task lists. End commit messages with the attribution trailer lines the harness provides.
- Commands run from `web/` unless a step says otherwise.

## Review Focus

1. **Opening the app between midnight and 4 AM, or solving near that boundary.** Today must still show the previous plan day's set, and a 1:30 AM solve checks off that set's item. Pinned by `planDay before 4 AM is the previous day` and `counts a 1:30 AM solve toward the previous plan day` (Task 2).
2. **The same problem accepted twice in one plan day, or rated and then re-submitted.** One rating prompt, attached to the first solve, and it disappears once any solve that day is rated. Pinned by `rates the first solve and stops asking once any solve that day is rated` (Task 2).
3. **Hostile or odd URLs** (`javascript:` in a posting or LinkedIn field, `ftp:`, a pasted string that isn't a URL). They render as text, never as a link, and the paste box rejects them. Pinned by the `safeHref` and `isJobUrl` tests (Task 2) and `Jobs renders a javascript: URL as text` (Task 9).
4. **The sync function hammered or failing** (app foregrounded ten times a minute, LeetCode down, an expired or missing token). At most one LeetCode call per 60 s, 401 without a valid token, 502 with a message when LeetCode fails, and the UI stays usable. Pinned by `runSync` and handler tests (Task 5).
5. **A fresh account** (no daily set yet, no topic states, no applications, no settings row). Each screen shows a short empty state instead of crashing. Pinned by `roadmapRows defaults` (Task 2), `getSettings explains a missing row` (Task 3) and `Today before the first set` (Task 6).

---

## File Structure

```
lock-in/
├── .github/workflows/ci.yml          # + web job (Task 1; e2e added in Task 11)
├── docs/setup.md                     # + "Web app (Vercel)" section (Task 12)
└── web/
    ├── package.json  package-lock.json  tsconfig.json  vite.config.ts  eslint.config.js
    ├── playwright.config.ts  vercel.json  index.html  .env.example  .gitignore
    ├── public/icon.svg (+ generated PNG/ICO icons)
    ├── api/sync-leetcode.ts           # Vercel function: pure parts + handler (Task 5)
    ├── tests/api/sync-leetcode.test.ts  tests/deploy.test.ts   # kept out of api/ so Vercel doesn't deploy them
    ├── e2e/smoke.spec.ts  e2e/flows.spec.ts                   # Playwright, demo mode (Task 11)
    └── src/
        ├── main.tsx  App.tsx
        ├── styles/tokens.css  styles/app.css
        ├── lib/        time.ts today.ts streaks.ts funnel.ts jobs.ts outreach.ts ideas.ts
        │               levels.ts heatmap.ts sync.ts stages.ts url.ts prompt.ts  (+ *.test.ts)
        ├── data/       types.ts api.ts supabase.ts demo.ts fixtures.ts auth.ts context.tsx hooks.ts (+ tests)
        ├── ui/         AppShell.tsx SignIn.tsx primitives.tsx (+ tests)
        ├── screens/    Today.tsx LeetCode.tsx Projects.tsx Applications.tsx Jobs.tsx Outreach.tsx Settings.tsx (+ tests)
        └── test/       setup.ts render.tsx
```

---

### Task 1: Scaffold `web/`, time helpers, PWA shell, CI

**Files:**
- Create: `web/package.json`, `web/tsconfig.json`, `web/vite.config.ts`, `web/eslint.config.js`, `web/index.html`, `web/.gitignore`, `web/.env.example`, `web/public/icon.svg`, `web/src/main.tsx` (temporary, replaced in Task 4), `web/src/styles/tokens.css`, `web/src/test/setup.ts`, `web/src/lib/time.ts`, `web/src/lib/time.test.ts`
- Modify: `.github/workflows/ci.yml` (append a `web` job)

**Interfaces:**
- Produces:
  - `time.TZ = 'America/Detroit'`
  - `time.localDay(d: Date): string` (`YYYY-MM-DD`)
  - `time.planDay(now: Date): string`
  - `time.addDays(iso: string, n: number): string`
  - `time.daysBetween(a: string, b: string): number` (b − a)
  - `time.weekStart(iso: string): string` (Monday)
  - `time.relativeTime(iso: string, now: Date): string` (`just now`, `5m ago`, `3h ago`, `2d ago`)
  - `time.shortDate(iso: string): string` (`Oct 14`)
  - npm scripts `dev`, `dev:demo` (port 5199), `build`, `typecheck`, `lint`, `test`, `e2e`, `icons`

- [ ] **Step 1: Create the package**

`web/package.json`:
```json
{
  "name": "lock-in-web",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "dev": "vite",
    "dev:demo": "VITE_DEMO=1 vite --port 5199 --strictPort",
    "build": "tsc --noEmit && vite build",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "test": "vitest run",
    "e2e": "playwright test",
    "icons": "pwa-assets-generator --preset minimal-2023 public/icon.svg"
  },
  "dependencies": {
    "@supabase/supabase-js": "2.57.4",
    "@tanstack/react-query": "5.87.1",
    "lucide-react": "0.544.0",
    "react": "19.1.1",
    "react-dom": "19.1.1",
    "react-router": "7.8.2"
  },
  "devDependencies": {
    "@axe-core/playwright": "4.10.2",
    "@eslint/js": "9.35.0",
    "@playwright/test": "1.55.0",
    "@testing-library/jest-dom": "6.8.0",
    "@testing-library/react": "16.3.0",
    "@testing-library/user-event": "14.6.1",
    "@types/node": "22.18.0",
    "@types/react": "19.1.12",
    "@types/react-dom": "19.1.9",
    "@vercel/node": "5.3.21",
    "@vite-pwa/assets-generator": "1.0.1",
    "@vitejs/plugin-react": "5.0.2",
    "eslint": "9.35.0",
    "eslint-plugin-react-hooks": "5.2.0",
    "globals": "16.4.0",
    "jsdom": "26.1.0",
    "typescript": "5.9.2",
    "typescript-eslint": "8.43.0",
    "vite": "7.1.5",
    "vite-plugin-pwa": "1.0.3",
    "vitest": "3.2.4",
    "workbox-window": "7.3.0"
  }
}
```
Run: `cd web && npm install` (creates `package-lock.json`). Expected: no `ERESOLVE` errors.

`web/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["vite/client", "node", "@testing-library/jest-dom/vitest"]
  },
  "include": ["src", "api", "tests", "e2e", "vite.config.ts", "playwright.config.ts"]
}
```

`web/vite.config.ts`:
```ts
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png', 'icon.svg'],
      manifest: {
        name: 'Lock In',
        short_name: 'Lock In',
        description: 'What to do today, and whether you did it.',
        start_url: '/',
        display: 'standalone',
        background_color: '#0b0d10',
        theme_color: '#0b0d10',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
      },
    }),
  ],
  // Task 10 imports ../prompts/*.md?raw from the repo root.
  server: { fs: { allow: ['..'] } },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.ts'],
    css: false,
  },
});
```

`web/eslint.config.js`:
```js
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'dev-dist', 'playwright-report', 'test-results', 'e2e/__screens__'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
);
```

`web/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#0b0d10" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="Lock In" />
    <link rel="icon" href="/favicon.ico" sizes="any" />
    <link rel="icon" href="/icon.svg" type="image/svg+xml" />
    <link rel="apple-touch-icon" href="/apple-touch-icon-180x180.png" />
    <title>Lock In</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`web/.gitignore`:
```
node_modules/
dist/
dev-dist/
.env*.local
.vercel/
playwright-report/
test-results/
e2e/__screens__/
```

`web/.env.example`:
```
# Browser (build-time). Supabase → Settings → API.
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
# Serverless function /api/sync-leetcode (Vercel env, not exposed to the browser).
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_ANON_KEY=<anon key>
# Set to 1 to run on fixture data with no Supabase.
VITE_DEMO=
```

`web/public/icon.svg` (dark tile, lime check inside a ring):
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#0b0d10"/>
  <circle cx="256" cy="256" r="150" fill="none" stroke="#c4f04d" stroke-width="40"/>
  <path d="M190 262l46 46 92-104" fill="none" stroke="#c4f04d" stroke-width="44" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
```
Generate the PNG/ICO icons: `npm run icons`. Expected: `public/` now has `favicon.ico`, `pwa-64x64.png`, `pwa-192x192.png`, `pwa-512x512.png`, `maskable-icon-512x512.png`, `apple-touch-icon-180x180.png`. Commit them (they are build inputs).

`web/src/styles/tokens.css`:
```css
:root {
  color-scheme: dark;
  --bg: #0b0d10;
  --surface: #14171c;
  --surface-2: #1c2027;
  --border: #2a2f38;
  --text: #e8eaed;
  --muted: #9aa3ae;
  --accent: #c4f04d;
  --accent-ink: #0b0d10;
  --accent-soft: rgb(196 240 77 / 0.14);
  --easy: #2cbbb0;
  --medium: #ffb800;
  --hard: #ff5c75;
  --danger: #ff6b6b;
  --warn: #ffb800;
  --radius: 14px;
  --radius-sm: 10px;
  --gap: 12px;
  --tap: 44px;
  --nav-h: 64px;
  --font: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --mono: ui-monospace, "SF Mono", Menlo, monospace;
}

@media (prefers-color-scheme: light) {
  :root {
    color-scheme: light;
    --bg: #f6f7f9;
    --surface: #ffffff;
    --surface-2: #eef0f3;
    --border: #d9dde3;
    --text: #111418;
    --muted: #5b6470;
    --accent: #4d7c0f;
    --accent-ink: #ffffff;
    --accent-soft: rgb(77 124 15 / 0.12);
    --easy: #00796b;
    --medium: #9a6200;
    --hard: #c62845;
    --danger: #c62828;
    --warn: #9a6200;
  }
}
```

`web/src/test/setup.ts`:
```ts
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => cleanup());
```

Temporary `web/src/main.tsx` (Task 4 replaces it):
```tsx
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';

createRoot(document.getElementById('root')!).render(<h1>Lock In</h1>);
```

- [ ] **Step 2: Write the failing time tests**

`web/src/lib/time.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, localDay, planDay, relativeTime, shortDate, weekStart } from './time';

describe('time', () => {
  it('localDay uses Detroit, not UTC (23:50 EDT)', () => {
    expect(localDay(new Date('2026-10-15T03:50:00Z'))).toBe('2026-10-14');
  });
  it('planDay before 4 AM is the previous day', () => {
    expect(planDay(new Date('2026-10-15T07:30:00Z'))).toBe('2026-10-14'); // 03:30 EDT
  });
  it('planDay at 4 AM is the new day', () => {
    expect(planDay(new Date('2026-10-15T08:00:00Z'))).toBe('2026-10-15'); // 04:00 EDT
  });
  it('planDay in winter (EST, UTC-5)', () => {
    expect(planDay(new Date('2026-12-02T08:30:00Z'))).toBe('2026-12-01'); // 03:30 EST
    expect(planDay(new Date('2026-12-02T09:00:00Z'))).toBe('2026-12-02'); // 04:00 EST
  });
  it('addDays crosses month and year ends', () => {
    expect(addDays('2026-10-30', 5)).toBe('2026-11-04');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-11-04', -5)).toBe('2026-10-30');
  });
  it('daysBetween', () => {
    expect(daysBetween('2026-10-03', '2026-10-14')).toBe(11);
    expect(daysBetween('2026-10-14', '2026-10-14')).toBe(0);
  });
  it('weekStart is Monday', () => {
    expect(weekStart('2026-10-14')).toBe('2026-10-12'); // Wednesday
    expect(weekStart('2026-10-18')).toBe('2026-10-12'); // Sunday
    expect(weekStart('2026-10-12')).toBe('2026-10-12'); // Monday
  });
  it('relativeTime', () => {
    const now = new Date('2026-10-14T12:00:00Z');
    expect(relativeTime('2026-10-14T11:59:30Z', now)).toBe('just now');
    expect(relativeTime('2026-10-14T11:55:00Z', now)).toBe('5m ago');
    expect(relativeTime('2026-10-14T09:00:00Z', now)).toBe('3h ago');
    expect(relativeTime('2026-10-12T12:00:00Z', now)).toBe('2d ago');
  });
  it('shortDate', () => {
    expect(shortDate('2026-10-14')).toBe('Oct 14');
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npx vitest run src/lib/time.test.ts`
Expected: FAIL with `Failed to resolve import "./time"`.

- [ ] **Step 4: Implement `time.ts`**

`web/src/lib/time.ts`:
```ts
export const TZ = 'America/Detroit';
const PLAN_DAY_START_MS = 4 * 3_600_000;
const DAY_MS = 86_400_000;

const dayFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function localDay(d: Date): string {
  const p: Record<string, string> = {};
  for (const part of dayFmt.formatToParts(d)) p[part.type] = part.value;
  return `${p.year}-${p.month}-${p.day}`;
}

export function planDay(now: Date): string {
  return localDay(new Date(now.getTime() - PLAN_DAY_START_MS));
}

function utcMidnight(iso: string): number {
  return Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
}

export function addDays(iso: string, n: number): string {
  return new Date(utcMidnight(iso) + n * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((utcMidnight(b) - utcMidnight(a)) / DAY_MS);
}

export function weekStart(iso: string): string {
  const dow = (new Date(utcMidnight(iso)).getUTCDay() + 6) % 7; // Monday = 0
  return addDays(iso, -dow);
}

export function relativeTime(iso: string, now: Date): string {
  const s = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function shortDate(iso: string): string {
  return new Date(utcMidnight(iso)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
```

- [ ] **Step 5: Run the tests, typecheck, lint and build**

Run: `npx vitest run src/lib/time.test.ts && npm run typecheck && npm run lint && npm run build`
Expected: 9 tests pass; tsc and eslint print nothing; `vite build` ends with `PWA v1.0.3 … files generated` and lists `dist/sw.js` and `dist/manifest.webmanifest`. Check: `grep -q '"name":"Lock In"' dist/manifest.webmanifest && echo ok` → `ok`.

- [ ] **Step 6: Add the web CI job**

Append to `.github/workflows/ci.yml` under `jobs:` (keep Plan 1's `worker` job unchanged):
```yaml
  web:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: web } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm, cache-dependency-path: web/package-lock.json }
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
```

- [ ] **Step 7: Commit**

```bash
git add web/package.json web/package-lock.json web/tsconfig.json web/vite.config.ts web/eslint.config.js web/index.html web/.gitignore web/.env.example web/public web/src/main.tsx web/src/styles/tokens.css web/src/test/setup.ts web/src/lib/time.ts web/src/lib/time.test.ts .github/workflows/ci.yml
git commit -m "Scaffold Lock In web app with PWA shell, time helpers and CI"
```

---

### Task 2: Pure domain helpers (what each screen shows)

**Files:**
- Create: `web/src/data/types.ts`, `web/src/lib/url.ts`, `web/src/lib/today.ts`, `web/src/lib/streaks.ts`, `web/src/lib/funnel.ts`, `web/src/lib/jobs.ts`, `web/src/lib/outreach.ts`, `web/src/lib/ideas.ts`, `web/src/lib/levels.ts`, `web/src/lib/heatmap.ts`, `web/src/lib/sync.ts`, `web/src/lib/stages.ts`, `web/src/lib/prompt.ts`, and one `*.test.ts` beside each lib file

**Interfaces:**
- Consumes: `time.*` (Task 1)
- Produces (every later task imports these exact names):
  - `types.ts`: `Rating, Slot, Difficulty, Level, Stage, IdeaStatus, PostingStatus, OutreachStatus, LaunchStatus, Confidence, Settings, SettingsPatch, SetItem, DailySet, Problem, Topic, TopicState, ProblemState, Solve, Project, NewProject, Commit, Idea, NewIdea, IdeaPatch, Application, Posting, Outreach, OutreachPatch, Contact, LaunchRequest, LaunchKind, SyncStatus, SyncResult`
  - `url.safeHref(url: string | null | undefined): string | null`, `url.isJobUrl(s: string): boolean`, `url.hostOf(url: string): string`
  - `today.problemUrl(slug): string`, `today.RATINGS: {value: Rating; emoji: string; label: string}[]`, `today.TodayItem`, `today.buildTodayItems(set, solves, problems: Map<string, Problem>, day): TodayItem[]`
  - `streaks.streak(days: Set<string>, today: string): number`, `streaks.streaks(solves, commits, apps, now: Date): {leetcode: number; project: number; apps: number}`, `streaks.dayNumber(startedOn: string | null, day: string): number | null`
  - `funnel.REFERENCE`, `funnel.FunnelRow`, `funnel.funnel(apps): FunnelRow[]`, `funnel.appliedThisWeek(apps, today): number`, `funnel.STAGE_LABEL`, `funnel.BOARD_ORDER`, `funnel.groupByStage(apps): [Stage, Application[]][]`, `funnel.searchApps(apps, q): Application[]`
  - `jobs.Track`, `jobs.JobFilters`, `jobs.NO_FILTERS`, `jobs.postingTrack(title): Track | null`, `jobs.locationKey(loc): string | null`, `jobs.filterPostings(ps, f): Posting[]`, `jobs.sortPostings(ps): Posting[]`, `jobs.topLocations(ps, n?): string[]`, `jobs.termsOf(ps): string[]`
  - `outreach.FOLLOW_UP_DAYS = 5`, `outreach.followUpOn(sentOn): string`, `outreach.followUpsDue(list, today): Outreach[]`, `outreach.Phase`, `outreach.outreachPhase(o, requests, today): Phase`, `outreach.PHASE_LABEL`, `outreach.sortOutreach(list, requests, today): Outreach[]`
  - `ideas.visibleIdeas(ideas, projectId): Idea[]`, `ideas.doneIdeas(ideas, projectId): Idea[]`, `ideas.moveIdea(list, id, dir: -1 | 1): {id: string; position: number}[]`, `ideas.nextPosition(list): number`, `ideas.todaysIdea(ideas, day): Idea | null`, `ideas.swapCandidate(ideas, current): Idea | null`, `ideas.commitStrip(commits, projectId, today, days?): number[]`, `ideas.suggestState(requests, projectId): {kind: 'idle'} | {kind: 'queued'} | {kind: 'failed'; error: string}`
  - `levels.LEVEL_LABEL`, `levels.roadmapRows(topics, states, focus): {tier: number; topics: {name: string; level: Level; isFocus: boolean; prereqs: string[]}[]}[]`, `levels.reviewQueue(states, problems, today): {state: ProblemState; problem: Problem | null}[]`, `levels.upcomingReviews(states, today, days): number`, `levels.topicCounts(solves, problems, topic): {Easy: number; Medium: number; Hard: number}`
  - `heatmap.heatmap(solves, today, weeks?): {day: string; count: number; future: boolean}[][]`, `heatmap.intensity(count): 0 | 1 | 2 | 3 | 4`
  - `sync.STALE_HOURS = 2`, `sync.isStale(row, now): boolean`, `sync.anyStale(rows, now): boolean`, `sync.SOURCE_LABEL`
  - `stages.STAGE_RULES: [pattern: string, stage: Stage][]`
  - `prompt.renderTemplate(tpl, values): string`, `prompt.TemplateError`

- [ ] **Step 1: Write the shared types** (no test; consumed everywhere)

`web/src/data/types.ts`:
```ts
export type Rating = 'nailed' | 'struggled' | 'help';
export type Slot = 'new' | 'review' | 'mystery' | 'spot';
export type Difficulty = 'Easy' | 'Medium' | 'Hard';
export type Level = 'locked' | 'available' | 'learning' | 'practicing' | 'solid' | 'mastered';
export type Stage = 'applied' | 'oa' | 'interview' | 'offer' | 'closed' | 'other';
export type IdeaStatus = 'todo' | 'today' | 'done' | 'dropped';
export type PostingStatus = 'new' | 'seen' | 'dismissed' | 'outreach';
export type OutreachStatus = 'queued' | 'drafted' | 'sent' | 'replied' | 'closed';
export type LaunchStatus = 'queued' | 'launched' | 'failed';
export type LaunchKind = 'outreach' | 'suggest_ideas';
export type Confidence = 'verified' | 'pattern' | 'guess';

export interface Settings {
  nudge_times: string[];
  daily_lc_count: number;
  weekly_app_target: number;
  ntfy_topic: string | null;
  resume_root: string;
  sheet_id: string | null;
  lc_username: string;
  lc_started_on: string | null;
  lc_focus_topic: string | null;
  lc_focus_since: string | null;
  app_url: string | null;
}
export type SettingsPatch = Partial<
  Pick<Settings, 'nudge_times' | 'daily_lc_count' | 'weekly_app_target' | 'resume_root' | 'app_url' | 'lc_focus_topic' | 'lc_focus_since'>
>;

export interface SetItem { slug: string; slot: Slot; order: number; done: boolean }
export interface DailySet { day: string; focus: string; mixed_day: boolean; items: SetItem[] }

export interface Problem {
  slug: string;
  lc_id: number | null;
  title: string;
  difficulty: Difficulty;
  topic: string;
  lists: string[];
  paid_only: boolean;
  ac_rate: number | null;
  target_minutes: number | null;
  neetcode_link: string | null;
}
export interface Topic { name: string; ord: number; tier: number; prereqs: string[]; lc_tags: string[] }
export interface TopicState { topic: string; level: Level }
export interface ProblemState {
  slug: string;
  state: 'new' | 'learning' | 'reviewing' | 'retained' | 'parked';
  interval_days: number;
  due_on: string | null;
  lapses: number;
}
export interface Solve {
  id: number;
  slug: string;
  title: string;
  accepted_at: string;
  rating: Rating | null;
  rated_at: string | null;
  slot: Slot | null;
  note: string | null;
}

export interface Project { id: string; name: string; repo: string; local_path: string | null; active: boolean }
export type NewProject = Omit<Project, 'active'>;
export interface Commit { sha: string; project_id: string; message: string; committed_at: string }
export interface Idea {
  id: string;
  project_id: string;
  text: string;
  size: 'S' | 'M';
  status: IdeaStatus;
  source: 'me' | 'claude';
  position: number;
  today_on: string | null;
  done_at: string | null;
  created_at: string;
}
export interface NewIdea { project_id: string; text: string; size: 'S' | 'M'; position: number }
export type IdeaPatch = Partial<Pick<Idea, 'status' | 'position' | 'today_on' | 'done_at' | 'text'>>;

export interface Application {
  id: number;
  company: string;
  role: string | null;
  track: string | null;
  term: string | null;
  location: string | null;
  status: string | null;
  stage: Stage;
  priority: string | null;
  applied_on: string | null;
}
export interface Posting {
  id: string;
  company: string;
  title: string;
  location: string | null;
  url: string | null;
  term: string | null;
  posted_at: string | null;
  tier: string | null;
  starred: boolean;
  status: PostingStatus;
  found_at: string;
}
export interface Outreach {
  id: string;
  job_url: string;
  company: string | null;
  role: string | null;
  resume_path: string | null;
  status: OutreachStatus;
  sent_on: string | null;
  follow_up_on: string | null;
  created_at: string;
}
export type OutreachPatch = Partial<Pick<Outreach, 'status' | 'sent_on' | 'follow_up_on'>>;
export interface Contact {
  id: string;
  outreach_id: string;
  name: string;
  title: string | null;
  linkedin_url: string | null;
  email_guess: string | null;
  email_confidence: Confidence | null;
  why: string | null;
  draft_subject: string | null;
  draft_body: string | null;
}
export interface LaunchRequest {
  id: string;
  kind: LaunchKind;
  payload: Record<string, unknown>;
  status: LaunchStatus;
  error: string | null;
  created_at: string;
}
export interface SyncStatus { source: string; last_ok_at: string | null; last_error: string | null; consecutive_failures: number }
export type SyncResult = { status: 'ok'; added: number } | { status: 'skipped' } | { status: 'error'; message: string };
```

- [ ] **Step 2: Write the failing helper tests**

`web/src/lib/url.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { hostOf, isJobUrl, safeHref } from './url';

describe('url', () => {
  it('safeHref allows only http(s)', () => {
    expect(safeHref('https://boards.greenhouse.io/stripe/jobs/1')).toBe('https://boards.greenhouse.io/stripe/jobs/1');
    expect(safeHref('http://x.com/a')).toBe('http://x.com/a');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref(' JAVASCRIPT:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,hi')).toBeNull();
    expect(safeHref('ftp://x.com')).toBeNull();
    expect(safeHref('linkedin.com/in/a')).toBeNull();
    expect(safeHref(null)).toBeNull();
  });
  it('isJobUrl needs http(s) and a dotted host', () => {
    expect(isJobUrl('https://jobs.lever.co/ramp/1')).toBe(true);
    expect(isJobUrl('  https://jobs.lever.co/ramp/1  ')).toBe(true);
    expect(isJobUrl('jobs.lever.co/ramp')).toBe(false);
    expect(isJobUrl('https://localhost/x')).toBe(false);
    expect(isJobUrl('javascript:alert(1)')).toBe(false);
  });
  it('hostOf strips www', () => {
    expect(hostOf('https://www.amazon.jobs/en/jobs/1')).toBe('amazon.jobs');
    expect(hostOf('nope')).toBe('nope');
  });
});
```

`web/src/lib/today.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { DailySet, Problem, Solve } from '../data/types';
import { buildTodayItems } from './today';

const P = (slug: string, difficulty: Problem['difficulty'], topic: string): Problem => ({
  slug, lc_id: null, title: slug.replace(/-/g, ' '), difficulty, topic, lists: [], paid_only: false,
  ac_rate: null, target_minutes: null, neetcode_link: null,
});
const problems = new Map([
  P('two-sum', 'Easy', 'Arrays & Hashing'),
  P('best-time', 'Easy', 'Sliding Window'),
  P('daily-temperatures', 'Medium', 'Stack'),
  P('permutation-in-string', 'Medium', 'Sliding Window'),
].map((p) => [p.slug, p]));
const set: DailySet = {
  day: '2026-10-14', focus: 'Sliding Window', mixed_day: false,
  items: [
    { slug: 'best-time', slot: 'new', order: 1, done: false },
    { slug: 'two-sum', slot: 'review', order: 0, done: false },
    { slug: 'daily-temperatures', slot: 'mystery', order: 2, done: false },
    { slug: 'permutation-in-string', slot: 'new', order: 3, done: true },
  ],
};
let nextId = 1;
const S = (slug: string, at: string, rating: Solve['rating'] = null): Solve => ({
  id: nextId++, slug, title: slug, accepted_at: at, rating, rated_at: null, slot: null, note: null,
});

describe('buildTodayItems', () => {
  it('orders items and shows only off-focus topics', () => {
    const items = buildTodayItems(set, [], problems, '2026-10-14');
    expect(items.map((i) => i.slug)).toEqual(['two-sum', 'best-time', 'daily-temperatures', 'permutation-in-string']);
    expect(items[0].topicLabel).toBe('Arrays & Hashing'); // review from another topic
    expect(items[1].topicLabel).toBeNull(); // focus topic: implied by the card title
    expect(items[0].url).toBe('https://leetcode.com/problems/two-sum/');
  });
  it('hides a mystery topic until solved, then reveals it', () => {
    const before = buildTodayItems(set, [], problems, '2026-10-14')[2];
    expect(before.topicHidden).toBe(true);
    expect(before.topicLabel).toBeNull();
    const after = buildTodayItems(set, [S('daily-temperatures', '2026-10-14T15:00:00Z')], problems, '2026-10-14')[2];
    expect(after.topicHidden).toBe(false);
    expect(after.topicLabel).toBe('Stack');
  });
  it('hides every topic on a mixed day until solved', () => {
    const mixed = { ...set, mixed_day: true };
    const items = buildTodayItems(mixed, [S('two-sum', '2026-10-14T15:00:00Z')], problems, '2026-10-14');
    expect(items.filter((i) => i.topicHidden).map((i) => i.slug)).toEqual(['best-time', 'daily-temperatures', 'permutation-in-string']);
  });
  it('a fresh solve checks the item off before the worker does, and asks for a rating', () => {
    const it0 = buildTodayItems(set, [S('best-time', '2026-10-14T15:00:00Z')], problems, '2026-10-14')[1];
    expect(it0.done).toBe(true);
    expect(it0.needsRating).toBe(true);
  });
  it('counts a 1:30 AM solve toward the previous plan day', () => {
    const items = buildTodayItems(set, [S('best-time', '2026-10-15T05:30:00Z')], problems, '2026-10-14'); // 01:30 EDT Oct 15
    expect(items[1].done).toBe(true);
  });
  it('ignores a solve from another plan day', () => {
    const items = buildTodayItems(set, [S('best-time', '2026-10-13T15:00:00Z')], problems, '2026-10-14');
    expect(items[1].done).toBe(false);
  });
  it('worker done flag without a loaded solve: done, no rating prompt', () => {
    const it3 = buildTodayItems(set, [], problems, '2026-10-14')[3];
    expect(it3.done).toBe(true);
    expect(it3.needsRating).toBe(false);
  });
  it('rates the first solve and stops asking once any solve that day is rated', () => {
    const first = S('best-time', '2026-10-14T13:00:00Z');
    const second = S('best-time', '2026-10-14T14:00:00+00:00');
    const unrated = buildTodayItems(set, [second, first], problems, '2026-10-14')[1];
    expect(unrated.solve?.id).toBe(first.id);
    const ratedSecond = { ...second, rating: 'nailed' as const };
    const done = buildTodayItems(set, [ratedSecond, first], problems, '2026-10-14')[1];
    expect(done.needsRating).toBe(false);
    expect(done.solve?.rating).toBe('nailed');
  });
  it('falls back to the slug when a problem is unknown', () => {
    const odd = { ...set, items: [{ slug: 'not-in-bank', slot: 'new' as const, order: 0, done: false }] };
    expect(buildTodayItems(odd, [], problems, '2026-10-14')[0].title).toBe('not in bank');
  });
});
```

`web/src/lib/streaks.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { Application, Commit, Solve } from '../data/types';
import { dayNumber, streak, streaks } from './streaks';

describe('streaks', () => {
  it('counts back from today, or from yesterday if today is not done yet', () => {
    expect(streak(new Set(['2026-10-14', '2026-10-13', '2026-10-12']), '2026-10-14')).toBe(3);
    expect(streak(new Set(['2026-10-13', '2026-10-12']), '2026-10-14')).toBe(2);
    expect(streak(new Set(['2026-10-12']), '2026-10-14')).toBe(0);
    expect(streak(new Set(), '2026-10-14')).toBe(0);
  });
  it('uses the Detroit calendar day of each event', () => {
    const solve = { accepted_at: '2026-10-15T03:50:00Z' } as Solve; // 23:50 EDT Oct 14
    const commit = { committed_at: '2026-10-14T18:00:00Z' } as Commit;
    const app = { applied_on: '2026-10-13' } as Application;
    expect(streaks([solve], [commit], [app], new Date('2026-10-15T12:00:00Z'))).toEqual({ leetcode: 1, project: 1, apps: 0 });
  });
  it('dayNumber', () => {
    expect(dayNumber('2026-10-03', '2026-10-14')).toBe(12);
    expect(dayNumber(null, '2026-10-14')).toBeNull();
  });
});
```

`web/src/lib/funnel.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { Application, Stage } from '../data/types';
import { appliedThisWeek, funnel, groupByStage, searchApps } from './funnel';

let id = 0;
const A = (stage: Stage, applied_on: string | null = '2026-10-01', company = `Co${id}`): Application => ({
  id: id++, company, role: 'SWE Intern', track: null, term: null, location: null, status: stage, stage, priority: null, applied_on,
});

describe('funnel', () => {
  const apps = [
    ...Array.from({ length: 6 }, () => A('applied')), A('closed'), A('closed'),
    A('oa'), A('oa'), A('interview'), A('offer'), A('other'),
  ];
  it('counts everyone who reached each stage and converts stage to stage', () => {
    const rows = funnel(apps);
    expect(rows.map((r) => [r.stage, r.count, r.pct])).toEqual([
      ['applied', 12, null], ['oa', 4, 33.3], ['interview', 2, 50], ['offer', 1, 50],
    ]);
    expect(rows.map((r) => [r.refCount, r.refPct])).toEqual([[582, null], [54, 9.3], [13, 24.1], [5, 38.5]]);
  });
  it('zero divisions show no percentage', () => {
    expect(funnel([]).map((r) => r.pct)).toEqual([null, null, null, null]);
  });
  it('appliedThisWeek counts Monday..today only', () => {
    const week = [A('applied', '2026-10-12'), A('applied', '2026-10-14'), A('applied', '2026-10-11'), A('oa', '2026-10-13'), A('applied', null)];
    expect(appliedThisWeek(week, '2026-10-14')).toBe(3);
  });
  it('groups most advanced first, newest first, and drops empty stages', () => {
    const g = groupByStage([A('applied', '2026-10-01'), A('applied', '2026-10-09'), A('offer')]);
    expect(g.map(([s, list]) => [s, list.length])).toEqual([['offer', 1], ['applied', 2]]);
    expect(g[1][1][0].applied_on).toBe('2026-10-09');
  });
  it('search matches company, role or status, case-insensitive', () => {
    const list = [A('applied', null, 'Stripe'), A('oa', null, 'Ramp')];
    expect(searchApps(list, 'strip').map((a) => a.company)).toEqual(['Stripe']);
    expect(searchApps(list, '  ').length).toBe(2);
    expect(searchApps(list, 'OA').map((a) => a.company)).toEqual(['Ramp']);
  });
});
```

`web/src/lib/jobs.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { Posting } from '../data/types';
import { NO_FILTERS, filterPostings, locationKey, postingTrack, sortPostings, termsOf, topLocations } from './jobs';

const J = (id: string, over: Partial<Posting> = {}): Posting => ({
  id, company: 'Co', title: 'Software Engineer Intern', location: 'Detroit, MI', url: 'https://x.com/' + id,
  term: 'Winter 2027', posted_at: null, tier: 'A', starred: false, status: 'new', found_at: '2026-10-14T12:00:00Z', ...over,
});

describe('jobs', () => {
  it('postingTrack', () => {
    expect(postingTrack('Software Engineer Intern')).toBe('internship');
    expect(postingTrack('SWE Co-op, Winter 2027')).toBe('internship');
    expect(postingTrack('Software Engineer, New Grad 2027')).toBe('new_grad');
    expect(postingTrack('University Graduate SWE')).toBe('new_grad');
    expect(postingTrack('Software Engineer I')).toBe('new_grad');
    expect(postingTrack('Internal Tools Engineer')).toBeNull();
    expect(postingTrack('Staff Engineer')).toBeNull();
  });
  it('locationKey takes the first location and folds remote', () => {
    expect(locationKey('Chicago, IL; New York, NY')).toBe('Chicago, IL');
    expect(locationKey('Remote - US')).toBe('Remote');
    expect(locationKey(null)).toBeNull();
  });
  it('filters combine', () => {
    const ps = [J('1', { starred: true }), J('2', { title: 'New Grad SWE' }), J('3', { location: 'Remote', term: 'Summer 2027' })];
    expect(filterPostings(ps, { ...NO_FILTERS, starred: true }).map((p) => p.id)).toEqual(['1']);
    expect(filterPostings(ps, { ...NO_FILTERS, track: 'new_grad' }).map((p) => p.id)).toEqual(['2']);
    expect(filterPostings(ps, { ...NO_FILTERS, term: 'Summer 2027', location: 'Remote' }).map((p) => p.id)).toEqual(['3']);
    expect(filterPostings(ps, NO_FILTERS).length).toBe(3);
  });
  it('sorts starred first, then newest', () => {
    const ps = [J('old', { posted_at: '2026-10-10T00:00:00Z' }), J('new', { posted_at: '2026-10-14T00:00:00Z' }), J('star', { starred: true, posted_at: '2026-10-01T00:00:00Z' })];
    expect(sortPostings(ps).map((p) => p.id)).toEqual(['star', 'new', 'old']);
  });
  it('topLocations and termsOf', () => {
    const ps = [J('1'), J('2'), J('3', { location: 'Ann Arbor, MI', term: null })];
    expect(topLocations(ps)).toEqual(['Detroit, MI', 'Ann Arbor, MI']);
    expect(termsOf(ps)).toEqual(['Winter 2027']);
  });
});
```

`web/src/lib/outreach.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { LaunchRequest, Outreach } from '../data/types';
import { followUpOn, followUpsDue, outreachPhase, sortOutreach } from './outreach';

const O = (id: string, over: Partial<Outreach> = {}): Outreach => ({
  id, job_url: 'https://x.com/' + id, company: null, role: null, resume_path: null, status: 'queued',
  sent_on: null, follow_up_on: null, created_at: '2026-10-14T12:00:00Z', ...over,
});
const R = (id: string, outreachId: string, status: LaunchRequest['status'], created_at = '2026-10-14T12:00:00Z', error: string | null = null): LaunchRequest => ({
  id, kind: 'outreach', payload: { outreach_id: outreachId, job_url: 'x' }, status, error, created_at,
});

describe('outreach', () => {
  it('follow-up is 5 days after sent', () => {
    expect(followUpOn('2026-10-28')).toBe('2026-11-02');
  });
  it('due follow-ups: sent, due today or earlier', () => {
    const list = [O('a', { status: 'sent', follow_up_on: '2026-10-14' }), O('b', { status: 'sent', follow_up_on: '2026-10-15' }), O('c', { status: 'replied', follow_up_on: '2026-10-01' })];
    expect(followUpsDue(list, '2026-10-14').map((o) => o.id)).toEqual(['a']);
  });
  it('phases from the latest launch request', () => {
    expect(outreachPhase(O('a'), [R('r1', 'a', 'queued')], '2026-10-14')).toEqual({ kind: 'queued' });
    expect(outreachPhase(O('a'), [R('r1', 'a', 'launched')], '2026-10-14')).toEqual({ kind: 'on_mac' });
    expect(outreachPhase(O('a'), [R('r1', 'a', 'failed', '2026-10-14T12:00:00Z', 'boom'), R('r2', 'a', 'queued', '2026-10-14T13:00:00Z')], '2026-10-14')).toEqual({ kind: 'queued' });
    expect(outreachPhase(O('a'), [R('r1', 'a', 'failed', '2026-10-14T12:00:00Z', 'osascript: not authorized')], '2026-10-14')).toEqual({ kind: 'failed', error: 'osascript: not authorized' });
    expect(outreachPhase(O('a'), [], '2026-10-14')).toEqual({ kind: 'not_queued' });
    expect(outreachPhase(O('a', { status: 'drafted' }), [], '2026-10-14')).toEqual({ kind: 'drafted' });
    expect(outreachPhase(O('a', { status: 'sent', follow_up_on: '2026-10-14' }), [], '2026-10-14')).toEqual({ kind: 'due' });
    expect(outreachPhase(O('a', { status: 'sent', follow_up_on: '2026-10-20' }), [], '2026-10-14')).toEqual({ kind: 'sent' });
  });
  it('sorts due first, then in-progress, then sent, then done', () => {
    const list = [
      O('replied', { status: 'replied' }), O('sent', { status: 'sent', follow_up_on: '2026-10-20' }),
      O('drafted', { status: 'drafted' }), O('due', { status: 'sent', follow_up_on: '2026-10-13' }), O('queued'),
    ];
    expect(sortOutreach(list, [R('r', 'queued', 'queued')], '2026-10-14').map((o) => o.id)).toEqual(['due', 'drafted', 'queued', 'sent', 'replied']);
  });
});
```

`web/src/lib/ideas.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { Commit, Idea, LaunchRequest } from '../data/types';
import { commitStrip, doneIdeas, moveIdea, nextPosition, suggestState, swapCandidate, todaysIdea, visibleIdeas } from './ideas';

const I = (id: string, over: Partial<Idea> = {}): Idea => ({
  id, project_id: '27b', text: id, size: 'S', status: 'todo', source: 'me', position: 0, today_on: null,
  done_at: null, created_at: '2026-10-01T00:00:00Z', ...over,
});

describe('ideas', () => {
  const list = [I('c', { position: 2 }), I('a', { position: 0 }), I('b', { position: 1 }), I('x', { status: 'done' }), I('d', { status: 'dropped' }), I('o', { project_id: 'showboat' })];
  it('visible = todo/today for the project, by position', () => {
    expect(visibleIdeas(list, '27b').map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(doneIdeas(list, '27b').map((i) => i.id)).toEqual(['x']);
  });
  it('moveIdea renumbers and returns only changed rows', () => {
    const vis = visibleIdeas(list, '27b');
    expect(moveIdea(vis, 'c', -1)).toEqual([{ id: 'c', position: 1 }, { id: 'b', position: 2 }]);
    expect(moveIdea(vis, 'a', -1)).toEqual([]);
    expect(moveIdea(vis, 'c', 1)).toEqual([]);
  });
  it('moveIdea fixes duplicate positions', () => {
    const dup = [I('a', { position: 0 }), I('b', { position: 0 }), I('c', { position: 0 })];
    expect(moveIdea(dup, 'a', 1)).toEqual([{ id: 'a', position: 1 }, { id: 'c', position: 2 }]); // b stays 0
  });
  it('nextPosition', () => {
    expect(nextPosition(visibleIdeas(list, '27b'))).toBe(3);
    expect(nextPosition([])).toBe(0);
  });
  it("today's idea includes one already done today", () => {
    expect(todaysIdea([I('t', { status: 'today', today_on: '2026-10-14' })], '2026-10-14')?.id).toBe('t');
    expect(todaysIdea([I('t', { status: 'done', today_on: '2026-10-14' })], '2026-10-14')?.id).toBe('t');
    expect(todaysIdea([I('t', { status: 'today', today_on: '2026-10-13' })], '2026-10-14')).toBeNull();
  });
  it('swapCandidate prefers the same project, else any todo', () => {
    const cur = I('t', { status: 'today' });
    expect(swapCandidate([cur, I('o', { project_id: 'showboat' }), I('n', { position: 5 })], cur)?.id).toBe('n');
    expect(swapCandidate([cur, I('o', { project_id: 'showboat' })], cur)?.id).toBe('o');
    expect(swapCandidate([cur], cur)).toBeNull();
  });
  it('commitStrip counts per local day, oldest first', () => {
    const commits = [
      { sha: '1', project_id: '27b', message: 'm', committed_at: '2026-10-14T18:00:00Z' },
      { sha: '2', project_id: '27b', message: 'm', committed_at: '2026-10-15T03:00:00Z' }, // 23:00 EDT Oct 14
      { sha: '3', project_id: '27b', message: 'm', committed_at: '2026-10-12T18:00:00Z' },
      { sha: '4', project_id: 'showboat', message: 'm', committed_at: '2026-10-14T18:00:00Z' },
    ] as Commit[];
    const strip = commitStrip(commits, '27b', '2026-10-14', 5);
    expect(strip).toEqual([0, 0, 1, 0, 2]);
  });
  it('suggestState', () => {
    const R = (status: LaunchRequest['status'], created_at: string, error: string | null = null): LaunchRequest => ({
      id: created_at, kind: 'suggest_ideas', payload: { project_id: '27b' }, status, error, created_at,
    });
    expect(suggestState([], '27b')).toEqual({ kind: 'idle' });
    expect(suggestState([R('queued', '2026-10-14T12:00:00Z')], '27b')).toEqual({ kind: 'queued' });
    expect(suggestState([R('failed', '2026-10-14T12:00:00Z', 'no folder')], '27b')).toEqual({ kind: 'failed', error: 'no folder' });
    expect(suggestState([R('launched', '2026-10-14T12:00:00Z')], '27b')).toEqual({ kind: 'idle' });
    expect(suggestState([R('queued', '2026-10-14T12:00:00Z')], 'showboat')).toEqual({ kind: 'idle' });
  });
});
```

`web/src/lib/levels.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { Problem, ProblemState, Solve, Topic } from '../data/types';
import { reviewQueue, roadmapRows, topicCounts, upcomingReviews } from './levels';

const T = (name: string, tier: number, ord: number, prereqs: string[] = []): Topic => ({ name, tier, ord, prereqs, lc_tags: [] });
const topics = [T('Two Pointers', 1, 2, ['Arrays & Hashing']), T('Arrays & Hashing', 0, 1), T('Stack', 1, 3, ['Arrays & Hashing'])];

describe('levels', () => {
  it('roadmapRows groups by tier in roadmap order and marks focus', () => {
    const rows = roadmapRows(topics, [{ topic: 'Arrays & Hashing', level: 'solid' }], 'Two Pointers');
    expect(rows.map((r) => [r.tier, r.topics.map((t) => t.name)])).toEqual([[0, ['Arrays & Hashing']], [1, ['Two Pointers', 'Stack']]]);
    expect(rows[1].topics[0]).toMatchObject({ level: 'locked', isFocus: true });
  });
  it('roadmapRows defaults: no state → available without prereqs, locked with', () => {
    const rows = roadmapRows(topics, [], null);
    expect(rows[0].topics[0].level).toBe('available');
    expect(rows[1].topics[1].level).toBe('locked');
  });
  const P = (slug: string, difficulty: Problem['difficulty'], topic = 'Stack'): Problem => ({
    slug, lc_id: null, title: slug, difficulty, topic, lists: [], paid_only: false, ac_rate: null, target_minutes: null, neetcode_link: null,
  });
  const problems = new Map([P('a', 'Easy'), P('b', 'Medium'), P('c', 'Hard')].map((p) => [p.slug, p]));
  const PS = (slug: string, due_on: string | null, state: ProblemState['state'] = 'reviewing'): ProblemState => ({ slug, state, interval_days: 3, due_on, lapses: 0 });
  it('reviewQueue: due today or overdue, oldest first, no retained', () => {
    const q = reviewQueue([PS('b', '2026-10-14'), PS('a', '2026-10-10'), PS('c', '2026-10-20'), PS('z', '2026-10-01', 'retained')], problems, '2026-10-14');
    expect(q.map((r) => r.state.slug)).toEqual(['a', 'b']);
    expect(q[0].problem?.difficulty).toBe('Easy');
  });
  it('upcomingReviews counts the next N days, excluding today', () => {
    expect(upcomingReviews([PS('b', '2026-10-14'), PS('c', '2026-10-20'), PS('d', '2026-10-22')], '2026-10-14', 7)).toBe(1);
  });
  it('topicCounts counts distinct solved problems by difficulty', () => {
    const solves = [{ slug: 'a' }, { slug: 'a' }, { slug: 'b' }, { slug: 'not-in-bank' }] as Solve[];
    expect(topicCounts(solves, problems, 'Stack')).toEqual({ Easy: 1, Medium: 1, Hard: 0 });
  });
});
```

`web/src/lib/heatmap.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { Solve } from '../data/types';
import { heatmap, intensity } from './heatmap';

describe('heatmap', () => {
  it('weeks start Monday, end with the current week, and mark the future', () => {
    const solves = [{ accepted_at: '2026-10-14T15:00:00Z' }, { accepted_at: '2026-10-14T16:00:00Z' }, { accepted_at: '2026-10-05T15:00:00Z' }] as Solve[];
    const weeks = heatmap(solves, '2026-10-14', 2);
    expect(weeks.length).toBe(2);
    expect(weeks[0][0].day).toBe('2026-10-05');
    expect(weeks[0][0].count).toBe(1);
    expect(weeks[1][2]).toEqual({ day: '2026-10-14', count: 2, future: false });
    expect(weeks[1][3].future).toBe(true);
  });
  it('intensity buckets', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 9].map(intensity)).toEqual([0, 1, 2, 2, 3, 3, 4, 4]);
  });
});
```

`web/src/lib/sync.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { anyStale, isStale } from './sync';

const now = new Date('2026-10-14T12:00:00Z');
const row = (last_ok_at: string | null) => ({ source: 'sheet', last_ok_at, last_error: null, consecutive_failures: 0 });

describe('sync staleness', () => {
  it('stale after 2 hours or never synced', () => {
    expect(isStale(row('2026-10-14T10:30:00Z'), now)).toBe(false);
    expect(isStale(row('2026-10-14T09:59:00Z'), now)).toBe(true);
    expect(isStale(row(null), now)).toBe(true);
  });
  it('anyStale', () => {
    expect(anyStale([row('2026-10-14T11:00:00Z')], now)).toBe(false);
    expect(anyStale([row('2026-10-14T11:00:00Z'), row(null)], now)).toBe(true);
    expect(anyStale([], now)).toBe(false);
  });
});
```

`web/src/lib/stages.test.ts` (drift guard against the worker's table, Plan 1 Task 7):
```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { STAGE_RULES } from './stages';

describe('STAGE_RULES', () => {
  it('matches worker/lockin_worker/sheet.py exactly', () => {
    const py = readFileSync(fileURLToPath(new URL('../../../worker/lockin_worker/sheet.py', import.meta.url)), 'utf8');
    const block = py.split('STAGE_RULES = [')[1].split(']\n')[0];
    const pairs = [...block.matchAll(/\(r"([^"]+)",\s*"(\w+)"\)/g)].map((m) => [m[1], m[2]]);
    expect(pairs.length).toBeGreaterThan(0);
    expect(STAGE_RULES).toEqual(pairs);
  });
});
```

`web/src/lib/prompt.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { TemplateError, renderTemplate } from './prompt';

describe('renderTemplate (same rules as the Python launcher)', () => {
  it('fills once and never re-expands', () => {
    expect(renderTemplate('Hi {{name}}, id={{ id }}', { name: '{{id}}', id: '7' })).toBe('Hi {{id}}, id=7');
  });
  it('throws on a missing value', () => {
    expect(() => renderTemplate('{{a}} {{b}}', { a: '1' })).toThrow(TemplateError);
    expect(() => renderTemplate('{{a}} {{b}}', { a: '1' })).toThrow('missing values for: b');
  });
});
```

- [ ] **Step 3: Run them and confirm they fail**

Run: `npx vitest run src/lib`
Expected: FAIL; every new file reports `Failed to resolve import` (only `time.test.ts` passes).

- [ ] **Step 4: Implement the helpers**

`web/src/lib/url.ts`:
```ts
export function safeHref(url: string | null | undefined): string | null {
  if (!url) return null;
  const s = url.trim();
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? s : null;
  } catch {
    return null;
  }
}

export function isJobUrl(s: string): boolean {
  const href = safeHref(s);
  if (!href) return false;
  return new URL(href).hostname.includes('.');
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
```

`web/src/lib/today.ts`:
```ts
import type { DailySet, Difficulty, Problem, Rating, Slot, Solve } from '../data/types';
import { planDay } from './time';

export interface TodayItem {
  slug: string;
  title: string;
  difficulty: Difficulty | null;
  url: string;
  slot: Slot;
  done: boolean;
  solve: Solve | null; // the solve a rating goes on (the rated one, else the first of the day)
  needsRating: boolean;
  topicHidden: boolean;
  topicLabel: string | null;
}

export const RATINGS: { value: Rating; emoji: string; label: string }[] = [
  { value: 'nailed', emoji: '🟢', label: 'Nailed it' },
  { value: 'struggled', emoji: '🟡', label: 'Struggled' },
  { value: 'help', emoji: '🔴', label: 'Needed help' },
];

export const problemUrl = (slug: string) => `https://leetcode.com/problems/${slug}/`;

function solvesByDay(solves: Solve[], day: string): Map<string, Solve[]> {
  const out = new Map<string, Solve[]>();
  for (const s of solves) {
    if (planDay(new Date(s.accepted_at)) !== day) continue;
    out.set(s.slug, [...(out.get(s.slug) ?? []), s]);
  }
  for (const list of out.values()) list.sort((a, b) => Date.parse(a.accepted_at) - Date.parse(b.accepted_at));
  return out;
}

export function buildTodayItems(set: DailySet, solves: Solve[], problems: Map<string, Problem>, day: string): TodayItem[] {
  const byslug = solvesByDay(solves, day);
  return [...set.items]
    .sort((a, b) => a.order - b.order)
    .map((it) => {
      const p = problems.get(it.slug) ?? null;
      const daySolves = byslug.get(it.slug) ?? [];
      const solved = daySolves.length > 0;
      const rated = daySolves.find((s) => s.rating) ?? null;
      const secret = it.slot === 'mystery' || set.mixed_day;
      const topicHidden = secret && !solved;
      const offFocus = p !== null && p.topic !== set.focus;
      return {
        slug: it.slug,
        title: p?.title ?? it.slug.replace(/-/g, ' '),
        difficulty: p?.difficulty ?? null,
        url: problemUrl(it.slug),
        slot: it.slot,
        done: it.done || solved,
        solve: rated ?? daySolves[0] ?? null,
        needsRating: solved && !rated,
        topicHidden,
        topicLabel: topicHidden || !p || !(secret || offFocus) ? null : p.topic,
      };
    });
}
```

`web/src/lib/streaks.ts`:
```ts
import type { Application, Commit, Solve } from '../data/types';
import { addDays, daysBetween, localDay } from './time';

export function streak(days: Set<string>, today: string): number {
  let cur = days.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (days.has(cur)) {
    n += 1;
    cur = addDays(cur, -1);
  }
  return n;
}

export function streaks(solves: Solve[], commits: Commit[], apps: Application[], now: Date) {
  const today = localDay(now);
  return {
    leetcode: streak(new Set(solves.map((s) => localDay(new Date(s.accepted_at)))), today),
    project: streak(new Set(commits.map((c) => localDay(new Date(c.committed_at)))), today),
    apps: streak(new Set(apps.flatMap((a) => (a.applied_on ? [a.applied_on] : []))), today),
  };
}

export function dayNumber(startedOn: string | null, day: string): number | null {
  return startedOn ? daysBetween(startedOn, day) + 1 : null;
}
```

`web/src/lib/funnel.ts`:
```ts
import type { Application, Stage } from '../data/types';
import { weekStart } from './time';

export type FunnelStage = 'applied' | 'oa' | 'interview' | 'offer';
export const REFERENCE: Record<FunnelStage, number> = { applied: 582, oa: 54, interview: 13, offer: 5 };
export const STAGE_LABEL: Record<Stage, string> = {
  applied: 'Applied', oa: 'OA', interview: 'Interview', offer: 'Offer', closed: 'Closed', other: 'Other',
};
const FUNNEL: FunnelStage[] = ['applied', 'oa', 'interview', 'offer'];
// "Reached" counts: a rejection after an OA is recorded only as `closed`, so it counts as applied.
const REACHED: Record<FunnelStage, Stage[]> = {
  applied: ['applied', 'oa', 'interview', 'offer', 'closed'],
  oa: ['oa', 'interview', 'offer'],
  interview: ['interview', 'offer'],
  offer: ['offer'],
};
export const BOARD_ORDER: Stage[] = ['offer', 'interview', 'oa', 'applied', 'closed', 'other'];

export interface FunnelRow { stage: FunnelStage; label: string; count: number; pct: number | null; refCount: number; refPct: number | null }

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

export function funnel(apps: Application[]): FunnelRow[] {
  const counts = FUNNEL.map((s) => apps.filter((a) => REACHED[s].includes(a.stage)).length);
  return FUNNEL.map((stage, i) => ({
    stage,
    label: STAGE_LABEL[stage],
    count: counts[i],
    pct: i === 0 ? null : pct(counts[i], counts[i - 1]),
    refCount: REFERENCE[stage],
    refPct: i === 0 ? null : pct(REFERENCE[stage], REFERENCE[FUNNEL[i - 1]]),
  }));
}

export function appliedThisWeek(apps: Application[], today: string): number {
  const start = weekStart(today);
  return apps.filter((a) => a.applied_on !== null && a.applied_on >= start && a.applied_on <= today).length;
}

export function groupByStage(apps: Application[]): [Stage, Application[]][] {
  return BOARD_ORDER.map((stage): [Stage, Application[]] => [
    stage,
    apps.filter((a) => a.stage === stage).sort((a, b) => (b.applied_on ?? '').localeCompare(a.applied_on ?? '')),
  ]).filter(([, list]) => list.length > 0);
}

export function searchApps(apps: Application[], q: string): Application[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return apps;
  return apps.filter((a) => [a.company, a.role, a.status].some((f) => (f ?? '').toLowerCase().includes(needle)));
}
```

`web/src/lib/jobs.ts`:
```ts
import type { Posting } from '../data/types';

export type Track = 'internship' | 'new_grad';
export interface JobFilters { starred: boolean; track: Track | null; term: string | null; location: string | null }
export const NO_FILTERS: JobFilters = { starred: false, track: null, term: null, location: null };

export function postingTrack(title: string): Track | null {
  if (/\b(intern|internship|co-?op)\b/i.test(title)) return 'internship';
  if (/\bnew[- ]grad|\bgraduate\b|early[- ]career|entry[- ]level|\b(engineer|developer) i\b/i.test(title)) return 'new_grad';
  return null;
}

export function locationKey(loc: string | null): string | null {
  if (!loc) return null;
  const first = loc.split(/[;|]/)[0].trim();
  if (!first) return null;
  return /remote/i.test(first) ? 'Remote' : first;
}

export function filterPostings(ps: Posting[], f: JobFilters): Posting[] {
  return ps.filter((p) =>
    (!f.starred || p.starred) &&
    (!f.track || postingTrack(p.title) === f.track) &&
    (!f.term || p.term === f.term) &&
    (!f.location || locationKey(p.location) === f.location));
}

const when = (p: Posting) => Date.parse(p.posted_at ?? p.found_at);

export function sortPostings(ps: Posting[]): Posting[] {
  return [...ps].sort((a, b) => Number(b.starred) - Number(a.starred) || when(b) - when(a));
}

export function topLocations(ps: Posting[], n = 6): string[] {
  const counts = new Map<string, number>();
  for (const p of ps) {
    const k = locationKey(p.location);
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([k]) => k);
}

export function termsOf(ps: Posting[]): string[] {
  return [...new Set(ps.flatMap((p) => (p.term ? [p.term] : [])))].sort();
}
```

`web/src/lib/outreach.ts`:
```ts
import type { LaunchRequest, Outreach } from '../data/types';
import { addDays } from './time';

export const FOLLOW_UP_DAYS = 5;
export const followUpOn = (sentOn: string) => addDays(sentOn, FOLLOW_UP_DAYS);

export function followUpsDue(list: Outreach[], today: string): Outreach[] {
  return list.filter((o) => o.status === 'sent' && o.follow_up_on !== null && o.follow_up_on <= today);
}

export type Phase =
  | { kind: 'not_queued' } | { kind: 'queued' } | { kind: 'on_mac' } | { kind: 'failed'; error: string }
  | { kind: 'drafted' } | { kind: 'sent' } | { kind: 'due' } | { kind: 'replied' } | { kind: 'closed' };

export const PHASE_LABEL: Record<Phase['kind'], string> = {
  not_queued: 'Not queued', queued: 'Queued for Mac', on_mac: 'Drafting on Mac', failed: 'Launch failed',
  drafted: 'Drafted', sent: 'Sent', due: 'Follow up', replied: 'Replied', closed: 'Closed',
};

function latestRequest(o: Outreach, requests: LaunchRequest[]): LaunchRequest | null {
  const mine = requests.filter((r) => r.kind === 'outreach' && r.payload.outreach_id === o.id);
  mine.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return mine[0] ?? null;
}

export function outreachPhase(o: Outreach, requests: LaunchRequest[], today: string): Phase {
  switch (o.status) {
    case 'queued': {
      const r = latestRequest(o, requests);
      if (!r) return { kind: 'not_queued' };
      if (r.status === 'queued') return { kind: 'queued' };
      if (r.status === 'launched') return { kind: 'on_mac' };
      return { kind: 'failed', error: r.error ?? 'Unknown error' };
    }
    case 'sent':
      return o.follow_up_on !== null && o.follow_up_on <= today ? { kind: 'due' } : { kind: 'sent' };
    default:
      return { kind: o.status };
  }
}

const RANK: Record<Phase['kind'], number> = {
  due: 0, failed: 1, not_queued: 1, drafted: 1, queued: 2, on_mac: 2, sent: 3, replied: 4, closed: 4,
};

export function sortOutreach(list: Outreach[], requests: LaunchRequest[], today: string): Outreach[] {
  return [...list].sort((a, b) =>
    RANK[outreachPhase(a, requests, today).kind] - RANK[outreachPhase(b, requests, today).kind] ||
    Date.parse(b.created_at) - Date.parse(a.created_at));
}
```

`web/src/lib/ideas.ts`:
```ts
import type { Commit, Idea, LaunchRequest } from '../data/types';
import { addDays, localDay } from './time';

const byPosition = (a: Idea, b: Idea) => a.position - b.position || a.created_at.localeCompare(b.created_at);

export function visibleIdeas(ideas: Idea[], projectId: string): Idea[] {
  return ideas.filter((i) => i.project_id === projectId && (i.status === 'todo' || i.status === 'today')).sort(byPosition);
}

export function doneIdeas(ideas: Idea[], projectId: string): Idea[] {
  return ideas.filter((i) => i.project_id === projectId && i.status === 'done').sort((a, b) => (b.done_at ?? '').localeCompare(a.done_at ?? ''));
}

export function moveIdea(list: Idea[], id: string, dir: -1 | 1): { id: string; position: number }[] {
  const order = [...list];
  const i = order.findIndex((x) => x.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return [];
  [order[i], order[j]] = [order[j], order[i]];
  return order.flatMap((x, pos) => (x.position === pos ? [] : [{ id: x.id, position: pos }]));
}

export const nextPosition = (list: Idea[]) => list.reduce((m, i) => Math.max(m, i.position + 1), 0);

export function todaysIdea(ideas: Idea[], day: string): Idea | null {
  return ideas.find((i) => i.today_on === day && (i.status === 'today' || i.status === 'done')) ?? null;
}

export function swapCandidate(ideas: Idea[], current: Idea): Idea | null {
  const todo = ideas.filter((i) => i.status === 'todo' && i.id !== current.id).sort(byPosition);
  return todo.find((i) => i.project_id === current.project_id) ?? todo[0] ?? null;
}

export function commitStrip(commits: Commit[], projectId: string, today: string, days = 30): number[] {
  const counts = new Map<string, number>();
  for (const c of commits) {
    if (c.project_id !== projectId) continue;
    const d = localDay(new Date(c.committed_at));
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  return Array.from({ length: days }, (_, i) => counts.get(addDays(today, i - days + 1)) ?? 0);
}

export function suggestState(requests: LaunchRequest[], projectId: string):
  { kind: 'idle' } | { kind: 'queued' } | { kind: 'failed'; error: string } {
  const mine = requests
    .filter((r) => r.kind === 'suggest_ideas' && r.payload.project_id === projectId)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const r = mine[0];
  if (!r || r.status === 'launched') return { kind: 'idle' };
  if (r.status === 'queued') return { kind: 'queued' };
  return { kind: 'failed', error: r.error ?? 'Unknown error' };
}
```

`web/src/lib/levels.ts`:
```ts
import type { Level, Problem, ProblemState, Solve, Topic, TopicState } from '../data/types';
import { addDays } from './time';

export const LEVEL_LABEL: Record<Level, string> = {
  locked: 'Locked', available: 'Ready', learning: 'Learning', practicing: 'Practicing', solid: 'Solid', mastered: 'Mastered',
};

export function roadmapRows(topics: Topic[], states: TopicState[], focus: string | null) {
  const level = new Map(states.map((s) => [s.topic, s.level]));
  const tiers = new Map<number, { name: string; level: Level; isFocus: boolean; prereqs: string[] }[]>();
  for (const t of [...topics].sort((a, b) => a.ord - b.ord)) {
    const row = {
      name: t.name,
      level: level.get(t.name) ?? (t.prereqs.length === 0 ? 'available' : 'locked'),
      isFocus: t.name === focus,
      prereqs: t.prereqs,
    };
    tiers.set(t.tier, [...(tiers.get(t.tier) ?? []), row]);
  }
  return [...tiers.entries()].sort((a, b) => a[0] - b[0]).map(([tier, list]) => ({ tier, topics: list }));
}

export function reviewQueue(states: ProblemState[], problems: Map<string, Problem>, today: string) {
  return states
    .filter((s) => s.state !== 'retained' && s.due_on !== null && s.due_on <= today)
    .sort((a, b) => (a.due_on ?? '').localeCompare(b.due_on ?? ''))
    .map((state) => ({ state, problem: problems.get(state.slug) ?? null }));
}

export function upcomingReviews(states: ProblemState[], today: string, days: number): number {
  const end = addDays(today, days);
  return states.filter((s) => s.state !== 'retained' && s.due_on !== null && s.due_on > today && s.due_on <= end).length;
}

export function topicCounts(solves: Solve[], problems: Map<string, Problem>, topic: string) {
  const out = { Easy: 0, Medium: 0, Hard: 0 };
  for (const slug of new Set(solves.map((s) => s.slug))) {
    const p = problems.get(slug);
    if (p && p.topic === topic) out[p.difficulty] += 1;
  }
  return out;
}
```
`upcomingReviews` uses `due_on <= today + 7`, so in the test `2026-10-20` (6 days out) counts and `2026-10-22` (8 days) doesn't: expected 1.

`web/src/lib/heatmap.ts`:
```ts
import type { Solve } from '../data/types';
import { addDays, localDay, weekStart } from './time';

export function heatmap(solves: Solve[], today: string, weeks = 26) {
  const counts = new Map<string, number>();
  for (const s of solves) {
    const d = localDay(new Date(s.accepted_at));
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  const start = addDays(weekStart(today), -7 * (weeks - 1));
  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const day = addDays(start, w * 7 + d);
      return { day, count: counts.get(day) ?? 0, future: day > today };
    }));
}

export function intensity(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  if (count <= 5) return 3;
  return 4;
}
```

`web/src/lib/sync.ts`:
```ts
import type { SyncStatus } from '../data/types';

export const STALE_HOURS = 2;
export const SOURCE_LABEL: Record<string, string> = { leetcode: 'LeetCode', github: 'GitHub', sheet: 'Sheet', jobs: 'Jobs' };

export function isStale(row: SyncStatus, now: Date): boolean {
  if (!row.last_ok_at) return true;
  return now.getTime() - Date.parse(row.last_ok_at) > STALE_HOURS * 3_600_000;
}

export const anyStale = (rows: SyncStatus[], now: Date) => rows.some((r) => isStale(r, now));
```

`web/src/lib/stages.ts` (display copy of Plan 1's `sheet.STAGE_RULES`; the worker is the authority and the drift test keeps them equal):
```ts
import type { Stage } from '../data/types';

export const STAGE_RULES: [pattern: string, stage: Stage][] = [
  ['^offer', 'offer'],
  ['reject|withdr|declin|closed|ghost|no response', 'closed'],
  ['interview|^r\\d|round|onsite|superday|final|phone|screen', 'interview'],
  ['^oa|assessment|hackerrank|codesignal', 'oa'],
  ['submit|applied|^apply', 'applied'],
];
```
If `sheet.py`'s list differs when you run the test, copy the worker's list here (the worker is the source of truth) and rerun.

`web/src/lib/prompt.ts`:
```ts
export class TemplateError extends Error {}

const PLACEHOLDER = /\{\{\s*([a-z_]+)\s*\}\}/g;

export function renderTemplate(tpl: string, values: Record<string, string>): string {
  const missing = [...new Set([...tpl.matchAll(PLACEHOLDER)].map((m) => m[1]))].filter((k) => !(k in values)).sort();
  if (missing.length) throw new TemplateError(`missing values for: ${missing.join(', ')}`);
  return tpl.replace(PLACEHOLDER, (_, k: string) => values[k]);
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npx vitest run src/lib && npm run typecheck && npm run lint`
Expected: every file passes (11 lib test files plus `time.test.ts`); tsc and eslint print nothing.

- [ ] **Step 6: Commit**

```bash
git add web/src/data/types.ts web/src/lib
git commit -m "Add pure web helpers for today, streaks, funnel, jobs, outreach and roadmap"
```

---
### Task 3: Data layer: `DataApi`, Supabase and demo implementations, query hooks

**Files:**
- Create: `web/src/vite-env.d.ts`, `web/src/data/api.ts`, `web/src/data/auth.ts`, `web/src/data/supabase.ts`, `web/src/data/fixtures.ts`, `web/src/data/demo.ts`, `web/src/data/context.tsx`, `web/src/data/hooks.ts`, `web/src/test/render.tsx`, `web/src/data/demo.test.ts`, `web/src/data/supabase.test.ts`

**Interfaces:**
- Consumes: `types.ts`, `time.*`, `outreach.followUpOn` (Task 2)
- Produces:
  - `api.DataApi` (methods below; both implementations satisfy it exactly)
  - `auth.AuthApi { hasSession(); onChange(cb); sendLink(email); verifyCode(email, code); signOut() }`, `auth.supabaseAuth(sb, redirectTo?)`, `auth.demoAuth`
  - `supabase.createSupabase(): SupabaseClient`, `supabase.createSupabaseApi(sb, deps?: SupabaseApiDeps): DataApi`, `supabase.SupabaseApiDeps { ownerId(): Promise<string>; accessToken(): Promise<string | null>; fetchImpl?: typeof fetch }`
  - `fixtures.DemoDb`, `fixtures.createFixtures(now: Date): DemoDb`
  - `demo.createDemoApi(now?: Date): DataApi`, re-export `demoAuth`
  - `context.DataProvider({api, auth, children})`, `context.useApi(): DataApi`, `context.useAuth(): AuthApi`
  - `hooks.keys`, `hooks.useNow(intervalMs?)`, query hooks `useSettings, useDailySet(day), useProblems, useProblemMap, useTopics, useTopicStates, useProblemStates, useSolves, useProjects, useCommits, useIdeas, useApplications, usePostings, useOutreach, useContacts, useLaunchRequests, useSyncStatus`, mutation hooks `useRateSolve, useUpdateSettings, useAddProject, useSetProjectActive, useAddIdea, useUpdateIdea, useReorderIdeas, useSwapIdea, useSetPostingStatus, useQueueOutreach, useUpdateOutreach, useRequestLaunch, useSyncLeetCode, useSyncOnOpen`
  - `test/render.renderWithData(ui, {api?, route?}) → RTL result + {api, qc}`

`DataApi`:
```ts
getSettings(): Promise<Settings>                       // throws 'No settings row yet…' if none
updateSettings(patch: SettingsPatch): Promise<void>
getDailySet(day: string): Promise<DailySet | null>
listProblems(): Promise<Problem[]>
listTopics(): Promise<Topic[]>
listTopicStates(): Promise<TopicState[]>
listProblemStates(): Promise<ProblemState[]>
listSolves(): Promise<Solve[]>                           // newest first
rateSolve(id: number, rating: Rating, at: Date): Promise<void>
listProjects(): Promise<Project[]>
addProject(p: NewProject): Promise<void>
setProjectActive(id: string, active: boolean): Promise<void>
listCommits(sinceIso: string): Promise<Commit[]>
listIdeas(): Promise<Idea[]>
addIdea(i: NewIdea): Promise<void>
updateIdea(id: string, patch: IdeaPatch): Promise<void>
listApplications(): Promise<Application[]>
listPostings(sinceIso: string): Promise<Posting[]>       // status new|seen, found_at >= since
setPostingStatus(id: string, status: PostingStatus): Promise<void>
listOutreach(): Promise<Outreach[]>
listContacts(): Promise<Contact[]>
queueOutreach(i: { job_url: string; company?: string | null; role?: string | null }): Promise<Outreach>  // outreach row + launch request
updateOutreach(id: string, patch: OutreachPatch): Promise<void>
requestLaunch(kind: LaunchKind, payload: Record<string, unknown>): Promise<void>
listLaunchRequests(): Promise<LaunchRequest[]>
listSyncStatus(): Promise<SyncStatus[]>
syncLeetCode(): Promise<SyncResult>
```

- [ ] **Step 1: Write the failing tests**

`web/src/data/demo.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { planDay } from '../lib/time';
import { createDemoApi } from './demo';

const NOW = new Date('2026-10-14T16:00:00Z'); // 12:00 EDT

describe('demo api', () => {
  it("has today's 6-item Sliding Window set", async () => {
    const api = createDemoApi(NOW);
    const set = await api.getDailySet(planDay(NOW));
    expect(set?.focus).toBe('Sliding Window');
    expect(set?.items).toHaveLength(6);
    expect(await api.getDailySet('2020-01-01')).toBeNull();
  });
  it('fixture sizes match the brief', async () => {
    const api = createDemoApi(NOW);
    expect(await api.listApplications()).toHaveLength(20);
    expect(await api.listPostings('2000-01-01T00:00:00Z')).toHaveLength(8);
    expect(await api.listOutreach()).toHaveLength(2);
    expect((await api.listProjects()).map((p) => p.id)).toEqual(['27b', 'showboat']);
    expect(await api.listTopics()).toHaveLength(18);
  });
  it('returns copies, so callers cannot mutate the store', async () => {
    const api = createDemoApi(NOW);
    (await api.listIdeas())[0].text = 'changed';
    expect((await api.listIdeas())[0].text).not.toBe('changed');
  });
  it('rateSolve sets rating and rated_at', async () => {
    const api = createDemoApi(NOW);
    const unrated = (await api.listSolves()).find((s) => s.rating === null)!;
    await api.rateSolve(unrated.id, 'struggled', NOW);
    const after = (await api.listSolves()).find((s) => s.id === unrated.id)!;
    expect([after.rating, after.rated_at]).toEqual(['struggled', NOW.toISOString()]);
  });
  it('queueOutreach creates a queued outreach and a launch request', async () => {
    const api = createDemoApi(NOW);
    const o = await api.queueOutreach({ job_url: 'https://jobs.lever.co/acme/1' });
    expect(o.status).toBe('queued');
    const req = (await api.listLaunchRequests()).find((r) => r.payload.outreach_id === o.id)!;
    expect(req).toMatchObject({ kind: 'outreach', status: 'queued', payload: { outreach_id: o.id, job_url: 'https://jobs.lever.co/acme/1' } });
  });
  it('updates ideas, postings, outreach, settings and projects', async () => {
    const api = createDemoApi(NOW);
    await api.addIdea({ project_id: '27b', text: 'New thing', size: 'M', position: 9 });
    const idea = (await api.listIdeas()).find((i) => i.text === 'New thing')!;
    expect(idea).toMatchObject({ status: 'todo', source: 'me', size: 'M', position: 9 });
    await api.updateIdea(idea.id, { status: 'done' });
    expect((await api.listIdeas()).find((i) => i.id === idea.id)!.status).toBe('done');
    const p = (await api.listPostings('2000-01-01T00:00:00Z'))[0];
    await api.setPostingStatus(p.id, 'dismissed');
    expect((await api.listPostings('2000-01-01T00:00:00Z')).some((x) => x.id === p.id)).toBe(false);
    const o = (await api.listOutreach())[0];
    await api.updateOutreach(o.id, { status: 'sent', sent_on: '2026-10-14', follow_up_on: '2026-10-19' });
    expect((await api.listOutreach()).find((x) => x.id === o.id)!.follow_up_on).toBe('2026-10-19');
    await api.updateSettings({ daily_lc_count: 7 });
    expect((await api.getSettings()).daily_lc_count).toBe(7);
    await api.addProject({ id: 'lego', name: 'LEGO', repo: 'adamkuhn1/lego', local_path: '~/Developer/lego' });
    await api.setProjectActive('lego', false);
    expect((await api.listProjects()).find((x) => x.id === 'lego')!.active).toBe(false);
  });
  it('listPostings honors the since cutoff', async () => {
    const api = createDemoApi(NOW);
    expect(await api.listPostings('2030-01-01T00:00:00Z')).toEqual([]);
  });
  it('sync is a no-op in demo mode', async () => {
    expect(await createDemoApi(NOW).syncLeetCode()).toEqual({ status: 'skipped' });
  });
});
```

`web/src/data/supabase.test.ts`:
```ts
import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { createSupabaseApi } from './supabase';

interface Call { url: URL; method: string; body: unknown; headers: Record<string, string> }

function harness(responder: (c: Call) => Response) {
  const calls: Call[] = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: new URL(String(input), 'http://localhost'),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
    };
    calls.push(call);
    return responder(call);
  };
  const sb = createClient('https://p.supabase.co', 'anon', {
    global: { fetch: fetchImpl as typeof fetch },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const api = createSupabaseApi(sb, { ownerId: async () => 'u1', accessToken: async () => 'tok', fetchImpl: fetchImpl as typeof fetch });
  return { api, calls };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const empty = () => new Response(null, { status: 204 });

describe('supabase api', () => {
  it('rateSolve PATCHes one lc_solves row with rating and rated_at', async () => {
    const { api, calls } = harness(empty);
    await api.rateSolve(5, 'nailed', new Date('2026-10-14T16:00:00Z'));
    expect(calls[0].method).toBe('PATCH');
    expect(calls[0].url.pathname).toBe('/rest/v1/lc_solves');
    expect(calls[0].url.searchParams.get('id')).toBe('eq.5');
    expect(calls[0].body).toEqual({ rating: 'nailed', rated_at: '2026-10-14T16:00:00.000Z' });
  });
  it('updateSettings filters by owner', async () => {
    const { api, calls } = harness(empty);
    await api.updateSettings({ daily_lc_count: 7 });
    expect(calls[0].url.searchParams.get('owner')).toBe('eq.u1');
    expect(calls[0].body).toEqual({ daily_lc_count: 7 });
  });
  it('getSettings explains a missing row', async () => {
    const { api } = harness(() => json([]));
    await expect(api.getSettings()).rejects.toThrow('No settings row yet');
  });
  it('queueOutreach inserts the outreach, then a launch request for it', async () => {
    const { api, calls } = harness((c) =>
      c.url.pathname.endsWith('/outreach')
        ? json({ id: 'o1', job_url: 'https://x.com/j', company: null, role: null, resume_path: null, status: 'queued', sent_on: null, follow_up_on: null, created_at: '2026-10-14T16:00:00Z' }, 201)
        : empty());
    const o = await api.queueOutreach({ job_url: 'https://x.com/j' });
    expect(o.id).toBe('o1');
    expect(calls.map((c) => [c.method, c.url.pathname])).toEqual([['POST', '/rest/v1/outreach'], ['POST', '/rest/v1/launch_requests']]);
    expect(calls[0].body).toEqual({ job_url: 'https://x.com/j', company: null, role: null });
    expect(calls[1].body).toEqual({ kind: 'outreach', payload: { outreach_id: 'o1', job_url: 'https://x.com/j' } });
  });
  it('surfaces PostgREST errors', async () => {
    const { api } = harness(() => json({ message: 'permission denied for table ideas' }, 403));
    await expect(api.listIdeas()).rejects.toThrow('permission denied');
  });
  it('syncLeetCode calls the function with the bearer token and maps errors', async () => {
    const ok = harness(() => json({ status: 'ok', added: 2 }));
    expect(await ok.api.syncLeetCode()).toEqual({ status: 'ok', added: 2 });
    expect(ok.calls[0].url.pathname).toBe('/api/sync-leetcode');
    expect(ok.calls[0].method).toBe('POST');
    expect(ok.calls[0].headers.authorization).toBe('Bearer tok');
    const bad = harness(() => json({ error: 'LeetCode HTTP 503' }, 502));
    expect(await bad.api.syncLeetCode()).toEqual({ status: 'error', message: 'LeetCode HTTP 503' });
    const notDeployed = harness(() => new Response('Not Found', { status: 404 }));
    expect(await notDeployed.api.syncLeetCode()).toEqual({ status: 'error', message: 'HTTP 404' });
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest run src/data`
Expected: FAIL with `Failed to resolve import "./demo"` and `"./supabase"`.

- [ ] **Step 3: Write env typing, the interface and auth**

`web/src/vite-env.d.ts`:
```ts
/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_DEMO?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

`web/src/data/api.ts`:
```ts
import type {
  Application, Commit, Contact, DailySet, Idea, IdeaPatch, LaunchKind, LaunchRequest, NewIdea, NewProject, Outreach,
  OutreachPatch, Posting, PostingStatus, Problem, ProblemState, Project, Rating, Settings, SettingsPatch, Solve,
  SyncResult, SyncStatus, Topic, TopicState,
} from './types';

export interface DataApi {
  getSettings(): Promise<Settings>;
  updateSettings(patch: SettingsPatch): Promise<void>;
  getDailySet(day: string): Promise<DailySet | null>;
  listProblems(): Promise<Problem[]>;
  listTopics(): Promise<Topic[]>;
  listTopicStates(): Promise<TopicState[]>;
  listProblemStates(): Promise<ProblemState[]>;
  listSolves(): Promise<Solve[]>;
  rateSolve(id: number, rating: Rating, at: Date): Promise<void>;
  listProjects(): Promise<Project[]>;
  addProject(p: NewProject): Promise<void>;
  setProjectActive(id: string, active: boolean): Promise<void>;
  listCommits(sinceIso: string): Promise<Commit[]>;
  listIdeas(): Promise<Idea[]>;
  addIdea(i: NewIdea): Promise<void>;
  updateIdea(id: string, patch: IdeaPatch): Promise<void>;
  listApplications(): Promise<Application[]>;
  listPostings(sinceIso: string): Promise<Posting[]>;
  setPostingStatus(id: string, status: PostingStatus): Promise<void>;
  listOutreach(): Promise<Outreach[]>;
  listContacts(): Promise<Contact[]>;
  queueOutreach(i: { job_url: string; company?: string | null; role?: string | null }): Promise<Outreach>;
  updateOutreach(id: string, patch: OutreachPatch): Promise<void>;
  requestLaunch(kind: LaunchKind, payload: Record<string, unknown>): Promise<void>;
  listLaunchRequests(): Promise<LaunchRequest[]>;
  listSyncStatus(): Promise<SyncStatus[]>;
  syncLeetCode(): Promise<SyncResult>;
}
```

`web/src/data/auth.ts`:
```ts
import type { SupabaseClient } from '@supabase/supabase-js';

export interface AuthApi {
  hasSession(): Promise<boolean>;
  onChange(cb: (signedIn: boolean) => void): () => void;
  sendLink(email: string): Promise<void>;
  verifyCode(email: string, code: string): Promise<void>;
  signOut(): Promise<void>;
}

export function supabaseAuth(sb: SupabaseClient, redirectTo = window.location.origin): AuthApi {
  return {
    async hasSession() {
      const { data } = await sb.auth.getSession();
      return data.session !== null;
    },
    onChange(cb) {
      const { data } = sb.auth.onAuthStateChange((_event, session) => cb(session !== null));
      return () => data.subscription.unsubscribe();
    },
    async sendLink(email) {
      // Sign-ups are disabled server-side; shouldCreateUser:false makes an unknown email fail fast.
      const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: redirectTo } });
      if (error) throw new Error(error.message);
    },
    async verifyCode(email, code) {
      const { error } = await sb.auth.verifyOtp({ email, token: code, type: 'email' });
      if (error) throw new Error(error.message);
    },
    async signOut() {
      await sb.auth.signOut();
    },
  };
}

export const demoAuth: AuthApi = {
  hasSession: async () => true,
  onChange: () => () => undefined,
  sendLink: async () => undefined,
  verifyCode: async () => undefined,
  signOut: async () => undefined,
};
```

- [ ] **Step 4: Write the Supabase implementation**

`web/src/data/supabase.ts`:
```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { DataApi } from './api';
import type {
  Application, Commit, Contact, DailySet, Idea, LaunchRequest, Outreach, Posting, Problem, ProblemState, Project,
  Settings, Solve, SyncResult, SyncStatus, Topic, TopicState,
} from './types';

type PgError = { message: string } | null;

async function rows<T>(p: PromiseLike<{ data: unknown; error: PgError }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data as T;
}

async function exec(p: PromiseLike<{ error: PgError }>): Promise<void> {
  const { error } = await p;
  if (error) throw new Error(error.message);
}

export function createSupabase(): SupabaseClient {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set (or run with VITE_DEMO=1).');
  return createClient(url, key, {
    auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
}

export interface SupabaseApiDeps {
  ownerId(): Promise<string>;
  accessToken(): Promise<string | null>;
  fetchImpl?: typeof fetch;
}

export function sessionDeps(sb: SupabaseClient): SupabaseApiDeps {
  return {
    async ownerId() {
      const { data } = await sb.auth.getSession();
      const id = data.session?.user.id;
      if (!id) throw new Error('Signed out');
      return id;
    },
    async accessToken() {
      return (await sb.auth.getSession()).data.session?.access_token ?? null;
    },
  };
}

export function createSupabaseApi(sb: SupabaseClient, deps: SupabaseApiDeps = sessionDeps(sb)): DataApi {
  const doFetch: typeof fetch = deps.fetchImpl ?? ((input, init) => fetch(input, init));

  const requestLaunch: DataApi['requestLaunch'] = (kind, payload) =>
    exec(sb.from('launch_requests').insert({ kind, payload }));

  return {
    async getSettings() {
      const list = await rows<Settings[]>(sb.from('settings').select('*').limit(1));
      if (!list.length) throw new Error('No settings row yet. Run the seed script (Plan 1 Task 11).');
      return list[0];
    },
    async updateSettings(patch) {
      await exec(sb.from('settings').update(patch).eq('owner', await deps.ownerId()));
    },
    async getDailySet(day) {
      const list = await rows<DailySet[]>(sb.from('lc_daily_sets').select('day,focus,mixed_day,items').eq('day', day).limit(1));
      return list[0] ?? null;
    },
    listProblems: () =>
      rows<Problem[]>(sb.from('problems').select('slug,lc_id,title,difficulty,topic,lists,paid_only,ac_rate,target_minutes,neetcode_link')),
    listTopics: () => rows<Topic[]>(sb.from('topics').select('name,ord,tier,prereqs,lc_tags').order('ord')),
    listTopicStates: () => rows<TopicState[]>(sb.from('lc_topic_state').select('topic,level')),
    listProblemStates: () => rows<ProblemState[]>(sb.from('lc_problem_state').select('slug,state,interval_days,due_on,lapses')),
    listSolves: () =>
      rows<Solve[]>(sb.from('lc_solves').select('id,slug,title,accepted_at,rating,rated_at,slot,note')
        .order('accepted_at', { ascending: false }).limit(2000)),
    rateSolve: (id, rating, at) =>
      exec(sb.from('lc_solves').update({ rating, rated_at: at.toISOString() }).eq('id', id)),
    listProjects: () => rows<Project[]>(sb.from('projects').select('id,name,repo,local_path,active').order('name')),
    addProject: (p) => exec(sb.from('projects').insert({ ...p, active: true })),
    setProjectActive: (id, active) => exec(sb.from('projects').update({ active }).eq('id', id)),
    listCommits: (since) =>
      rows<Commit[]>(sb.from('commits').select('sha,project_id,message,committed_at').gte('committed_at', since)
        .order('committed_at', { ascending: false })),
    listIdeas: () =>
      rows<Idea[]>(sb.from('ideas').select('id,project_id,text,size,status,source,position,today_on,done_at,created_at').order('position')),
    addIdea: (i) => exec(sb.from('ideas').insert({ ...i, status: 'todo', source: 'me' })),
    updateIdea: (id, patch) => exec(sb.from('ideas').update(patch).eq('id', id)),
    listApplications: () =>
      rows<Application[]>(sb.from('applications').select('id,company,role,track,term,location,status,stage,priority,applied_on')),
    listPostings: (since) =>
      rows<Posting[]>(sb.from('postings').select('id,company,title,location,url,term,posted_at,tier,starred,status,found_at')
        .in('status', ['new', 'seen']).gte('found_at', since).order('found_at', { ascending: false })),
    setPostingStatus: (id, status) => exec(sb.from('postings').update({ status }).eq('id', id)),
    listOutreach: () =>
      rows<Outreach[]>(sb.from('outreach').select('id,job_url,company,role,resume_path,status,sent_on,follow_up_on,created_at')
        .order('created_at', { ascending: false })),
    listContacts: () =>
      rows<Contact[]>(sb.from('contacts').select('id,outreach_id,name,title,linkedin_url,email_guess,email_confidence,why,draft_subject,draft_body')),
    async queueOutreach(i) {
      const o = await rows<Outreach>(sb.from('outreach')
        .insert({ job_url: i.job_url, company: i.company ?? null, role: i.role ?? null }).select().single());
      await requestLaunch('outreach', { outreach_id: o.id, job_url: o.job_url });
      return o;
    },
    updateOutreach: (id, patch) => exec(sb.from('outreach').update(patch).eq('id', id)),
    requestLaunch,
    listLaunchRequests: () =>
      rows<LaunchRequest[]>(sb.from('launch_requests').select('id,kind,payload,status,error,created_at')
        .order('created_at', { ascending: false }).limit(50)),
    listSyncStatus: () => rows<SyncStatus[]>(sb.from('sync_status').select('source,last_ok_at,last_error,consecutive_failures')),
    async syncLeetCode(): Promise<SyncResult> {
      const token = await deps.accessToken();
      if (!token) return { status: 'error', message: 'Signed out' };
      const res = await doFetch('/api/sync-leetcode', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const body = (await res.json().catch(() => null)) as { error?: string } | SyncResult | null;
      if (!res.ok) return { status: 'error', message: (body as { error?: string } | null)?.error ?? `HTTP ${res.status}` };
      return body as SyncResult;
    },
  };
}
```
If `queueOutreach`'s second insert fails, the outreach row exists without a request; the Outreach screen shows it as "Not queued" with **Try again** (Task 10), so nothing is lost.

- [ ] **Step 5: Write the demo fixtures and demo implementation**

`web/src/data/fixtures.ts`:
```ts
import { addDays, localDay, planDay } from '../lib/time';
import type {
  Application, Commit, Contact, DailySet, Difficulty, Idea, LaunchRequest, Level, Outreach, Posting, Problem,
  ProblemState, Project, Rating, Settings, Solve, Stage, SyncStatus, Topic, TopicState,
} from './types';

export interface DemoDb {
  settings: Settings;
  dailySet: DailySet;
  problems: Problem[];
  topics: Topic[];
  topicStates: TopicState[];
  problemStates: ProblemState[];
  solves: Solve[];
  projects: Project[];
  commits: Commit[];
  ideas: Idea[];
  applications: Application[];
  postings: Posting[];
  outreach: Outreach[];
  contacts: Contact[];
  launchRequests: LaunchRequest[];
  syncStatus: SyncStatus[];
}

const TOPICS: [string, number, string[]][] = [
  ['Arrays & Hashing', 0, []], ['Two Pointers', 1, ['Arrays & Hashing']], ['Stack', 1, ['Arrays & Hashing']],
  ['Binary Search', 2, ['Two Pointers']], ['Sliding Window', 2, ['Two Pointers']], ['Linked List', 2, ['Two Pointers']],
  ['Trees', 3, ['Linked List', 'Binary Search']], ['Tries', 4, ['Trees']], ['Heap / Priority Queue', 4, ['Trees']],
  ['Backtracking', 4, ['Trees']], ['Graphs', 5, ['Backtracking']], ['1-D Dynamic Programming', 5, ['Backtracking']],
  ['Intervals', 5, ['Heap / Priority Queue']], ['Greedy', 5, ['Heap / Priority Queue']],
  ['Advanced Graphs', 6, ['Heap / Priority Queue', 'Graphs']], ['2-D Dynamic Programming', 6, ['Graphs', '1-D Dynamic Programming']],
  ['Bit Manipulation', 6, ['1-D Dynamic Programming']], ['Math & Geometry', 7, ['2-D Dynamic Programming', 'Bit Manipulation']],
];
const LEVELS: Record<string, Level> = {
  'Arrays & Hashing': 'solid', 'Two Pointers': 'practicing', Stack: 'practicing', 'Binary Search': 'available',
  'Sliding Window': 'learning', 'Linked List': 'available',
};
const PROBLEMS: [string, string, Difficulty, string, number][] = [
  ['two-sum', 'Two Sum', 'Easy', 'Arrays & Hashing', 1],
  ['valid-anagram', 'Valid Anagram', 'Easy', 'Arrays & Hashing', 242],
  ['group-anagrams', 'Group Anagrams', 'Medium', 'Arrays & Hashing', 49],
  ['top-k-frequent-elements', 'Top K Frequent Elements', 'Medium', 'Arrays & Hashing', 347],
  ['product-of-array-except-self', 'Product of Array Except Self', 'Medium', 'Arrays & Hashing', 238],
  ['valid-palindrome', 'Valid Palindrome', 'Easy', 'Two Pointers', 125],
  ['3sum', '3Sum', 'Medium', 'Two Pointers', 15],
  ['container-with-most-water', 'Container With Most Water', 'Medium', 'Two Pointers', 11],
  ['valid-parentheses', 'Valid Parentheses', 'Easy', 'Stack', 20],
  ['daily-temperatures', 'Daily Temperatures', 'Medium', 'Stack', 739],
  ['best-time-to-buy-and-sell-stock', 'Best Time to Buy and Sell Stock', 'Easy', 'Sliding Window', 121],
  ['contains-duplicate-ii', 'Contains Duplicate II', 'Easy', 'Sliding Window', 219],
  ['longest-substring-without-repeating-characters', 'Longest Substring Without Repeating Characters', 'Medium', 'Sliding Window', 3],
  ['longest-repeating-character-replacement', 'Longest Repeating Character Replacement', 'Medium', 'Sliding Window', 424],
  ['permutation-in-string', 'Permutation in String', 'Medium', 'Sliding Window', 567],
  ['minimum-window-substring', 'Minimum Window Substring', 'Hard', 'Sliding Window', 76],
];
const HISTORY: [number, string, Rating][] = [
  [1, 'valid-anagram', 'nailed'], [1, 'group-anagrams', 'struggled'], [2, '3sum', 'struggled'], [2, 'valid-palindrome', 'nailed'],
  [3, 'container-with-most-water', 'help'], [4, 'valid-parentheses', 'nailed'], [5, 'top-k-frequent-elements', 'nailed'],
  [5, 'product-of-array-except-self', 'struggled'], [6, 'two-sum', 'nailed'], [8, 'group-anagrams', 'nailed'],
  [9, 'valid-anagram', 'nailed'], [10, '3sum', 'help'], [11, 'two-sum', 'struggled'], [13, 'valid-palindrome', 'nailed'],
  [16, 'contains-duplicate-ii', 'nailed'], [20, 'top-k-frequent-elements', 'struggled'], [24, 'valid-parentheses', 'struggled'],
  [30, 'product-of-array-except-self', 'help'], [45, 'container-with-most-water', 'struggled'],
];
const APPS: [string, string, Stage, string, number][] = [
  ['Stripe', 'Software Engineer Intern, Winter 2027', 'oa', 'OA invited', 9],
  ['Ramp', 'Software Engineer Intern', 'applied', 'Submitted', 1],
  ['Figma', 'Software Engineer Intern, Spring 2027', 'applied', 'Submitted', 2],
  ['Datadog', 'Software Engineer Intern', 'interview', 'Interview - R1', 14],
  ['Ford', 'Software Engineering Co-op, Winter 2027', 'applied', 'Submitted', 0],
  ['GM', 'Software Developer Intern', 'applied', 'Submitted', 2],
  ['Rocket Companies', 'Software Engineer Intern', 'closed', 'Rejected', 20],
  ['Amazon', 'SDE Intern 2027', 'oa', 'OA - HackerRank', 6],
  ['Duolingo', 'Software Engineer Intern', 'applied', 'Submitted', 4],
  ['Notion', 'Software Engineer, New Grad', 'applied', 'Submitted', 8],
  ['Robinhood', 'Software Engineer Intern', 'closed', 'Rejected', 18],
  ['Palantir', 'Forward Deployed SWE Intern', 'interview', 'Final round', 12],
  ['Cloudflare', 'Software Engineer Intern', 'applied', 'Submitted', 3],
  ['Stryker', 'Software Engineering Co-op', 'applied', 'Submitted', 10],
  ['Capital One', 'Technology Internship Program', 'applied', 'Submitted', 16],
  ["Domino's", 'Software Engineer Intern', 'applied', 'Submitted', 5],
  ['Plaid', 'Software Engineer Intern', 'applied', 'Submitted', 11],
  ['Ally', 'Technology Intern', 'closed', 'No response', 25],
  ['Whoop', 'Software Engineer Co-op', 'applied', 'Submitted', 1],
  ['Epic Games', 'Software Engineer Intern', 'applied', 'Submitted', 22],
];
const POSTINGS: [string, string, string, string, string | null, boolean, string, number][] = [
  ['p1', 'Stripe', 'Software Engineer Intern, Winter 2027', 'Chicago, IL', 'Winter 2027', true, 'A', 2],
  ['p2', 'Ford', 'Software Engineering Co-op', 'Dearborn, MI', 'Winter 2027', true, 'B', 5],
  ['p3', 'Ramp', 'Software Engineer, New Grad', 'New York, NY', null, false, 'A', 8],
  ['p4', 'Cloudflare', 'Software Engineer Intern', 'Remote - US', 'Summer 2027', false, 'A', 20],
  ['p5', 'Duolingo', 'Software Engineer Intern', 'Pittsburgh, PA', 'Summer 2027', false, 'B', 26],
  ['p6', 'Rocket Companies', 'Software Engineer Intern', 'Detroit, MI', 'Spring 2027', true, 'B', 30],
  ['p7', 'Datadog', 'Software Engineer, Early Career', 'New York, NY; Boston, MA', null, false, 'A', 40],
  ['p8', 'Robinhood', 'Software Engineer Intern', 'Menlo Park, CA', 'Summer 2027', false, 'A', 50],
];

export function createFixtures(now: Date): DemoDb {
  const day = planDay(now);
  const today = localDay(now);
  const at = (daysAgo: number) => `${addDays(today, -daysAgo)}T18:00:00Z`; // 14:00 EDT / 13:00 EST that day
  const minsAgo = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
  let solveId = 1;
  const solve = (slug: string, accepted_at: string, rating: Rating | null): Solve => ({
    id: solveId++, slug, title: PROBLEMS.find((p) => p[0] === slug)![1], accepted_at, rating,
    rated_at: rating ? accepted_at : null, slot: null, note: null,
  });

  return {
    settings: {
      nudge_times: ['10:00', '18:00', '22:00'], daily_lc_count: 6, weekly_app_target: 25, ntfy_topic: null,
      resume_root: '~/Desktop/Adam_Kuhn_Resumes', sheet_id: 'demo-sheet-id', lc_username: 'adamkuhn',
      lc_started_on: addDays(day, -11), lc_focus_topic: 'Sliding Window', lc_focus_since: addDays(day, -3), app_url: null,
    },
    dailySet: {
      day, focus: 'Sliding Window', mixed_day: false,
      items: [
        { slug: 'two-sum', slot: 'review', order: 0, done: true },
        { slug: 'best-time-to-buy-and-sell-stock', slot: 'new', order: 1, done: false },
        { slug: 'contains-duplicate-ii', slot: 'new', order: 2, done: false },
        { slug: 'longest-substring-without-repeating-characters', slot: 'new', order: 3, done: false },
        { slug: 'daily-temperatures', slot: 'mystery', order: 4, done: false },
        { slug: 'permutation-in-string', slot: 'new', order: 5, done: false },
      ],
    },
    problems: PROBLEMS.map(([slug, title, difficulty, topic, lc_id]) => ({
      slug, title, difficulty, topic, lc_id, lists: ['nc150'], paid_only: false, ac_rate: 50, target_minutes: null, neetcode_link: null,
    })),
    topics: TOPICS.map(([name, tier, prereqs], i) => ({ name, tier, prereqs, ord: i + 1, lc_tags: [] })),
    topicStates: TOPICS.map(([name]) => ({ topic: name, level: LEVELS[name] ?? 'locked' })),
    problemStates: [
      { slug: 'valid-anagram', state: 'reviewing', interval_days: 3, due_on: day, lapses: 0 },
      { slug: 'group-anagrams', state: 'learning', interval_days: 1, due_on: addDays(day, -1), lapses: 1 },
      { slug: '3sum', state: 'reviewing', interval_days: 3, due_on: addDays(day, 3), lapses: 1 },
      { slug: 'container-with-most-water', state: 'learning', interval_days: 1, due_on: addDays(day, 5), lapses: 2 },
      { slug: 'two-sum', state: 'reviewing', interval_days: 7, due_on: addDays(day, 7), lapses: 0 },
    ],
    solves: [
      solve('best-time-to-buy-and-sell-stock', minsAgo(1), null),
      solve('two-sum', minsAgo(2), 'nailed'),
      ...HISTORY.map(([d, slug, rating]) => solve(slug, at(d), rating)),
    ],
    projects: [
      { id: '27b', name: '27B', repo: 'adamkuhn1/27b', local_path: '~/Developer/27b', active: true },
      { id: 'showboat', name: 'Showboat', repo: 'adamkuhn1/showboat', local_path: '~/Developer/showboat', active: true },
    ],
    commits: [
      ...[1, 2, 4, 7, 9, 15].map((d, i) => ({ sha: `27b${i}`, project_id: '27b', message: ['Add city search', 'Fix map zoom', 'Cache tiles', 'Add tests for routing', 'Refactor store', 'Initial map view'][i], committed_at: at(d) })),
      ...[3, 10, 20].map((d, i) => ({ sha: `sb${i}`, project_id: 'showboat', message: ['Polish landing page', 'Add auth', 'Scaffold app'][i], committed_at: at(d) })),
    ],
    ideas: [
      { id: 'i1', project_id: '27b', text: 'Add Chicago to the city picker', size: 'S', status: 'today', source: 'me', position: 0, today_on: day, done_at: null, created_at: hoursAgo(200) },
      { id: 'i2', project_id: '27b', text: 'Cache weather API responses', size: 'S', status: 'todo', source: 'me', position: 1, today_on: null, done_at: null, created_at: hoursAgo(190) },
      { id: 'i3', project_id: '27b', text: 'Add README screenshots', size: 'S', status: 'todo', source: 'claude', position: 2, today_on: null, done_at: null, created_at: hoursAgo(100) },
      { id: 'i4', project_id: '27b', text: 'Offline mode for saved trips', size: 'M', status: 'todo', source: 'claude', position: 3, today_on: null, done_at: null, created_at: hoursAgo(100) },
      { id: 'i5', project_id: 'showboat', text: 'Add loading skeletons to the feed', size: 'S', status: 'todo', source: 'me', position: 0, today_on: null, done_at: null, created_at: hoursAgo(300) },
      { id: 'i6', project_id: 'showboat', text: 'Fix nav overlap on small phones', size: 'S', status: 'todo', source: 'me', position: 1, today_on: null, done_at: null, created_at: hoursAgo(250) },
      { id: 'i7', project_id: 'showboat', text: 'End-to-end test for sign-up', size: 'M', status: 'done', source: 'me', position: 2, today_on: addDays(day, -3), done_at: hoursAgo(70), created_at: hoursAgo(400) },
    ],
    applications: APPS.map(([company, role, stage, status, d], id) => ({
      id: id + 1, company, role, stage, status, track: role.includes('New Grad') ? 'New grad' : 'Internship', term: null,
      location: null, priority: null, applied_on: addDays(today, -d),
    })),
    postings: POSTINGS.map(([id, company, title, location, term, starred, tier, h]) => ({
      id, company, title, location, term, starred, tier, status: 'new', posted_at: hoursAgo(h), found_at: hoursAgo(h),
      url: `https://boards.greenhouse.io/${company.toLowerCase().replace(/[^a-z]/g, '')}/jobs/${4000000 + h}`,
    })),
    outreach: [
      { id: 'o2', job_url: 'https://jobs.ashbyhq.com/ramp/7d1c', company: 'Ramp', role: 'Software Engineer Intern', resume_path: null, status: 'queued', sent_on: null, follow_up_on: null, created_at: minsAgo(5) },
      { id: 'o1', job_url: 'https://boards.greenhouse.io/stripe/jobs/4000002', company: 'Stripe', role: 'Software Engineer Intern, Winter 2027', resume_path: '~/Desktop/Adam_Kuhn_Resumes/Stripe_SWE_Intern_2027/Adam_Kuhn_Resume.pdf', status: 'drafted', sent_on: null, follow_up_on: null, created_at: hoursAgo(26) },
    ],
    contacts: [
      {
        id: 'c1', outreach_id: 'o1', name: 'Dana Reyes', title: 'University Recruiter', linkedin_url: 'https://www.linkedin.com/in/example-dana',
        email_guess: 'dreyes@stripe.com', email_confidence: 'pattern', why: 'Runs early-career hiring for Payments; pattern from a public talk page.',
        draft_subject: 'CMU student, Winter 2027 SWE intern',
        draft_body: "Hi Dana,\n\nI saw your post about Stripe's Winter 2027 intern class and applied to the Software Engineer Intern role. I'm a CS student at Central Michigan University graduating May 2027 (flexible through December).\n\nI built 27B, a trip planner that caches map tiles offline and handles 2k daily users. Payments reliability is the kind of problem I want to work on next.\n\nWould you be open to a 15-minute chat, or pointing me to the right recruiter for Payments?\n\nThanks,\nAdam",
      },
      {
        id: 'c2', outreach_id: 'o1', name: 'Marcus Lee', title: 'Software Engineer, Payments', linkedin_url: 'https://www.linkedin.com/in/example-marcus',
        email_guess: 'mlee@stripe.com', email_confidence: 'guess', why: 'Michigan alum on the team named in the posting.',
        draft_subject: 'Fellow Michigander, Payments intern question',
        draft_body: "Hi Marcus,\n\nI'm a CS student at Central Michigan University and noticed you went to school in Michigan too. I applied to Stripe's Winter 2027 SWE intern role on Payments.\n\nMy project 27B taught me a lot about caching and failure modes. I'd love to hear what the team's first month looks like for interns.\n\nWould you have 15 minutes in the next couple of weeks?\n\nThanks,\nAdam",
      },
    ],
    launchRequests: [
      { id: 'r1', kind: 'outreach', payload: { outreach_id: 'o2', job_url: 'https://jobs.ashbyhq.com/ramp/7d1c' }, status: 'queued', error: null, created_at: minsAgo(5) },
    ],
    syncStatus: [
      { source: 'leetcode', last_ok_at: minsAgo(12), last_error: null, consecutive_failures: 0 },
      { source: 'github', last_ok_at: minsAgo(12), last_error: null, consecutive_failures: 0 },
      { source: 'sheet', last_ok_at: hoursAgo(3), last_error: 'TransportError: timed out', consecutive_failures: 6 },
      { source: 'jobs', last_ok_at: minsAgo(12), last_error: null, consecutive_failures: 0 },
    ],
  };
}
```

`web/src/data/demo.ts`:
```ts
import type { DataApi } from './api';
import { createFixtures } from './fixtures';
import type { Idea, Outreach } from './types';

export { demoAuth } from './auth';

export function createDemoApi(now: Date = new Date()): DataApi {
  const db = createFixtures(now);
  const copy = <T>(x: T): Promise<T> => Promise.resolve(structuredClone(x));
  let seq = 1;
  const newId = (prefix: string) => `${prefix}-demo-${seq++}`;
  const stamp = () => new Date().toISOString();

  return {
    getSettings: () => copy(db.settings),
    async updateSettings(patch) { Object.assign(db.settings, patch); },
    getDailySet: (day) => copy(db.dailySet.day === day ? db.dailySet : null),
    listProblems: () => copy(db.problems),
    listTopics: () => copy(db.topics),
    listTopicStates: () => copy(db.topicStates),
    listProblemStates: () => copy(db.problemStates),
    listSolves: () => copy([...db.solves].sort((a, b) => Date.parse(b.accepted_at) - Date.parse(a.accepted_at))),
    async rateSolve(id, rating, at) {
      const s = db.solves.find((x) => x.id === id);
      if (s) Object.assign(s, { rating, rated_at: at.toISOString() });
    },
    listProjects: () => copy(db.projects),
    async addProject(p) { db.projects.push({ ...p, active: true }); },
    async setProjectActive(id, active) {
      const p = db.projects.find((x) => x.id === id);
      if (p) p.active = active;
    },
    listCommits: (since) => copy(db.commits.filter((c) => c.committed_at >= since)),
    listIdeas: () => copy([...db.ideas].sort((a, b) => a.position - b.position)),
    async addIdea(i) {
      const idea: Idea = { ...i, id: newId('idea'), status: 'todo', source: 'me', today_on: null, done_at: null, created_at: stamp() };
      db.ideas.push(idea);
    },
    async updateIdea(id, patch) {
      const i = db.ideas.find((x) => x.id === id);
      if (i) Object.assign(i, patch);
    },
    listApplications: () => copy(db.applications),
    listPostings: (since) => copy(db.postings.filter((p) => (p.status === 'new' || p.status === 'seen') && p.found_at >= since)),
    async setPostingStatus(id, status) {
      const p = db.postings.find((x) => x.id === id);
      if (p) p.status = status;
    },
    listOutreach: () => copy(db.outreach),
    listContacts: () => copy(db.contacts),
    async queueOutreach(i) {
      const o: Outreach = {
        id: newId('out'), job_url: i.job_url, company: i.company ?? null, role: i.role ?? null, resume_path: null,
        status: 'queued', sent_on: null, follow_up_on: null, created_at: stamp(),
      };
      db.outreach.unshift(o);
      db.launchRequests.unshift({ id: newId('req'), kind: 'outreach', payload: { outreach_id: o.id, job_url: o.job_url }, status: 'queued', error: null, created_at: o.created_at });
      return structuredClone(o);
    },
    async updateOutreach(id, patch) {
      const o = db.outreach.find((x) => x.id === id);
      if (o) Object.assign(o, patch);
    },
    async requestLaunch(kind, payload) {
      db.launchRequests.unshift({ id: newId('req'), kind, payload, status: 'queued', error: null, created_at: stamp() });
    },
    listLaunchRequests: () => copy(db.launchRequests),
    listSyncStatus: () => copy(db.syncStatus),
    syncLeetCode: async () => ({ status: 'skipped' }),
  };
}
```
ISO strings compare correctly as text only when both use the same format; every fixture timestamp here is `toISOString()` or `…T18:00:00Z`, and every `since` the app passes is `toISOString()`, so the string comparisons in `listCommits`/`listPostings` are safe in demo mode.

- [ ] **Step 6: Write the context, hooks and the test render helper**

`web/src/data/context.tsx`:
```tsx
import { createContext, useContext, type ReactNode } from 'react';
import type { DataApi } from './api';
import type { AuthApi } from './auth';

const ApiContext = createContext<DataApi | null>(null);
const AuthContext = createContext<AuthApi | null>(null);

export function DataProvider({ api, auth, children }: { api: DataApi; auth: AuthApi; children: ReactNode }) {
  return (
    <AuthContext.Provider value={auth}>
      <ApiContext.Provider value={api}>{children}</ApiContext.Provider>
    </AuthContext.Provider>
  );
}

export function useApi(): DataApi {
  const api = useContext(ApiContext);
  if (!api) throw new Error('useApi must be used inside <DataProvider>');
  return api;
}

export function useAuth(): AuthApi {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('useAuth must be used inside <DataProvider>');
  return auth;
}
```

`web/src/data/hooks.ts`:
```ts
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DataApi } from './api';
import { useApi } from './context';
import type { IdeaPatch, LaunchKind, NewIdea, NewProject, OutreachPatch, PostingStatus, Problem, Rating, SettingsPatch, Solve } from './types';

export const keys = {
  settings: ['settings'],
  dailySet: (day: string) => ['dailySet', day],
  dailySets: ['dailySet'],
  problems: ['problems'],
  topics: ['topics'],
  topicStates: ['topicStates'],
  problemStates: ['problemStates'],
  solves: ['solves'],
  projects: ['projects'],
  commits: ['commits'],
  ideas: ['ideas'],
  applications: ['applications'],
  postings: ['postings'],
  outreach: ['outreach'],
  contacts: ['contacts'],
  launchRequests: ['launchRequests'],
  syncStatus: ['syncStatus'],
} as const;

const HOUR = 3_600_000;
const sinceDays = (days: number) => new Date(Date.now() - days * 24 * HOUR).toISOString();

export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
  return now;
}

export const useSettings = () => { const api = useApi(); return useQuery({ queryKey: keys.settings, queryFn: () => api.getSettings() }); };
export const useDailySet = (day: string) => { const api = useApi(); return useQuery({ queryKey: keys.dailySet(day), queryFn: () => api.getDailySet(day) }); };
export const useProblems = () => { const api = useApi(); return useQuery({ queryKey: keys.problems, queryFn: () => api.listProblems(), staleTime: 24 * HOUR }); };
export function useProblemMap(): Map<string, Problem> {
  const { data } = useProblems();
  return useMemo(() => new Map((data ?? []).map((p) => [p.slug, p])), [data]);
}
export const useTopics = () => { const api = useApi(); return useQuery({ queryKey: keys.topics, queryFn: () => api.listTopics(), staleTime: 24 * HOUR }); };
export const useTopicStates = () => { const api = useApi(); return useQuery({ queryKey: keys.topicStates, queryFn: () => api.listTopicStates() }); };
export const useProblemStates = () => { const api = useApi(); return useQuery({ queryKey: keys.problemStates, queryFn: () => api.listProblemStates() }); };
export const useSolves = () => { const api = useApi(); return useQuery({ queryKey: keys.solves, queryFn: () => api.listSolves() }); };
export const useProjects = () => { const api = useApi(); return useQuery({ queryKey: keys.projects, queryFn: () => api.listProjects() }); };
export const useCommits = () => { const api = useApi(); return useQuery({ queryKey: keys.commits, queryFn: () => api.listCommits(sinceDays(365)) }); };
export const useIdeas = () => { const api = useApi(); return useQuery({ queryKey: keys.ideas, queryFn: () => api.listIdeas() }); };
export const useApplications = () => { const api = useApi(); return useQuery({ queryKey: keys.applications, queryFn: () => api.listApplications() }); };
export const usePostings = () => { const api = useApi(); return useQuery({ queryKey: keys.postings, queryFn: () => api.listPostings(sinceDays(30)) }); };
export const useOutreach = () => {
  const api = useApi();
  return useQuery({
    queryKey: keys.outreach, queryFn: () => api.listOutreach(),
    refetchInterval: (q) => (q.state.data?.some((o) => o.status === 'queued') ? 15_000 : false),
  });
};
export const useContacts = () => { const api = useApi(); return useQuery({ queryKey: keys.contacts, queryFn: () => api.listContacts() }); };
export const useLaunchRequests = () => {
  const api = useApi();
  return useQuery({
    queryKey: keys.launchRequests, queryFn: () => api.listLaunchRequests(),
    refetchInterval: (q) => (q.state.data?.some((r) => r.status === 'queued') ? 10_000 : false),
  });
};
export const useSyncStatus = () => { const api = useApi(); return useQuery({ queryKey: keys.syncStatus, queryFn: () => api.listSyncStatus() }); };

function useApiMutation<V>(fn: (api: DataApi, v: V) => Promise<unknown>, invalidate: QueryKey[]) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: V) => fn(api, v),
    onSettled: () => Promise.all(invalidate.map((k) => qc.invalidateQueries({ queryKey: k }))),
  });
}

export function useRateSolve() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; rating: Rating }) => api.rateSolve(v.id, v.rating, new Date()),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: keys.solves });
      const prev = qc.getQueryData<Solve[]>(keys.solves);
      qc.setQueryData<Solve[]>(keys.solves, (list) => list?.map((s) => (s.id === v.id ? { ...s, rating: v.rating } : s)));
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(keys.solves, ctx.prev); },
    onSettled: () => qc.invalidateQueries({ queryKey: keys.solves }),
  });
}

export const useUpdateSettings = () => useApiMutation((api, patch: SettingsPatch) => api.updateSettings(patch), [keys.settings]);
export const useAddProject = () => useApiMutation((api, p: NewProject) => api.addProject(p), [keys.projects]);
export const useSetProjectActive = () =>
  useApiMutation((api, v: { id: string; active: boolean }) => api.setProjectActive(v.id, v.active), [keys.projects]);
export const useAddIdea = () => useApiMutation((api, i: NewIdea) => api.addIdea(i), [keys.ideas]);
export const useUpdateIdea = () => useApiMutation((api, v: { id: string; patch: IdeaPatch }) => api.updateIdea(v.id, v.patch), [keys.ideas]);
export const useReorderIdeas = () =>
  useApiMutation((api, moves: { id: string; position: number }[]) =>
    Promise.all(moves.map((m) => api.updateIdea(m.id, { position: m.position }))), [keys.ideas]);
export const useSwapIdea = () =>
  useApiMutation(async (api, v: { fromId: string; toId: string; day: string }) => {
    await api.updateIdea(v.fromId, { status: 'todo', today_on: null });
    await api.updateIdea(v.toId, { status: 'today', today_on: v.day });
  }, [keys.ideas]);
export const useSetPostingStatus = () =>
  useApiMutation((api, v: { id: string; status: PostingStatus }) => api.setPostingStatus(v.id, v.status), [keys.postings]);
export const useQueueOutreach = () =>
  useApiMutation((api, v: { job_url: string; company?: string | null; role?: string | null }) => api.queueOutreach(v),
    [keys.outreach, keys.launchRequests]);
export const useUpdateOutreach = () =>
  useApiMutation((api, v: { id: string; patch: OutreachPatch }) => api.updateOutreach(v.id, v.patch), [keys.outreach]);
export const useRequestLaunch = () =>
  useApiMutation((api, v: { kind: LaunchKind; payload: Record<string, unknown> }) => api.requestLaunch(v.kind, v.payload),
    [keys.launchRequests]);

export function useSyncLeetCode() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.syncLeetCode(),
    onSuccess: (r) => {
      if (r.status === 'ok' && r.added > 0) {
        void qc.invalidateQueries({ queryKey: keys.solves });
        void qc.invalidateQueries({ queryKey: keys.dailySets });
      }
    },
  });
}

/** Sync LeetCode when the app opens and whenever it comes back to the foreground (at most once a minute). */
export function useSyncOnOpen() {
  const sync = useSyncLeetCode();
  const last = useRef(0);
  const { mutate } = sync;
  useEffect(() => {
    const go = () => {
      if (document.visibilityState !== 'visible' || Date.now() - last.current < 60_000) return;
      last.current = Date.now();
      mutate();
    };
    go();
    document.addEventListener('visibilitychange', go);
    return () => document.removeEventListener('visibilitychange', go);
  }, [mutate]);
  return sync;
}
```

`web/src/test/render.tsx`:
```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router';
import type { DataApi } from '../data/api';
import { demoAuth } from '../data/auth';
import { DataProvider } from '../data/context';
import { createDemoApi } from '../data/demo';

export function renderWithData(ui: ReactElement, opts: { api?: DataApi; route?: string } = {}) {
  const api = opts.api ?? createDemoApi();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  const result = render(
    <DataProvider api={api} auth={demoAuth}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[opts.route ?? '/']}>{ui}</MemoryRouter>
      </QueryClientProvider>
    </DataProvider>,
  );
  return { ...result, api, qc };
}
```

- [ ] **Step 7: Run the tests and confirm they pass**

Run: `npx vitest run src/data && npm run typecheck && npm run lint`
Expected: `demo.test.ts` 8 passed, `supabase.test.ts` 6 passed; tsc and eslint clean.

- [ ] **Step 8: Commit**

```bash
git add web/src/vite-env.d.ts web/src/data web/src/test/render.tsx
git commit -m "Add web data layer with Supabase and demo implementations"
```

---

### Task 4: App shell: sign-in, routing, navigation, UI primitives, styles

**Files:**
- Create: `web/src/App.tsx`, `web/src/ui/AppShell.tsx`, `web/src/ui/SignIn.tsx`, `web/src/ui/primitives.tsx`, `web/src/styles/app.css`, `web/src/ui/SignIn.test.tsx`, `web/src/ui/AppShell.test.tsx`, and one starter file per screen: `web/src/screens/{Today,LeetCode,Projects,Applications,Jobs,Outreach,Settings}.tsx` (Tasks 6–10 replace each one wholesale)
- Modify: `web/src/main.tsx` (replace the temporary version)

**Interfaces:**
- Consumes: `DataApi`, `AuthApi`, `DataProvider`, `useSyncOnOpen`, `useSyncStatus`, `useNow` (Task 3), `anyStale` (Task 2)
- Produces:
  - `App({api, auth})` with routes `/` Today, `/leetcode`, `/projects`, `/apps`, `/jobs`, `/outreach`, `/settings`; unknown paths redirect to `/`
  - `AppShell` (renders `<main id="main">` around the route; screens render `<div className="screen">` with one `<h1>`)
  - `SignIn({auth})`
  - primitives: `Button({variant?: 'primary'|'ghost'|'quiet'|'danger', ...button props})` (defaults `type="button"`), `Card` (`<section className="card">`, passes through props such as `data-primary` and `aria-labelledby`), `CardHead({title, id, children?})`, `Chip({pressed, onToggle, children})`, `Badge({tone?: 'accent'|'warn'|'danger'|'muted', children})`, `DifficultyTag({d})`, `Empty`, `Skeleton({label?})`, `LoadError({what, onRetry})`, `Disclosure({summary, open?, children})`, `CopyButton({text, label})`, `Stepper({label, value, min, max, onChange})`, `ExternalLink({href, children, className?})` (renders a link only if `safeHref(href)`; otherwise plain text)

- [ ] **Step 1: Write the failing tests**

`web/src/ui/SignIn.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AuthApi } from '../data/auth';
import { SignIn } from './SignIn';

function fakeAuth(over: Partial<AuthApi> = {}): AuthApi {
  return {
    hasSession: async () => false, onChange: () => () => undefined, signOut: async () => undefined,
    sendLink: vi.fn(async () => undefined), verifyCode: vi.fn(async () => undefined), ...over,
  };
}

describe('SignIn', () => {
  it('sends the email, then accepts the code', async () => {
    const auth = fakeAuth();
    render(<SignIn auth={auth} />);
    await userEvent.type(screen.getByLabelText('Email'), ' adam@example.com ');
    await userEvent.click(screen.getByRole('button', { name: 'Send sign-in email' }));
    expect(auth.sendLink).toHaveBeenCalledWith('adam@example.com');
    await userEvent.type(await screen.findByLabelText('Code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(auth.verifyCode).toHaveBeenCalledWith('adam@example.com', '123456');
  });
  it('shows the server error', async () => {
    const auth = fakeAuth({ sendLink: vi.fn(async () => { throw new Error('Signups not allowed for otp'); }) });
    render(<SignIn auth={auth} />);
    await userEvent.type(screen.getByLabelText('Email'), 'x@y.co');
    await userEvent.click(screen.getByRole('button', { name: 'Send sign-in email' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Signups not allowed for otp');
  });
});
```

`web/src/ui/AppShell.test.tsx`:
```tsx
import { screen, within } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { createDemoApi } from '../data/demo';
import { renderWithData } from '../test/render';
import { AppShell } from './AppShell';

const tree = (
  <Routes>
    <Route element={<AppShell />}>
      <Route index element={<p>home</p>} />
    </Route>
  </Routes>
);

describe('AppShell', () => {
  it('has six tabs, a settings link flagged stale, and syncs on open', async () => {
    const api = createDemoApi();
    const spy = vi.spyOn(api, 'syncLeetCode');
    renderWithData(tree, { api });
    const tabs = screen.getByRole('navigation', { name: 'Tabs' });
    expect(within(tabs).getAllByRole('link').map((a) => a.textContent)).toEqual(['Today', 'LeetCode', 'Projects', 'Apps', 'Jobs', 'Outreach']);
    expect(await screen.findAllByRole('link', { name: 'Settings (a sync is stale)' })).not.toHaveLength(0);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('main')).toHaveTextContent('home');
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest run src/ui`
Expected: FAIL with `Failed to resolve import "./SignIn"` / `"./AppShell"`.

- [ ] **Step 3: Write the primitives**

`web/src/ui/primitives.tsx`:
```tsx
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react';
import type { Difficulty } from '../data/types';
import { safeHref } from '../lib/url';

type Variant = 'primary' | 'ghost' | 'quiet' | 'danger';

export function Button({ variant = 'ghost', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type="button" className={`btn btn-${variant} ${className}`.trim()} {...props} />;
}

export function Card({ className = '', children, ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={`card ${className}`.trim()} {...props}>{children}</section>;
}

export function CardHead({ title, id, children }: { title: ReactNode; id: string; children?: ReactNode }) {
  return (
    <div className="card-head">
      <h2 id={id}>{title}</h2>
      {children}
    </div>
  );
}

export function Chip({ pressed, onToggle, children }: { pressed: boolean; onToggle: () => void; children: ReactNode }) {
  return <button type="button" className="chip" aria-pressed={pressed} onClick={onToggle}>{children}</button>;
}

export function Badge({ tone = 'muted', children }: { tone?: 'accent' | 'warn' | 'danger' | 'muted'; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function DifficultyTag({ d }: { d: Difficulty }) {
  return <span className={`diff diff-${d.toLowerCase()}`}>{d}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function Skeleton({ label = 'Loading' }: { label?: string }) {
  return <div className="skeleton" role="status" aria-label={label} />;
}

export function LoadError({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <p role="alert" className="error">
      Couldn't load {what}. <Button variant="quiet" onClick={onRetry}>Retry</Button>
    </p>
  );
}

export function Disclosure({ summary, open, children }: { summary: ReactNode; open?: boolean; children: ReactNode }) {
  return (
    <details className="disclosure" open={open}>
      <summary>{summary}</summary>
      <div className="disclosure-body">{children}</div>
    </details>
  );
}

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt('Copy this:', text);
    }
  };
  return (
    <Button variant="quiet" onClick={copy}>
      <span aria-live="polite">{copied ? 'Copied' : label}</span>
    </Button>
  );
}

export function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <Button aria-label={`Fewer: ${label}`} disabled={value <= min} onClick={() => onChange(value - 1)}>−</Button>
      <output aria-live="polite">{value}</output>
      <Button aria-label={`More: ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)}>+</Button>
    </div>
  );
}

export function ExternalLink({ href, children, className, onClick }: { href: string | null | undefined; children: ReactNode; className?: string; onClick?: () => void }) {
  const safe = safeHref(href);
  if (!safe) return <span className={className}>{children}</span>;
  return <a className={className} href={safe} target="_blank" rel="noopener noreferrer" onClick={onClick}>{children}</a>;
}
```

- [ ] **Step 4: Write sign-in and the shell**

`web/src/ui/SignIn.tsx`:
```tsx
import { useState } from 'react';
import type { AuthApi } from '../data/auth';
import { Button } from './primitives';

export function SignIn({ auth }: { auth: AuthApi }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="signin">
      <h1>Lock In</h1>
      {!sent ? (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); void run(async () => { await auth.sendLink(email.trim()); setSent(true); }); }}>
          <label className="field">
            <span>Email</span>
            <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <Button type="submit" variant="primary" disabled={busy}>Send sign-in email</Button>
        </form>
      ) : (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); void run(() => auth.verifyCode(email.trim(), code.trim())); }}>
          <p className="muted">Tap the link in the email, or enter its code.</p>
          <label className="field">
            <span>Code</span>
            <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" required value={code} onChange={(e) => setCode(e.target.value)} />
          </label>
          <Button type="submit" variant="primary" disabled={busy}>Sign in</Button>
          <Button variant="quiet" onClick={() => { setSent(false); setCode(''); }}>Use another email</Button>
        </form>
      )}
      {error && <p role="alert" className="error">{error}</p>}
    </main>
  );
}
```

`web/src/ui/AppShell.tsx`:
```tsx
import { useQueryClient } from '@tanstack/react-query';
import { Briefcase, Code, FolderGit2, ListChecks, Mail, RefreshCw, Settings, Sun } from 'lucide-react';
import { NavLink, Outlet } from 'react-router';
import { useNow, useSyncOnOpen, useSyncStatus } from '../data/hooks';
import { anyStale } from '../lib/sync';

const TABS = [
  { to: '/', label: 'Today', Icon: Sun, end: true },
  { to: '/leetcode', label: 'LeetCode', Icon: Code, end: false },
  { to: '/projects', label: 'Projects', Icon: FolderGit2, end: false },
  { to: '/apps', label: 'Apps', Icon: ListChecks, end: false },
  { to: '/jobs', label: 'Jobs', Icon: Briefcase, end: false },
  { to: '/outreach', label: 'Outreach', Icon: Mail, end: false },
];

export function AppShell() {
  const now = useNow();
  const sync = useSyncOnOpen();
  const qc = useQueryClient();
  const status = useSyncStatus();
  const stale = anyStale(status.data ?? [], now);
  const settingsLabel = stale ? 'Settings (a sync is stale)' : 'Settings';
  const refresh = () => sync.mutate(undefined, { onSettled: () => void qc.invalidateQueries() });
  const spin = sync.isPending ? 'spin' : undefined;

  return (
    <div className="shell">
      <a className="skip-link" href="#main">Skip to content</a>
      <nav className="sidebar" aria-label="Main">
        <div className="brand">Lock In</div>
        {TABS.map(({ to, label, Icon, end }) => (
          <NavLink key={to} to={to} end={end} className="nav-link"><Icon size={20} aria-hidden />{label}</NavLink>
        ))}
        <div className="spacer" />
        <button type="button" className="nav-link" onClick={refresh} disabled={sync.isPending}>
          <RefreshCw size={20} aria-hidden className={spin} />Refresh
        </button>
        <NavLink to="/settings" className="nav-link" aria-label={settingsLabel}>
          <Settings size={20} aria-hidden />Settings{stale && <span className="dot" aria-hidden />}
        </NavLink>
      </nav>
      <header className="topbar">
        <button type="button" className="icon-btn" onClick={refresh} disabled={sync.isPending} aria-label="Refresh">
          <RefreshCw size={20} aria-hidden className={spin} />
        </button>
        <NavLink to="/settings" className="icon-btn" aria-label={settingsLabel}>
          <Settings size={20} aria-hidden />{stale && <span className="dot dot-corner" aria-hidden />}
        </NavLink>
      </header>
      <main id="main" className="main" tabIndex={-1}>
        <Outlet />
      </main>
      <nav className="bottom-nav" aria-label="Tabs">
        {TABS.map(({ to, label, Icon, end }) => (
          <NavLink key={to} to={to} end={end} className="nav-link"><Icon size={22} aria-hidden />{label}</NavLink>
        ))}
      </nav>
    </div>
  );
}
```

`web/src/App.tsx`:
```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import type { DataApi } from './data/api';
import type { AuthApi } from './data/auth';
import { DataProvider } from './data/context';
import Applications from './screens/Applications';
import Jobs from './screens/Jobs';
import LeetCode from './screens/LeetCode';
import Outreach from './screens/Outreach';
import Projects from './screens/Projects';
import SettingsScreen from './screens/Settings';
import Today from './screens/Today';
import { AppShell } from './ui/AppShell';
import { SignIn } from './ui/SignIn';

function AuthGate({ auth, children }: { auth: AuthApi; children: ReactNode }) {
  const [state, setState] = useState<'loading' | 'in' | 'out'>('loading');
  useEffect(() => {
    let alive = true;
    void auth.hasSession().then((ok) => alive && setState(ok ? 'in' : 'out'));
    const off = auth.onChange((ok) => setState(ok ? 'in' : 'out'));
    return () => { alive = false; off(); };
  }, [auth]);
  if (state === 'loading') return <div className="boot" role="status" aria-label="Loading" />;
  if (state === 'out') return <SignIn auth={auth} />;
  return <>{children}</>;
}

export default function App({ api, auth }: { api: DataApi; auth: AuthApi }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } }));
  return (
    <DataProvider api={api} auth={auth}>
      <AuthGate auth={auth}>
        <QueryClientProvider client={qc}>
          <BrowserRouter>
            <Routes>
              <Route element={<AppShell />}>
                <Route index element={<Today />} />
                <Route path="leetcode" element={<LeetCode />} />
                <Route path="projects" element={<Projects />} />
                <Route path="apps" element={<Applications />} />
                <Route path="jobs" element={<Jobs />} />
                <Route path="outreach" element={<Outreach />} />
                <Route path="settings" element={<SettingsScreen />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </QueryClientProvider>
      </AuthGate>
    </DataProvider>
  );
}
```

`web/src/main.tsx` (replaces the temporary file):
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import type { DataApi } from './data/api';
import type { AuthApi } from './data/auth';
import './styles/tokens.css';
import './styles/app.css';

async function boot() {
  const root = createRoot(document.getElementById('root')!);
  try {
    let api: DataApi;
    let auth: AuthApi;
    if (import.meta.env.VITE_DEMO === '1') {
      const demo = await import('./data/demo');
      api = demo.createDemoApi();
      auth = demo.demoAuth;
    } else {
      const [{ createSupabase, createSupabaseApi }, { supabaseAuth }] = await Promise.all([import('./data/supabase'), import('./data/auth')]);
      const sb = createSupabase();
      api = createSupabaseApi(sb);
      auth = supabaseAuth(sb);
    }
    root.render(<StrictMode><App api={api} auth={auth} /></StrictMode>);
  } catch (e) {
    root.render(<p role="alert" className="error boot-error">{e instanceof Error ? e.message : String(e)}</p>);
  }
}

void boot();
```

Starter screens (each replaced wholesale by its own task). Create all seven with this exact shape, changing only the function name and heading (`Today`→"Today", `LeetCode`→"LeetCode", `Projects`→"Projects", `Applications`→"Applications", `Jobs`→"Jobs", `Outreach`→"Outreach", `Settings`→"Settings"):
```tsx
export default function Jobs() {
  return (
    <div className="screen">
      <h1>Jobs</h1>
    </div>
  );
}
```

- [ ] **Step 5: Write `app.css`**

`web/src/styles/app.css`:
```css
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.45 var(--font); -webkit-font-smoothing: antialiased; }
h1, h2, h3, p, ol, ul { margin: 0; }
ol, ul { padding: 0; list-style: none; }
h1 { font-size: 1.6rem; line-height: 1.2; letter-spacing: -0.01em; }
h2 { font-size: 1.05rem; font-weight: 650; }
a { color: inherit; }
button, input, select, textarea { font: inherit; color: inherit; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 6px; }
.sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.muted { color: var(--muted); }
.small { font-size: 0.85rem; }
.error { color: var(--danger); }
.empty { color: var(--muted); padding: 8px 0; }
.stack { display: grid; gap: var(--gap); }

/* Shell */
.skip-link { position: absolute; left: 8px; top: -80px; z-index: 50; display: inline-flex; align-items: center; min-height: var(--tap); padding: 0 16px; border-radius: var(--radius-sm); background: var(--accent); color: var(--accent-ink); }
.skip-link:focus { top: 8px; }
.main { display: block; max-width: 760px; margin: 0 auto; padding: 8px 16px calc(var(--nav-h) + 24px + env(safe-area-inset-bottom)); outline: none; }
.topbar { display: flex; justify-content: flex-end; gap: 4px; padding: calc(4px + env(safe-area-inset-top)) 8px 0; }
.sidebar { display: none; }
.bottom-nav { position: fixed; inset: auto 0 0 0; z-index: 20; display: grid; grid-template-columns: repeat(6, 1fr); background: var(--surface); border-top: 1px solid var(--border); padding-bottom: env(safe-area-inset-bottom); }
.nav-link { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; min-height: var(--nav-h); border: 0; background: none; color: var(--muted); font-size: 0.72rem; text-decoration: none; cursor: pointer; }
.nav-link[aria-current="page"] { color: var(--accent); }
.icon-btn { position: relative; display: inline-flex; align-items: center; justify-content: center; width: var(--tap); height: var(--tap); border: 0; border-radius: 50%; background: none; color: var(--muted); cursor: pointer; }
.icon-btn[aria-current="page"] { color: var(--accent); }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--warn); margin-left: 6px; }
.dot-corner { position: absolute; top: 9px; right: 9px; margin: 0; }
.boot { min-height: 100dvh; }
.boot-error { padding: 24px 16px; }
@media (min-width: 900px) {
  .shell { display: grid; grid-template-columns: 220px minmax(0, 1fr); }
  .topbar, .bottom-nav { display: none; }
  .sidebar { position: sticky; top: 0; display: flex; flex-direction: column; gap: 2px; height: 100dvh; padding: 20px 12px; background: var(--surface); border-right: 1px solid var(--border); }
  .brand { padding: 4px 12px 16px; font-weight: 700; letter-spacing: -0.01em; }
  .sidebar .nav-link { flex-direction: row; justify-content: flex-start; gap: 10px; min-height: var(--tap); padding: 0 12px; border-radius: var(--radius-sm); font-size: 0.95rem; }
  .sidebar .nav-link[aria-current="page"] { background: var(--accent-soft); }
  .spacer { flex: 1; }
  .main { padding: 32px 32px 48px; }
}
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spin { animation: none; } }

/* Screen + cards */
.screen { display: grid; gap: 16px; }
.screen-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 8px 12px; }
.card { display: grid; gap: var(--gap); padding: 16px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); min-width: 0; }
.card-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: var(--tap); }
.count { color: var(--muted); font-variant-numeric: tabular-nums; }
.row-actions { display: flex; flex-wrap: wrap; gap: 8px; }

/* Controls */
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: var(--tap); min-width: var(--tap); padding: 0 14px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-2); cursor: pointer; text-decoration: none; white-space: nowrap; }
.btn:disabled { opacity: 0.55; cursor: default; }
.btn-primary { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); font-weight: 650; }
.btn-quiet { background: none; border-color: transparent; color: var(--accent); }
.btn-danger { color: var(--danger); }
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chip { min-height: var(--tap); padding: 0 14px; border: 1px solid var(--border); border-radius: 999px; background: none; color: var(--muted); cursor: pointer; }
.chip[aria-pressed="true"] { background: var(--accent-soft); border-color: var(--accent); color: var(--text); }
.badge { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 999px; font-size: 0.75rem; font-weight: 600; white-space: nowrap; }
.badge-accent { background: var(--accent-soft); color: var(--accent); }
.badge-warn { color: var(--warn); border: 1px solid currentColor; }
.badge-danger { color: var(--danger); border: 1px solid currentColor; }
.badge-muted { color: var(--muted); border: 1px solid var(--border); }
.diff { font-size: 0.8rem; font-weight: 600; }
.diff-easy { color: var(--easy); }
.diff-medium { color: var(--medium); }
.diff-hard { color: var(--hard); }
.field { display: grid; gap: 6px; }
.field > span { font-size: 0.85rem; color: var(--muted); }
input:not([type="checkbox"]), select { min-height: var(--tap); width: 100%; padding: 0 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-2); }
.inline-form { display: flex; gap: 8px; }
.inline-form input { flex: 1; min-width: 0; }
.stepper { display: inline-flex; align-items: center; gap: 8px; }
.stepper output { min-width: 2ch; text-align: center; font-variant-numeric: tabular-nums; font-weight: 650; }
.disclosure > summary { display: flex; align-items: center; min-height: var(--tap); cursor: pointer; color: var(--muted); }
.disclosure-body { display: grid; gap: var(--gap); padding-top: 4px; }
.skeleton { height: 120px; border-radius: var(--radius-sm); background: var(--surface-2); }
.signin { display: grid; gap: 20px; max-width: 360px; margin: 18vh auto 0; padding: 0 16px; }

/* Today */
.streaks { display: flex; flex-wrap: wrap; gap: 8px; }
.streak { display: inline-flex; gap: 6px; align-items: baseline; padding: 4px 10px; border: 1px solid var(--border); border-radius: 999px; color: var(--muted); font-size: 0.85rem; }
.streak b { color: var(--text); font-variant-numeric: tabular-nums; }
.set-list { display: grid; }
.set-row { display: grid; gap: 8px; padding: 4px 0; border-top: 1px solid var(--border); }
.set-row:first-child { border-top: 0; }
.set-link { display: grid; grid-template-columns: 28px 1fr; align-items: center; gap: 8px; min-height: 52px; text-decoration: none; }
.check { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border: 2px solid var(--border); border-radius: 50%; color: var(--accent-ink); }
.is-done .check { background: var(--accent); border-color: var(--accent); }
.is-done .set-title { color: var(--muted); }
.set-main { display: grid; min-width: 0; }
.set-title { overflow-wrap: anywhere; }
.set-meta { display: flex; flex-wrap: wrap; gap: 8px; font-size: 0.8rem; color: var(--muted); }
.rate { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; padding-left: 36px; }
.rate .btn { padding: 0 6px; font-size: 0.85rem; }
.idea-toggle { display: flex; align-items: center; gap: 12px; min-height: var(--tap); cursor: pointer; }
.idea-toggle input { width: 22px; height: 22px; accent-color: var(--accent); }
.row-link { display: flex; align-items: center; justify-content: space-between; min-height: 52px; padding: 0 16px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); text-decoration: none; }
.links { display: grid; gap: 8px; }

/* LeetCode */
.roadmap { display: grid; gap: 10px; }
.tier { display: flex; flex-wrap: wrap; gap: 8px; }
.topic { display: inline-flex; align-items: center; gap: 6px; min-height: var(--tap); padding: 0 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: none; cursor: pointer; text-align: left; }
.lvl-locked { color: var(--muted); border-style: dashed; }
.lvl-available { color: var(--text); }
.lvl-learning { background: var(--accent-soft); }
.lvl-practicing { background: var(--accent-soft); border-color: var(--accent); }
.lvl-solid { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
.lvl-mastered { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); font-weight: 700; }
.legend { display: flex; flex-wrap: wrap; gap: 6px 12px; font-size: 0.8rem; color: var(--muted); }
.legend .topic { min-height: 0; padding: 0 8px; cursor: default; }
.heat { display: grid; grid-auto-flow: column; grid-template-columns: repeat(26, minmax(0, 1fr)); grid-template-rows: repeat(7, auto); gap: 2px; }
.heat span { aspect-ratio: 1; border-radius: 2px; background: var(--surface-2); }
.heat .h1 { background: color-mix(in srgb, var(--accent) 30%, var(--surface-2)); }
.heat .h2 { background: color-mix(in srgb, var(--accent) 55%, var(--surface-2)); }
.heat .h3 { background: color-mix(in srgb, var(--accent) 80%, var(--surface-2)); }
.heat .h4 { background: var(--accent); }
.heat .future { visibility: hidden; }
.list { display: grid; }
.list-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 48px; border-top: 1px solid var(--border); }
.list-row:first-child { border-top: 0; }
.list-row a { min-height: var(--tap); display: inline-flex; align-items: center; }

/* Projects */
.strip { display: grid; grid-template-columns: repeat(30, 1fr); gap: 2px; }
.strip span { height: 14px; border-radius: 2px; background: var(--surface-2); }
.strip .on { background: var(--accent); }
.idea-row { display: flex; align-items: center; gap: 4px; min-height: 48px; border-top: 1px solid var(--border); }
.idea-row:first-child { border-top: 0; }
.idea-text { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.idea-row .btn { padding: 0; }
.seg { display: inline-flex; border: 1px solid var(--border); border-radius: var(--radius-sm); overflow: hidden; }
.seg .btn { border: 0; border-radius: 0; background: none; }
.seg .btn[aria-pressed="true"] { background: var(--accent-soft); color: var(--text); }

/* Applications */
.big-num { display: flex; align-items: baseline; gap: 8px; }
.big-num b { font-size: 2.6rem; line-height: 1; font-variant-numeric: tabular-nums; }
.bar { height: 8px; border-radius: 999px; background: var(--surface-2); overflow: hidden; }
.bar > span { display: block; height: 100%; background: var(--accent); }
.funnel { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
.funnel th, .funnel td { padding: 8px 4px; text-align: right; border-top: 1px solid var(--border); }
.funnel th:first-child { text-align: left; font-weight: 500; }
.funnel thead th { border-top: 0; color: var(--muted); font-size: 0.8rem; font-weight: 500; }
.app-row { display: grid; gap: 2px; padding: 10px 0; border-top: 1px solid var(--border); }

/* Jobs + Outreach */
.job { display: grid; gap: 8px; padding: 12px 0; border-top: 1px solid var(--border); }
.job:first-child { border-top: 0; }
.job-title { font-weight: 600; overflow-wrap: anywhere; }
.contact { display: grid; gap: 6px; padding: 12px 0; border-top: 1px solid var(--border); }
.contact-name { font-weight: 650; }
.email { font-family: var(--mono); font-size: 0.9rem; overflow-wrap: anywhere; }
.draft-body { margin: 0; white-space: pre-wrap; font: inherit; overflow-wrap: anywhere; }

/* Settings */
.sync-row { display: grid; grid-template-columns: 1fr auto; gap: 4px 12px; align-items: center; padding: 10px 0; border-top: 1px solid var(--border); }
.sync-row:first-child { border-top: 0; }
.sync-row .error { grid-column: 1 / -1; }
.rules { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
.rules td { padding: 6px 4px; border-top: 1px solid var(--border); vertical-align: top; }
.rules code { font-family: var(--mono); overflow-wrap: anywhere; }
.times { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.check-row { display: flex; align-items: center; gap: 12px; min-height: var(--tap); }
.check-row input { width: 22px; height: 22px; accent-color: var(--accent); }
```

- [ ] **Step 6: Run the tests, typecheck, lint, build, and look at it**

Run: `npx vitest run && npm run typecheck && npm run lint && npm run build`
Expected: all tests pass (lib, data, ui); tsc/eslint clean; build succeeds.
Then `npm run dev:demo`, open http://localhost:5199 at a phone-sized window: six tabs at the bottom, refresh and gear (with an amber dot, because the demo Sheet sync is 3 h old) at the top, and each tab shows its heading. Stop the server.

- [ ] **Step 7: Commit**

```bash
git add web/src/App.tsx web/src/main.tsx web/src/ui web/src/styles/app.css web/src/screens
git commit -m "Add app shell with sign-in, navigation and UI primitives"
```

---

### Task 5: `sync-leetcode` Vercel function

**Files:**
- Create: `web/api/sync-leetcode.ts`, `web/tests/api/sync-leetcode.test.ts`

**Interfaces:**
- Consumes: nothing from the web app (it's a separate serverless bundle); the client side (`DataApi.syncLeetCode`, `useSyncOnOpen`) already exists from Task 3.
- Produces (all exported from `web/api/sync-leetcode.ts`):
  - `LC_GRAPHQL`, `RECENT_QUERY`, `MIN_GAP_MS = 60_000`, `STATE_KEY = 'web_sync'`
  - `FetchedSolve {slug, title, accepted_at}`, `ExistingSolve {slug, accepted_at}`, `ServerSyncResult = {status:'ok'; added:number} | {status:'skipped'}`
  - `LeetCodeError`
  - `parseRecent(body: unknown): FetchedSolve[]`
  - `newSolves(fetched, existing): FetchedSolve[]`
  - `shouldSkip(lastIso: string | null, now: Date): boolean`
  - `fetchRecent(username, fetchImpl?): Promise<FetchedSolve[]>`
  - `SyncStore { lastSyncAt(); markSync(at); username(); existingSince(iso); insert(rows) }`, `supabaseStore(sb): SyncStore`
  - `runSync(store, now, fetchImpl?): Promise<ServerSyncResult>`
  - `bearer(header): string | null`
  - `default handler(req: VercelRequest, res: VercelResponse)` → 405 non-POST, 401 no/invalid token, 500 missing env, 502 LeetCode failure, 200 result
- Request contract: `POST /api/sync-leetcode` with `Authorization: Bearer <supabase access token>`, no body. Env on Vercel: `SUPABASE_URL`, `SUPABASE_ANON_KEY`.

Rate limit: the function stores `{at: <ISO>}` in `worker_state` key `web_sync` (owned by Adam via RLS) **before** calling LeetCode, and returns `{status:'skipped'}` if the previous call was under 60 s ago. Writing first means a failing LeetCode is also rate-limited.

The test lives in `web/tests/api/`, not `web/api/`: Vercel turns every file under `api/` into a function, including test files.

- [ ] **Step 1: Write the failing tests**

`web/tests/api/sync-leetcode.test.ts`:
```ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { describe, expect, it, vi } from 'vitest';
import handler, {
  LC_GRAPHQL, LeetCodeError, bearer, newSolves, parseRecent, runSync, shouldSkip, type ExistingSolve, type FetchedSolve, type SyncStore,
} from '../../api/sync-leetcode';

const BODY = {
  data: {
    recentAcSubmissionList: [
      { title: 'Daily Temperatures', titleSlug: 'daily-temperatures', timestamp: '1791933317' },
      { title: 'Two Sum', titleSlug: 'two-sum', timestamp: '1791830000' },
      { title: 'Broken', titleSlug: 'broken', timestamp: 'not-a-number' },
    ],
  },
};

describe('parseRecent', () => {
  it('maps to ISO UTC and skips malformed rows', () => {
    expect(parseRecent(BODY)).toEqual([
      { slug: 'daily-temperatures', title: 'Daily Temperatures', accepted_at: new Date(1791933317 * 1000).toISOString() },
      { slug: 'two-sum', title: 'Two Sum', accepted_at: new Date(1791830000 * 1000).toISOString() },
    ]);
  });
  it('null list (no submissions) is empty', () => {
    expect(parseRecent({ data: { recentAcSubmissionList: null } })).toEqual([]);
  });
  it('GraphQL errors and junk throw LeetCodeError', () => {
    expect(() => parseRecent({ errors: [{ message: 'rate limited' }] })).toThrow(LeetCodeError);
    expect(() => parseRecent(null)).toThrow(LeetCodeError);
    expect(() => parseRecent({ data: { recentAcSubmissionList: 'x' } })).toThrow('unexpected LeetCode response');
  });
});

describe('newSolves', () => {
  it('dedupes against existing rows written by the worker in a different ISO format', () => {
    const fetched: FetchedSolve[] = [
      { slug: 'two-sum', title: 'Two Sum', accepted_at: '2026-10-14T13:00:00.000Z' },
      { slug: 'two-sum', title: 'Two Sum', accepted_at: '2026-10-14T15:00:00.000Z' },
      { slug: 'two-sum', title: 'Two Sum', accepted_at: '2026-10-14T15:00:00.000Z' },
    ];
    const existing = [{ slug: 'two-sum', accepted_at: '2026-10-14T13:00:00+00:00' }];
    expect(newSolves(fetched, existing).map((s) => s.accepted_at)).toEqual(['2026-10-14T15:00:00.000Z']);
  });
});

describe('shouldSkip', () => {
  const now = new Date('2026-10-14T16:00:00Z');
  it('skips within 60 s of the last call', () => {
    expect(shouldSkip(null, now)).toBe(false);
    expect(shouldSkip('2026-10-14T15:59:30Z', now)).toBe(true);
    expect(shouldSkip('2026-10-14T15:58:59Z', now)).toBe(false);
  });
});

function memoryStore(last: string | null = null, existing: ExistingSolve[] = []) {
  const state = { last, inserted: [] as FetchedSolve[], marks: [] as string[] };
  const store: SyncStore = {
    lastSyncAt: async () => state.last,
    markSync: async (at) => { state.marks.push(at); state.last = at; },
    username: async () => 'adamkuhn',
    existingSince: async () => existing,
    insert: async (rows) => { state.inserted.push(...rows); },
  };
  return { state, store };
}
const lcFetch = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

describe('runSync', () => {
  const now = new Date('2026-10-14T16:00:00Z');
  it('marks, fetches with the right request, inserts only new rows', async () => {
    const m = memoryStore(null, [{ slug: 'two-sum', accepted_at: new Date(1791830000 * 1000).toISOString() }]);
    const f = lcFetch(BODY);
    expect(await runSync(m.store, now, f as unknown as typeof fetch)).toEqual({ status: 'ok', added: 1 });
    expect(m.state.inserted.map((r) => r.slug)).toEqual(['daily-temperatures']);
    expect(m.state.marks).toEqual([now.toISOString()]);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(LC_GRAPHQL);
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json', Referer: 'https://leetcode.com' });
    expect(JSON.parse(String(init.body)).variables).toEqual({ u: 'adamkuhn' });
  });
  it('a second call within a minute does not hit LeetCode', async () => {
    const m = memoryStore('2026-10-14T15:59:40Z');
    const f = lcFetch(BODY);
    expect(await runSync(m.store, now, f as unknown as typeof fetch)).toEqual({ status: 'skipped' });
    expect(f).not.toHaveBeenCalled();
  });
  it('LeetCode down: throws LeetCodeError, but the attempt is still recorded', async () => {
    const m = memoryStore();
    await expect(runSync(m.store, now, lcFetch({}, 503) as unknown as typeof fetch)).rejects.toThrow('LeetCode HTTP 503');
    expect(m.state.marks).toHaveLength(1);
  });
  it('nothing new: no insert call', async () => {
    const m = memoryStore(null, BODY.data.recentAcSubmissionList.slice(0, 2).map((r) => ({ slug: r.titleSlug, accepted_at: new Date(Number(r.timestamp) * 1000).toISOString() })));
    expect(await runSync(m.store, now, lcFetch(BODY) as unknown as typeof fetch)).toEqual({ status: 'ok', added: 0 });
    expect(m.state.inserted).toEqual([]);
  });
});

describe('handler', () => {
  class FakeRes {
    code = 0;
    body: unknown = undefined;
    headers: Record<string, string> = {};
    status(c: number): this { this.code = c; return this; }
    json(b: unknown): this { this.body = b; return this; }
    setHeader(k: string, v: string): this { this.headers[k] = v; return this; }
  }
  it('bearer parsing', () => {
    expect(bearer('Bearer abc.def')).toBe('abc.def');
    expect(bearer('bearer  xyz ')).toBe('xyz');
    expect(bearer('Basic abc')).toBeNull();
    expect(bearer(undefined)).toBeNull();
  });
  it('405 for GET, 401 without a token', async () => {
    const get = new FakeRes();
    await handler({ method: 'GET', headers: {} } as VercelRequest, get as unknown as VercelResponse);
    expect([get.code, get.headers.Allow]).toEqual([405, 'POST']);
    const anon = new FakeRes();
    await handler({ method: 'POST', headers: {} } as VercelRequest, anon as unknown as VercelResponse);
    expect(anon.code).toBe(401);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest run tests/api`
Expected: FAIL with `Failed to resolve import "../../api/sync-leetcode"`.

- [ ] **Step 3: Implement the function**

`web/api/sync-leetcode.ts`:
```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

export const LC_GRAPHQL = 'https://leetcode.com/graphql';
export const RECENT_QUERY = 'query($u:String!){recentAcSubmissionList(username:$u,limit:20){title titleSlug timestamp}}';
export const MIN_GAP_MS = 60_000;
export const STATE_KEY = 'web_sync';

export interface FetchedSolve { slug: string; title: string; accepted_at: string }
export interface ExistingSolve { slug: string; accepted_at: string }
export type ServerSyncResult = { status: 'ok'; added: number } | { status: 'skipped' };

export class LeetCodeError extends Error {}

export function parseRecent(body: unknown): FetchedSolve[] {
  if (!body || typeof body !== 'object') throw new LeetCodeError('LeetCode returned no JSON');
  const b = body as { data?: { recentAcSubmissionList?: unknown }; errors?: unknown };
  if (b.errors) throw new LeetCodeError(`LeetCode GraphQL error: ${JSON.stringify(b.errors).slice(0, 200)}`);
  const list = b.data?.recentAcSubmissionList;
  if (list === null) return [];
  if (!Array.isArray(list)) throw new LeetCodeError('unexpected LeetCode response shape');
  return list.flatMap((row: unknown) => {
    const r = row as Record<string, unknown>;
    const ts = Number(r.timestamp);
    if (typeof r.titleSlug !== 'string' || typeof r.title !== 'string' || !Number.isFinite(ts)) return [];
    return [{ slug: r.titleSlug, title: r.title, accepted_at: new Date(ts * 1000).toISOString() }];
  });
}

const key = (slug: string, iso: string) => `${slug}|${Date.parse(iso)}`;

export function newSolves(fetched: FetchedSolve[], existing: ExistingSolve[]): FetchedSolve[] {
  const seen = new Set(existing.map((e) => key(e.slug, e.accepted_at)));
  return fetched.filter((s) => {
    const k = key(s.slug, s.accepted_at);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function shouldSkip(lastIso: string | null, now: Date): boolean {
  return lastIso !== null && now.getTime() - Date.parse(lastIso) < MIN_GAP_MS;
}

export async function fetchRecent(username: string, fetchImpl: typeof fetch = fetch): Promise<FetchedSolve[]> {
  const res = await fetchImpl(LC_GRAPHQL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Referer: 'https://leetcode.com' },
    body: JSON.stringify({ query: RECENT_QUERY, variables: { u: username } }),
  });
  if (!res.ok) throw new LeetCodeError(`LeetCode HTTP ${res.status}`);
  return parseRecent(await res.json().catch(() => null));
}

export interface SyncStore {
  lastSyncAt(): Promise<string | null>;
  markSync(at: string): Promise<void>;
  username(): Promise<string>;
  existingSince(iso: string): Promise<ExistingSolve[]>;
  insert(rows: FetchedSolve[]): Promise<void>;
}

export async function runSync(store: SyncStore, now: Date, fetchImpl: typeof fetch = fetch): Promise<ServerSyncResult> {
  if (shouldSkip(await store.lastSyncAt(), now)) return { status: 'skipped' };
  await store.markSync(now.toISOString());
  const fetched = await fetchRecent(await store.username(), fetchImpl);
  if (!fetched.length) return { status: 'ok', added: 0 };
  const oldest = fetched.reduce((m, s) => (Date.parse(s.accepted_at) < Date.parse(m) ? s.accepted_at : m), fetched[0].accepted_at);
  const fresh = newSolves(fetched, await store.existingSince(oldest));
  if (fresh.length) await store.insert(fresh);
  return { status: 'ok', added: fresh.length };
}

function check(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

export function supabaseStore(sb: SupabaseClient): SyncStore {
  return {
    async lastSyncAt() {
      const { data, error } = await sb.from('worker_state').select('value').eq('key', STATE_KEY).maybeSingle();
      check(error);
      return ((data?.value ?? null) as { at?: string } | null)?.at ?? null;
    },
    async markSync(at) {
      const { error } = await sb.from('worker_state').upsert({ key: STATE_KEY, value: { at } }, { onConflict: 'owner,key' });
      check(error);
    },
    async username() {
      const { data, error } = await sb.from('settings').select('lc_username').limit(1).maybeSingle();
      check(error);
      return (data?.lc_username as string | undefined) || 'adamkuhn';
    },
    async existingSince(iso) {
      const { data, error } = await sb.from('lc_solves').select('slug,accepted_at').gte('accepted_at', iso);
      check(error);
      return (data ?? []) as ExistingSolve[];
    },
    async insert(rows) {
      // ignoreDuplicates → ON CONFLICT DO NOTHING, so a race with the worker's 30-min sync is harmless.
      const { error } = await sb.from('lc_solves')
        .upsert(rows.map((r) => ({ ...r, rating: null })), { onConflict: 'owner,slug,accepted_at', ignoreDuplicates: true });
      check(error);
    },
  };
}

export function bearer(header: string | string[] | undefined): string | null {
  const h = Array.isArray(header) ? header[0] : header;
  const m = /^Bearer\s+(.+)$/i.exec(h ?? '');
  return m ? m[1].trim() : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'POST only' });
  }
  const token = bearer(req.headers.authorization);
  if (!token) return res.status(401).json({ error: 'Missing bearer token' });
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) return res.status(500).json({ error: 'Server is missing SUPABASE_URL / SUPABASE_ANON_KEY' });
  const sb = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data.user) return res.status(401).json({ error: 'Invalid or expired session' });
  try {
    return res.status(200).json(await runSync(supabaseStore(sb), new Date()));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(e instanceof LeetCodeError ? 502 : 500).json({ error: msg.slice(0, 300) });
  }
}
```
Note: `parseRecent(null)` throws before reading `.errors` because of the first guard; `res.json().catch(() => null)` therefore turns non-JSON LeetCode responses into a `LeetCodeError` (502), not a crash.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run tests/api && npm run typecheck && npm run lint`
Expected: 11 passed; tsc and eslint clean.

- [ ] **Step 5: Commit**

```bash
git add web/api/sync-leetcode.ts web/tests/api/sync-leetcode.test.ts
git commit -m "Add sync-leetcode Vercel function with JWT auth and 60s rate limit"
```

---
### Task 6: Today screen

**Files:**
- Modify: `web/src/screens/Today.tsx` (replace the starter)
- Create: `web/src/screens/Today.test.tsx`

**Interfaces:**
- Consumes: hooks `useNow, useSettings, useDailySet, useSolves, useProblemMap, useCommits, useApplications, useIdeas, useProjects, usePostings, useOutreach, useRateSolve, useUpdateIdea, useSwapIdea` (Task 3); `buildTodayItems, RATINGS, TodayItem, streaks, dayNumber, todaysIdea, swapCandidate, followUpsDue, planDay, localDay` (Task 2); primitives (Task 4)
- Produces: default export `Today` (route `/`). Primary element: the LeetCode set card.

Layout (phone and desktop): `Day N` heading with three streak chips → **LeetCode set card** (primary: title = focus topic or "Mixed day", `done/total`, ordered rows; each row links to LeetCode; a solved, unrated row shows the three rating buttons) → today's project idea card (Done checkbox, Swap) → "Follow-ups due" and "New postings" rows, each hidden at zero.

- [ ] **Step 1: Write the failing tests**

`web/src/screens/Today.test.tsx`:
```tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createDemoApi } from '../data/demo';
import { renderWithData } from '../test/render';
import Today from './Today';

describe('Today', () => {
  it('leads with the day and the LeetCode set', async () => {
    const { container } = renderWithData(<Today />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Day 12' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 2, name: 'Sliding Window' })).toBeInTheDocument();
    expect(await screen.findAllByRole('listitem', {}, { timeout: 2000 })).not.toHaveLength(0);
    expect(container.querySelector('[data-primary]')).toHaveTextContent('Sliding Window');
    expect(container.querySelector('.count')).toHaveTextContent('2/6');
  });
  it('hides the mystery topic', async () => {
    renderWithData(<Today />);
    const row = await screen.findByRole('link', { name: /Daily Temperatures/ });
    expect(row).toHaveTextContent('Mystery');
    expect(row).not.toHaveTextContent('Stack');
  });
  it('one tap rates a fresh solve and the buttons go away', async () => {
    const api = createDemoApi();
    const spy = vi.spyOn(api, 'rateSolve');
    renderWithData(<Today />, { api });
    const group = await screen.findByRole('group', { name: 'How did Best Time to Buy and Sell Stock go?' });
    await userEvent.click(within(group).getByRole('button', { name: 'Nailed it' }));
    expect(spy).toHaveBeenCalledWith(expect.any(Number), 'nailed', expect.any(Date));
    await waitFor(() => expect(screen.queryByRole('group', { name: /How did/ })).toBeNull());
  });
  it("shows today's idea and marks it done", async () => {
    const api = createDemoApi();
    const spy = vi.spyOn(api, 'updateIdea');
    renderWithData(<Today />, { api });
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Add Chicago to the city picker' }));
    expect(spy).toHaveBeenCalledWith('i1', expect.objectContaining({ status: 'done' }));
  });
  it('shows new postings with stars and hides zero follow-ups', async () => {
    renderWithData(<Today />);
    expect(await screen.findByRole('link', { name: /New postings\s*8 · 3 ⭐/ })).toHaveAttribute('href', '/jobs');
    expect(screen.queryByText('Follow-ups due')).toBeNull();
  });
  it('Today before the first set', async () => {
    const api = createDemoApi();
    api.getDailySet = async () => null;
    renderWithData(<Today />, { api });
    expect(await screen.findByText("Today's set appears after 4 AM.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest run src/screens/Today.test.tsx`
Expected: FAIL (the starter screen renders only "Today", so `Day 12` isn't found).

- [ ] **Step 3: Implement the screen**

`web/src/screens/Today.tsx`:
```tsx
import { Check, Shuffle } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router';
import {
  useApplications, useCommits, useDailySet, useIdeas, useNow, useOutreach, usePostings, useProblemMap, useProjects,
  useRateSolve, useSettings, useSolves, useSwapIdea, useUpdateIdea,
} from '../data/hooks';
import type { Rating } from '../data/types';
import { swapCandidate, todaysIdea } from '../lib/ideas';
import { followUpsDue } from '../lib/outreach';
import { dayNumber, streaks } from '../lib/streaks';
import { localDay, planDay } from '../lib/time';
import { RATINGS, buildTodayItems, type TodayItem } from '../lib/today';
import { Button, Card, CardHead, DifficultyTag, Empty, LoadError, Skeleton } from '../ui/primitives';

const RATED: Record<Rating, { emoji: string; label: string }> = Object.fromEntries(
  RATINGS.map((r) => [r.value, { emoji: r.emoji, label: r.label }]),
) as Record<Rating, { emoji: string; label: string }>;

function slotText(item: TodayItem): string | null {
  if (item.slot === 'mystery') return item.topicHidden || !item.topicLabel ? 'Mystery' : `Mystery · ${item.topicLabel}`;
  if (item.slot === 'review' || item.slot === 'spot') return item.topicLabel ? `Review · ${item.topicLabel}` : 'Review';
  return item.topicLabel;
}

function SetRow({ item, busy, onRate }: { item: TodayItem; busy: boolean; onRate: (r: Rating) => void }) {
  const meta = slotText(item);
  const rating = item.solve?.rating ?? null;
  return (
    <li className={item.done ? 'set-row is-done' : 'set-row'}>
      <a className="set-link" href={item.url} target="_blank" rel="noopener noreferrer">
        <span className="check" aria-hidden="true">{item.done && <Check size={16} strokeWidth={3} />}</span>
        <span className="set-main">
          <span className="set-title">
            {item.title}
            {item.done && <span className="sr-only"> (solved)</span>}
          </span>
          <span className="set-meta">
            {item.difficulty && <DifficultyTag d={item.difficulty} />}
            {meta && <span>{meta}</span>}
            {rating && (
              <span>
                <span aria-hidden="true">{RATED[rating].emoji}</span>
                <span className="sr-only">Rated: {RATED[rating].label}</span>
              </span>
            )}
          </span>
        </span>
      </a>
      {item.needsRating && item.solve && (
        <div className="rate" role="group" aria-label={`How did ${item.title} go?`}>
          {RATINGS.map((r) => (
            <Button key={r.value} disabled={busy} onClick={() => onRate(r.value)}>
              <span aria-hidden="true">{r.emoji}</span> {r.label}
            </Button>
          ))}
        </div>
      )}
    </li>
  );
}

export default function Today() {
  const now = useNow();
  const day = planDay(now);
  const today = localDay(now);
  const settings = useSettings();
  const set = useDailySet(day);
  const solves = useSolves();
  const problems = useProblemMap();
  const commits = useCommits();
  const apps = useApplications();
  const ideas = useIdeas();
  const projects = useProjects();
  const postings = usePostings();
  const outreach = useOutreach();
  const rate = useRateSolve();
  const updateIdea = useUpdateIdea();
  const swap = useSwapIdea();

  const items = useMemo(
    () => (set.data ? buildTodayItems(set.data, solves.data ?? [], problems, day) : []),
    [set.data, solves.data, problems, day],
  );
  const s = streaks(solves.data ?? [], commits.data ?? [], apps.data ?? [], now);
  const n = dayNumber(settings.data?.lc_started_on ?? null, day);
  const idea = todaysIdea(ideas.data ?? [], day);
  const project = idea ? (projects.data ?? []).find((p) => p.id === idea.project_id) : undefined;
  const committed = idea
    ? (commits.data ?? []).some((c) => c.project_id === idea.project_id && localDay(new Date(c.committed_at)) === today)
    : false;
  const ideaDone = idea?.status === 'done' || committed;
  const next = idea && idea.status === 'today' ? swapCandidate(ideas.data ?? [], idea) : null;
  const fresh = (postings.data ?? []).filter((p) => p.status === 'new');
  const starred = fresh.filter((p) => p.starred).length;
  const due = followUpsDue(outreach.data ?? [], today).length;
  const doneCount = items.filter((i) => i.done).length;

  return (
    <div className="screen">
      <header className="screen-head">
        <h1>{n ? `Day ${n}` : 'Today'}</h1>
        <ul className="streaks" aria-label="Streaks">
          <li className="streak">LeetCode <b>{s.leetcode}</b></li>
          <li className="streak">Project <b>{s.project}</b></li>
          <li className="streak">Apps <b>{s.apps}</b></li>
        </ul>
      </header>

      <Card data-primary aria-labelledby="set-h">
        <CardHead id="set-h" title={set.data?.mixed_day ? 'Mixed day' : (set.data?.focus ?? 'LeetCode')}>
          {set.data && <span className="count"><span className="sr-only">Done: </span>{doneCount}/{items.length}</span>}
        </CardHead>
        {set.isPending ? (
          <Skeleton label="Loading today's set" />
        ) : set.isError ? (
          <LoadError what="today's set" onRetry={() => void set.refetch()} />
        ) : !set.data ? (
          <Empty>Today's set appears after 4 AM.</Empty>
        ) : (
          <ol className="set-list">
            {items.map((it) => (
              <SetRow key={it.slug} item={it} busy={rate.isPending}
                onRate={(r) => { if (it.solve) rate.mutate({ id: it.solve.id, rating: r }); }} />
            ))}
          </ol>
        )}
      </Card>

      {idea && project && (
        <Card aria-labelledby="idea-h">
          <CardHead id="idea-h" title={project.name}>
            {next && (
              <Button variant="quiet" disabled={swap.isPending} onClick={() => swap.mutate({ fromId: idea.id, toId: next.id, day })}>
                <Shuffle size={16} aria-hidden />Swap
              </Button>
            )}
          </CardHead>
          <label className="idea-toggle">
            <input type="checkbox" checked={ideaDone} disabled={committed || updateIdea.isPending}
              onChange={(e) => updateIdea.mutate({
                id: idea.id,
                patch: e.target.checked ? { status: 'done', done_at: new Date().toISOString() } : { status: 'today', done_at: null },
              })} />
            <span>{idea.text}</span>
          </label>
          {committed && <p className="muted small">Done by today's commit.</p>}
        </Card>
      )}

      {(due > 0 || fresh.length > 0) && (
        <nav className="links" aria-label="Also today">
          {due > 0 && <Link className="row-link" to="/outreach"><span>Follow-ups due</span><b>{due}</b></Link>}
          {fresh.length > 0 && (
            <Link className="row-link" to="/jobs"><span>New postings</span><b>{fresh.length}{starred > 0 && ` · ${starred} ⭐`}</b></Link>
          )}
        </nav>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run src/screens/Today.test.tsx && npm run typecheck && npm run lint`
Expected: 6 passed; clean.

- [ ] **Step 5: Commit**

```bash
git add web/src/screens/Today.tsx web/src/screens/Today.test.tsx
git commit -m "Add Today screen: LeetCode set with one-tap rating, idea, follow-ups"
```

---

### Task 7: LeetCode screen

**Files:**
- Modify: `web/src/screens/LeetCode.tsx` (replace the starter)
- Create: `web/src/screens/LeetCode.test.tsx`

**Interfaces:**
- Consumes: hooks `useNow, useTopics, useTopicStates, useSettings, useProblemStates, useProblemMap, useSolves, useUpdateSettings`; `roadmapRows, reviewQueue, upcomingReviews, topicCounts, LEVEL_LABEL, heatmap, intensity, problemUrl, RATINGS, planDay, localDay, relativeTime`; primitives
- Produces: default export `LeetCode` (route `/leetcode`). Primary element: the roadmap card.

Layout: **Roadmap** (18 topic buttons grouped by tier; color = level; lock icon when locked; "Focus" badge; tapping a topic opens its detail with level, solved counts, prerequisites, and **Make focus**) → **Reviews due** (count; first 5 linked, rest behind a tap; "N more this week") → **History** (26-week heatmap; recent solves behind a tap) → **Daily count** stepper behind a tap. Topic names come from the `topics` table (tags too, if ever shown); never from `problems.lc_tags`.

- [ ] **Step 1: Write the failing tests**

`web/src/screens/LeetCode.test.tsx`:
```tsx
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createDemoApi } from '../data/demo';
import { planDay } from '../lib/time';
import { renderWithData } from '../test/render';
import LeetCode from './LeetCode';

describe('LeetCode', () => {
  it('shows all 18 topics with level, lock and focus', async () => {
    const { container } = renderWithData(<LeetCode />);
    await screen.findByRole('button', { name: /Sliding Window/ });
    expect(container.querySelectorAll('.roadmap .topic')).toHaveLength(18);
    expect(screen.getByRole('button', { name: /Sliding Window.*Focus.*Learning/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Trees, Locked$/ })).toHaveClass('lvl-locked');
    expect(container.querySelector('[data-primary]')).toHaveTextContent('Roadmap');
  });
  it('Make focus sets the focus topic from today', async () => {
    const api = createDemoApi();
    const spy = vi.spyOn(api, 'updateSettings');
    renderWithData(<LeetCode />, { api });
    await userEvent.click(await screen.findByRole('button', { name: /^Binary Search, Ready$/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Make focus' }));
    expect(spy).toHaveBeenCalledWith({ lc_focus_topic: 'Binary Search', lc_focus_since: planDay(new Date()) });
  });
  it('lists due reviews and the week ahead', async () => {
    renderWithData(<LeetCode />);
    expect(await screen.findByRole('link', { name: 'Valid Anagram' })).toHaveAttribute('href', 'https://leetcode.com/problems/valid-anagram/');
    expect(screen.getByRole('link', { name: 'Group Anagrams' })).toBeInTheDocument();
    expect(screen.getByText('3 more this week.')).toBeInTheDocument();
  });
  it('labels the heatmap for screen readers', async () => {
    renderWithData(<LeetCode />);
    expect(await screen.findByRole('img', { name: /solves in the last 26 weeks/ })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest run src/screens/LeetCode.test.tsx`
Expected: FAIL (no topic buttons in the starter).

- [ ] **Step 3: Implement the screen**

`web/src/screens/LeetCode.tsx`:
```tsx
import { Lock } from 'lucide-react';
import { useState } from 'react';
import {
  useNow, useProblemMap, useProblemStates, useSettings, useSolves, useTopicStates, useTopics, useUpdateSettings,
} from '../data/hooks';
import type { Level } from '../data/types';
import { heatmap, intensity } from '../lib/heatmap';
import { LEVEL_LABEL, reviewQueue, roadmapRows, topicCounts, upcomingReviews } from '../lib/levels';
import { localDay, planDay, relativeTime } from '../lib/time';
import { RATINGS, problemUrl } from '../lib/today';
import { Badge, Button, Card, CardHead, DifficultyTag, Disclosure, Empty, LoadError, Skeleton, Stepper } from '../ui/primitives';

const ALL_LEVELS: Level[] = ['locked', 'available', 'learning', 'practicing', 'solid', 'mastered'];
const RATING_LABEL = Object.fromEntries(RATINGS.map((r) => [r.value, `${r.emoji} ${r.label}`])) as Record<string, string>;

export default function LeetCode() {
  const now = useNow();
  const day = planDay(now);
  const topics = useTopics();
  const states = useTopicStates();
  const settings = useSettings();
  const pstates = useProblemStates();
  const problems = useProblemMap();
  const solves = useSolves();
  const update = useUpdateSettings();
  const [open, setOpen] = useState<string | null>(null);

  const rows = roadmapRows(topics.data ?? [], states.data ?? [], settings.data?.lc_focus_topic ?? null);
  const selected = rows.flatMap((r) => r.topics).find((t) => t.name === open) ?? null;
  const queue = reviewQueue(pstates.data ?? [], problems, day);
  const soon = upcomingReviews(pstates.data ?? [], day, 7);
  const weeks = heatmap(solves.data ?? [], localDay(now));
  const total = weeks.flat().reduce((n, c) => n + c.count, 0);
  const reviewRow = ({ state, problem }: (typeof queue)[number]) => (
    <li key={state.slug} className="list-row">
      <a href={problemUrl(state.slug)} target="_blank" rel="noopener noreferrer">{problem?.title ?? state.slug}</a>
      {problem && <DifficultyTag d={problem.difficulty} />}
    </li>
  );

  return (
    <div className="screen">
      <header className="screen-head"><h1>LeetCode</h1></header>

      <Card data-primary aria-labelledby="map-h">
        <CardHead id="map-h" title="Roadmap" />
        {topics.isPending ? (
          <Skeleton label="Loading roadmap" />
        ) : topics.isError ? (
          <LoadError what="the roadmap" onRetry={() => void topics.refetch()} />
        ) : (
          <ol className="roadmap">
            {rows.map((r) => (
              <li key={r.tier}>
                <ul className="tier">
                  {r.topics.map((t) => (
                    <li key={t.name}>
                      <button type="button" className={`topic lvl-${t.level}`} aria-expanded={open === t.name}
                        onClick={() => setOpen(open === t.name ? null : t.name)}>
                        {t.level === 'locked' && <Lock size={14} aria-hidden />}
                        {t.name}
                        {t.isFocus && <Badge tone="accent">Focus</Badge>}
                        <span className="sr-only">, {LEVEL_LABEL[t.level]}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
        {selected && (
          <div className="stack" aria-live="polite">
            <p><b>{selected.name}</b> · {LEVEL_LABEL[selected.level]}</p>
            {(() => {
              const c = topicCounts(solves.data ?? [], problems, selected.name);
              return <p className="muted small">Solved: {c.Easy} easy · {c.Medium} medium · {c.Hard} hard</p>;
            })()}
            {selected.level === 'locked' && selected.prereqs.length > 0 && (
              <p className="muted small">Unlocks when {selected.prereqs.join(' and ')} reach Practicing.</p>
            )}
            {selected.isFocus ? (
              <p className="muted small">This is your focus.</p>
            ) : (
              <div className="row-actions">
                <Button disabled={update.isPending}
                  onClick={() => update.mutate({ lc_focus_topic: selected.name, lc_focus_since: day })}>Make focus</Button>
                <span className="muted small">Starts with tomorrow's set.</span>
              </div>
            )}
          </div>
        )}
        <Disclosure summary="Colors">
          <ul className="legend">
            {ALL_LEVELS.map((l) => <li key={l}><span className={`topic lvl-${l}`}>{LEVEL_LABEL[l]}</span></li>)}
          </ul>
        </Disclosure>
      </Card>

      <Card aria-labelledby="rev-h">
        <CardHead id="rev-h" title="Reviews due">{queue.length > 0 && <span className="count">{queue.length}</span>}</CardHead>
        {queue.length === 0 ? <Empty>Nothing due.</Empty> : <ul className="list">{queue.slice(0, 5).map(reviewRow)}</ul>}
        {queue.length > 5 && <Disclosure summary={`${queue.length - 5} more`}><ul className="list">{queue.slice(5).map(reviewRow)}</ul></Disclosure>}
        {soon > 0 && <p className="muted small">{soon} more this week.</p>}
      </Card>

      <Card aria-labelledby="hist-h">
        <CardHead id="hist-h" title="History"><span className="count">{total} solves</span></CardHead>
        <div className="heat" role="img" aria-label={`${total} solves in the last 26 weeks`}>
          {weeks.flat().map((c) => (
            <span key={c.day} className={c.future ? 'future' : `h${intensity(c.count)}`} title={`${c.day}: ${c.count}`} />
          ))}
        </div>
        <Disclosure summary="Recent solves">
          <ul className="list">
            {(solves.data ?? []).slice(0, 10).map((s) => (
              <li key={s.id} className="list-row">
                <span>{s.title}</span>
                <span className="muted small">{s.rating ? RATING_LABEL[s.rating] : 'Unrated'} · {relativeTime(s.accepted_at, now)}</span>
              </li>
            ))}
          </ul>
        </Disclosure>
      </Card>

      {settings.data && (
        <Disclosure summary="Daily count">
          <div className="row-actions">
            <Stepper label="Problems per day" value={settings.data.daily_lc_count} min={5} max={8}
              onChange={(v) => update.mutate({ daily_lc_count: v })} />
            <span className="muted small">Applies from tomorrow's set.</span>
          </div>
        </Disclosure>
      )}
    </div>
  );
}
```
The `Skeleton`/`LoadError` for `pstates` and `solves` are intentionally omitted: those cards render empty-safe defaults, and the Today screen already surfaces load errors for the same queries.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run src/screens/LeetCode.test.tsx && npm run typecheck && npm run lint`
Expected: 4 passed; clean. (Demo fixture: reviews due = Valid Anagram today + Group Anagrams overdue; in the next 7 days 3Sum, Container With Most Water and Two Sum → "3 more this week.")

- [ ] **Step 5: Commit**

```bash
git add web/src/screens/LeetCode.tsx web/src/screens/LeetCode.test.tsx
git commit -m "Add LeetCode screen: roadmap, focus override, reviews, history"
```

---

### Task 8: Projects and Settings screens

**Files:**
- Modify: `web/src/screens/Projects.tsx`, `web/src/screens/Settings.tsx` (replace the starters)
- Create: `web/src/screens/Projects.test.tsx`, `web/src/screens/Settings.test.tsx`

**Interfaces:**
- Consumes: hooks `useNow, useProjects, useCommits, useIdeas, useLaunchRequests, useAddIdea, useUpdateIdea, useReorderIdeas, useRequestLaunch, useSettings, useSyncStatus, useUpdateSettings, useSetProjectActive, useAddProject`; `useAuth`; `commitStrip, visibleIdeas, doneIdeas, moveIdea, nextPosition, suggestState, isStale, SOURCE_LABEL, STAGE_RULES, STAGE_LABEL, safeHref, relativeTime, localDay`; primitives incl. `ExternalLink`
- Produces: default exports `Projects` (route `/projects`; primary = first project card) and `Settings` (route `/settings`; primary = Sync card)

Projects layout per active project: name + GitHub link → last commit line → 30-day strip → ideas (todo/today, by position; up/down/done/drop) → add-idea row (text + S/M + add) → **Suggest improvements** (inserts `launch_requests` kind `suggest_ideas`, payload `{project_id}`; shows "Queued for Mac" while queued, "Opened on Mac" once the launcher picked it up, and a short error plus **Try again** (a new request) if it failed; the launcher reads `local_path` from the `projects` row, so the payload is only `{project_id}`) → done ideas behind a tap.

Settings layout: **Sync** (per source: last synced, Stale badge > 2 h, last error while failing) → Targets (LeetCode per day 5–8, applications per week, three nudge times) → Projects (active toggles; add form behind a tap) → Mac (resume folder, app URL) → Sheet stages table (from `STAGE_RULES`) → Sign out.

- [ ] **Step 1: Write the failing tests**

`web/src/screens/Projects.test.tsx`:
```tsx
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createDemoApi } from '../data/demo';
import { renderWithData } from '../test/render';
import Projects from './Projects';

describe('Projects', () => {
  it('one card per active project, first is primary, strip and last commit', async () => {
    const { container } = renderWithData(<Projects />);
    expect(await screen.findByRole('heading', { level: 2, name: '27B' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Showboat' })).toBeInTheDocument();
    expect(container.querySelector('[data-primary]')).toHaveTextContent('27B');
    expect(screen.getAllByRole('img', { name: /Commits on \d+ of the last 30 days/ })).toHaveLength(2);
    expect(await screen.findByText(/Add city search/)).toBeInTheDocument();
  });
  it('reorders, completes and drops ideas', async () => {
    const api = createDemoApi();
    const spy = vi.spyOn(api, 'updateIdea');
    renderWithData(<Projects />, { api });
    await userEvent.click(await screen.findByRole('button', { name: 'Move down: Add Chicago to the city picker' }));
    expect(spy).toHaveBeenCalledWith('i2', { position: 0 });
    expect(spy).toHaveBeenCalledWith('i1', { position: 1 });
    await userEvent.click(screen.getByRole('button', { name: 'Done: Cache weather API responses' }));
    expect(spy).toHaveBeenCalledWith('i2', expect.objectContaining({ status: 'done' }));
    await userEvent.click(screen.getByRole('button', { name: 'Drop: Offline mode for saved trips' }));
    expect(spy).toHaveBeenCalledWith('i4', { status: 'dropped' });
  });
  it('adds an idea at the end of the list', async () => {
    const api = createDemoApi();
    const spy = vi.spyOn(api, 'addIdea');
    renderWithData(<Projects />, { api });
    const input = await screen.findByRole('textbox', { name: 'New idea for 27B' });
    await userEvent.type(input, 'Add dark mode{Enter}');
    expect(spy).toHaveBeenCalledWith({ project_id: '27b', text: 'Add dark mode', size: 'S', position: 4 });
  });
  it('Suggest improvements queues a Mac launch', async () => {
    const api = createDemoApi();
    const spy = vi.spyOn(api, 'requestLaunch');
    renderWithData(<Projects />, { api });
    const card = (await screen.findByRole('heading', { level: 2, name: 'Showboat' })).closest('section')!;
    await userEvent.click(within(card).getByRole('button', { name: 'Suggest improvements' }));
    expect(spy).toHaveBeenCalledWith('suggest_ideas', { project_id: 'showboat' });
    expect(await within(card).findByRole('button', { name: 'Queued for Mac' })).toBeDisabled();
  });
  it('shows Opened on Mac, and a failed launch offers Try again (a new request)', async () => {
    const api = createDemoApi();
    api.listLaunchRequests = async () => [
      { id: 'a', kind: 'suggest_ideas', payload: { project_id: '27b' }, status: 'launched', error: null, created_at: '2026-10-14T12:00:00Z' },
      { id: 'b', kind: 'suggest_ideas', payload: { project_id: 'showboat' }, status: 'failed', error: "LaunchError: /Users/adamk/Developer/showboat doesn't exist on this Mac", created_at: '2026-10-14T12:00:00Z' },
    ];
    const spy = vi.spyOn(api, 'requestLaunch');
    renderWithData(<Projects />, { api });
    const b27 = (await screen.findByRole('heading', { level: 2, name: '27B' })).closest('section')!;
    expect(await within(b27).findByText('Opened on Mac')).toBeInTheDocument();
    const show = screen.getByRole('heading', { level: 2, name: 'Showboat' }).closest('section')!;
    expect(within(show).getByText(/doesn't exist on this Mac/)).toBeInTheDocument();
    await userEvent.click(within(show).getByRole('button', { name: 'Try again' }));
    expect(spy).toHaveBeenCalledWith('suggest_ideas', { project_id: 'showboat' });
  });
});
```

`web/src/screens/Settings.test.tsx`:
```tsx
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createDemoApi } from '../data/demo';
import { renderWithData } from '../test/render';
import Settings from './Settings';

describe('Settings', () => {
  it('shows sync status with a stale badge and the failing error', async () => {
    const { container } = renderWithData(<Settings />);
    const sync = container.querySelector('[data-primary]') as HTMLElement;
    const sheet = (await within(sync).findByText('Sheet')).closest('li')!;
    expect(sheet).toHaveTextContent('Stale');
    expect(sheet).toHaveTextContent('TransportError: timed out');
    expect(within(sync).getByText('LeetCode').closest('li')).not.toHaveTextContent('Stale');
  });
  it('saves targets', async () => {
    const api = createDemoApi();
    const spy = vi.spyOn(api, 'updateSettings');
    renderWithData(<Settings />, { api });
    await userEvent.click(await screen.findByRole('button', { name: 'More: LeetCode per day' }));
    expect(spy).toHaveBeenCalledWith({ daily_lc_count: 7 });
    const weekly = screen.getByRole('spinbutton', { name: 'Applications per week' });
    await userEvent.clear(weekly);
    await userEvent.type(weekly, '30');
    await userEvent.tab();
    expect(spy).toHaveBeenCalledWith({ weekly_app_target: 30 });
  });
  it('rejects nudge times out of order', async () => {
    const api = createDemoApi();
    const spy = vi.spyOn(api, 'updateSettings');
    renderWithData(<Settings />, { api });
    const check = await screen.findByLabelText('Check-in');
    await userEvent.clear(check);
    await userEvent.type(check, '09:00');
    await userEvent.tab();
    expect(await screen.findByText('Times must be in order.')).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalledWith(expect.objectContaining({ nudge_times: expect.anything() }));
  });
  it('rejects a non-http app URL', async () => {
    renderWithData(<Settings />);
    const field = await screen.findByRole('textbox', { name: 'App URL' });
    await userEvent.type(field, 'javascript:alert(1)');
    await userEvent.tab();
    expect(await screen.findByText('Use a full https:// link.')).toBeInTheDocument();
  });
  it('adds and toggles projects with validation', async () => {
    const api = createDemoApi();
    const add = vi.spyOn(api, 'addProject');
    const toggle = vi.spyOn(api, 'setProjectActive');
    renderWithData(<Settings />, { api });
    await userEvent.click(await screen.findByRole('checkbox', { name: /Showboat/ }));
    expect(toggle).toHaveBeenCalledWith('showboat', false);
    await userEvent.click(screen.getByText('New project'));
    await userEvent.type(screen.getByRole('textbox', { name: 'ID' }), 'lego');
    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'LEGO');
    await userEvent.type(screen.getByRole('textbox', { name: 'GitHub repo' }), 'not a repo');
    await userEvent.click(screen.getByRole('button', { name: 'Add project' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Repo looks like owner/name.');
    await userEvent.clear(screen.getByRole('textbox', { name: 'GitHub repo' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'GitHub repo' }), 'adamkuhn1/lego');
    await userEvent.click(screen.getByRole('button', { name: 'Add project' }));
    expect(add).toHaveBeenCalledWith({ id: 'lego', name: 'LEGO', repo: 'adamkuhn1/lego', local_path: null });
  });
  it('shows the Sheet status → stage table', async () => {
    renderWithData(<Settings />);
    const table = await screen.findByRole('table', { name: 'Sheet stages' });
    expect(within(table).getAllByRole('row')).toHaveLength(6); // header + 5 rules
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest run src/screens/Projects.test.tsx src/screens/Settings.test.tsx`
Expected: FAIL (starters have no cards).

- [ ] **Step 3: Implement Projects**

`web/src/screens/Projects.tsx`:
```tsx
import { Check, ChevronDown, ChevronUp, Plus, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import {
  useAddIdea, useCommits, useIdeas, useLaunchRequests, useNow, useProjects, useReorderIdeas, useRequestLaunch, useUpdateIdea,
} from '../data/hooks';
import type { Commit, Idea, LaunchRequest, Project } from '../data/types';
import { commitStrip, doneIdeas, moveIdea, nextPosition, suggestState, visibleIdeas } from '../lib/ideas';
import { localDay, relativeTime } from '../lib/time';
import { Button, Card, CardHead, Disclosure, Empty, ExternalLink, LoadError, Skeleton } from '../ui/primitives';

const shortError = (e: string) => (e.length > 140 ? `${e.slice(0, 139)}…` : e);

function IdeaRow({ idea, first, last, onMove, onDone, onDrop }: {
  idea: Idea; first: boolean; last: boolean; onMove: (dir: -1 | 1) => void; onDone: () => void; onDrop: () => void;
}) {
  const tags = [idea.size, idea.source === 'claude' ? 'Claude' : null, idea.status === 'today' ? 'Today' : null].filter(Boolean).join(' · ');
  return (
    <li className="idea-row">
      <span className="idea-text">{idea.text} <span className="muted small">{tags}</span></span>
      <Button variant="quiet" aria-label={`Move up: ${idea.text}`} disabled={first} onClick={() => onMove(-1)}><ChevronUp size={18} aria-hidden /></Button>
      <Button variant="quiet" aria-label={`Move down: ${idea.text}`} disabled={last} onClick={() => onMove(1)}><ChevronDown size={18} aria-hidden /></Button>
      <Button variant="quiet" aria-label={`Done: ${idea.text}`} onClick={onDone}><Check size={18} aria-hidden /></Button>
      <Button variant="quiet" aria-label={`Drop: ${idea.text}`} onClick={onDrop}><X size={18} aria-hidden /></Button>
    </li>
  );
}

function AddIdea({ label, busy, onAdd }: { label: string; busy: boolean; onAdd: (text: string, size: 'S' | 'M') => void }) {
  const [text, setText] = useState('');
  const [size, setSize] = useState<'S' | 'M'>('S');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    onAdd(t, size);
    setText('');
  };
  return (
    <form className="inline-form" onSubmit={submit}>
      <input aria-label={label} placeholder="Add an idea" maxLength={200} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="seg" role="group" aria-label="Size">
        {(['S', 'M'] as const).map((s) => (
          <Button key={s} aria-pressed={size === s} onClick={() => setSize(s)}>{s}</Button>
        ))}
      </div>
      <Button type="submit" variant="primary" aria-label="Add idea" disabled={busy || !text.trim()}><Plus size={18} aria-hidden /></Button>
    </form>
  );
}

function ProjectCard({ project, primary, now, commits, ideas, requests }: {
  project: Project; primary: boolean; now: Date; commits: Commit[]; ideas: Idea[]; requests: LaunchRequest[];
}) {
  const addIdea = useAddIdea();
  const updateIdea = useUpdateIdea();
  const reorder = useReorderIdeas();
  const launch = useRequestLaunch();
  const strip = commitStrip(commits, project.id, localDay(now));
  const last = commits
    .filter((c) => c.project_id === project.id)
    .sort((a, b) => Date.parse(b.committed_at) - Date.parse(a.committed_at))[0];
  const list = visibleIdeas(ideas, project.id);
  const done = doneIdeas(ideas, project.id);
  const suggest = suggestState(requests, project.id);
  const headId = `proj-${project.id}`;

  return (
    <Card data-primary={primary || undefined} aria-labelledby={headId}>
      <CardHead id={headId} title={project.name}>
        <ExternalLink className="btn btn-quiet" href={`https://github.com/${project.repo}`}>GitHub</ExternalLink>
      </CardHead>
      <p className="muted small">{last ? `${relativeTime(last.committed_at, now)} · ${last.message}` : 'No commits in 30 days'}</p>
      <div className="strip" role="img" aria-label={`Commits on ${strip.filter((n) => n > 0).length} of the last 30 days`}>
        {strip.map((n, i) => <span key={i} className={n > 0 ? 'on' : undefined} />)}
      </div>
      {list.length === 0 ? (
        <Empty>No ideas yet.</Empty>
      ) : (
        <ol>
          {list.map((idea, i) => (
            <IdeaRow key={idea.id} idea={idea} first={i === 0} last={i === list.length - 1}
              onMove={(dir) => reorder.mutate(moveIdea(list, idea.id, dir))}
              onDone={() => updateIdea.mutate({ id: idea.id, patch: { status: 'done', done_at: new Date().toISOString() } })}
              onDrop={() => updateIdea.mutate({ id: idea.id, patch: { status: 'dropped' } })} />
          ))}
        </ol>
      )}
      <AddIdea label={`New idea for ${project.name}`} busy={addIdea.isPending}
        onAdd={(text, size) => addIdea.mutate({ project_id: project.id, text, size, position: nextPosition(list) })} />
      <div className="row-actions">
        <Button disabled={suggest.kind === 'queued' || launch.isPending}
          onClick={() => launch.mutate({ kind: 'suggest_ideas', payload: { project_id: project.id } })}>
          {suggest.kind === 'queued' ? 'Queued for Mac' : suggest.kind === 'failed' ? 'Try again' : 'Suggest improvements'}
        </Button>
        {suggest.kind === 'launched' && <span className="muted small">Opened on Mac</span>}
      </div>
      {suggest.kind === 'failed' && <p className="error small">{shortError(suggest.error)}</p>}
      {done.length > 0 && (
        <Disclosure summary={`Done (${done.length})`}>
          <ul className="list">{done.map((d) => <li key={d.id} className="list-row muted">{d.text}</li>)}</ul>
        </Disclosure>
      )}
    </Card>
  );
}

export default function Projects() {
  const now = useNow();
  const projects = useProjects();
  const commits = useCommits();
  const ideas = useIdeas();
  const requests = useLaunchRequests();
  const active = (projects.data ?? []).filter((p) => p.active);
  return (
    <div className="screen">
      <header className="screen-head"><h1>Projects</h1></header>
      {projects.isPending ? (
        <Skeleton label="Loading projects" />
      ) : projects.isError ? (
        <LoadError what="projects" onRetry={() => void projects.refetch()} />
      ) : active.length === 0 ? (
        <Empty>No active projects. Add one in Settings.</Empty>
      ) : (
        active.map((p, i) => (
          <ProjectCard key={p.id} project={p} primary={i === 0} now={now}
            commits={commits.data ?? []} ideas={ideas.data ?? []} requests={requests.data ?? []} />
        ))
      )}
    </div>
  );
}
```

- [ ] **Step 4: Implement Settings**

`web/src/screens/Settings.tsx`:
```tsx
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { useAuth } from '../data/context';
import { useAddProject, useNow, useProjects, useSetProjectActive, useSettings, useSyncStatus, useUpdateSettings } from '../data/hooks';
import type { Project } from '../data/types';
import { STAGE_LABEL } from '../lib/funnel';
import { STAGE_RULES } from '../lib/stages';
import { SOURCE_LABEL, isStale } from '../lib/sync';
import { relativeTime } from '../lib/time';
import { safeHref } from '../lib/url';
import { Badge, Button, Card, CardHead, Disclosure, Empty, Stepper } from '../ui/primitives';

function TextField({ label, value, placeholder, validate, onSave }: {
  label: string; value: string; placeholder?: string; validate?: (v: string) => string | null; onSave: (v: string) => void;
}) {
  const id = useId();
  const [v, setV] = useState(value);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => setV(value), [value]);
  const commit = () => {
    const t = v.trim();
    if (t === value) return;
    const e = validate?.(t) ?? null;
    setErr(e);
    if (e) return;
    onSave(t);
    setSaved(true);
  };
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} value={v} placeholder={placeholder} aria-invalid={err ? true : undefined}
        aria-describedby={err ? `${id}-err` : undefined}
        onChange={(e) => { setV(e.target.value); setSaved(false); }} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} />
      {err && <p id={`${id}-err`} className="error small">{err}</p>}
      <span className="muted small" aria-live="polite">{saved ? 'Saved' : ''}</span>
    </div>
  );
}

function NumberField({ label, value, min, max, onSave }: { label: string; value: number; min: number; max: number; onSave: (v: number) => void }) {
  const id = useId();
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  const commit = () => {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) { setV(String(value)); return; }
    const clamped = Math.min(max, Math.max(min, n));
    setV(String(clamped));
    if (clamped !== value) onSave(clamped);
  };
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="number" inputMode="numeric" min={min} max={max} value={v}
        onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} />
    </div>
  );
}

const NUDGE_LABELS = ['Plan', 'Check-in', 'Streak alert'];

function NudgeTimes({ value, onSave }: { value: string[]; onSave: (v: string[]) => void }) {
  const [times, setTimes] = useState(value);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setTimes(value), [value]);
  const commit = () => {
    const ok = times.length === 3 && times.every((t) => /^\d{2}:\d{2}$/.test(t)) && times[0] < times[1] && times[1] < times[2];
    setErr(ok ? null : 'Times must be in order.');
    if (ok && times.join() !== value.join()) onSave(times);
  };
  return (
    <fieldset className="field">
      <legend className="muted small">Nudges</legend>
      <div className="times">
        {NUDGE_LABELS.map((label, i) => (
          <label key={label} className="field">
            <span>{label}</span>
            <input type="time" value={times[i] ?? ''} onBlur={commit}
              onChange={(e) => setTimes(times.map((t, j) => (j === i ? e.target.value : t)))} />
          </label>
        ))}
      </div>
      {err && <p role="alert" className="error small">{err}</p>}
    </fieldset>
  );
}

const EMPTY_FORM = { id: '', name: '', repo: '', local_path: '' };

function ProjectsCard({ projects }: { projects: Project[] }) {
  const setActive = useSetProjectActive();
  const add = useAddProject();
  const [form, setForm] = useState(EMPTY_FORM);
  const [err, setErr] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const p = { id: form.id.trim().toLowerCase(), name: form.name.trim(), repo: form.repo.trim(), local_path: form.local_path.trim() || null };
    const problem =
      !/^[a-z0-9-]+$/.test(p.id) ? 'ID: lowercase letters, digits and dashes.'
      : !p.name ? 'Name is required.'
      : !/^[\w.-]+\/[\w.-]+$/.test(p.repo) ? 'Repo looks like owner/name.'
      : projects.some((x) => x.id === p.id) ? 'That ID is taken.'
      : null;
    setErr(problem);
    if (!problem) add.mutate(p, { onSuccess: () => setForm(EMPTY_FORM) });
  };
  const field = (key: keyof typeof EMPTY_FORM, label: string, placeholder: string) => (
    <label className="field">
      <span>{label}</span>
      <input value={form[key]} placeholder={placeholder} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
    </label>
  );
  return (
    <Card aria-labelledby="proj-h">
      <CardHead id="proj-h" title="Projects" />
      <ul>
        {projects.map((p) => (
          <li key={p.id}>
            <label className="check-row">
              <input type="checkbox" checked={p.active} onChange={(e) => setActive.mutate({ id: p.id, active: e.target.checked })} />
              <span>{p.name} <span className="muted small">{p.repo}</span></span>
            </label>
          </li>
        ))}
      </ul>
      <Disclosure summary="New project">
        <form className="stack" onSubmit={submit}>
          {field('id', 'ID', 'lego')}
          {field('name', 'Name', 'LEGO from photo')}
          {field('repo', 'GitHub repo', 'adamkuhn1/lego')}
          {field('local_path', 'Folder on Mac', '~/Developer/lego')}
          <div><Button type="submit" variant="primary" disabled={add.isPending}>Add project</Button></div>
          {err && <p role="alert" className="error small">{err}</p>}
        </form>
      </Disclosure>
    </Card>
  );
}

export default function Settings() {
  const now = useNow();
  const settings = useSettings();
  const projects = useProjects();
  const status = useSyncStatus();
  const update = useUpdateSettings();
  const auth = useAuth();
  const qc = useQueryClient();
  const s = settings.data;
  const rows = [...(status.data ?? [])].sort((a, b) => a.source.localeCompare(b.source));

  return (
    <div className="screen">
      <header className="screen-head"><h1>Settings</h1></header>

      <Card data-primary aria-labelledby="sync-h">
        <CardHead id="sync-h" title="Sync" />
        {rows.length === 0 ? <Empty>No syncs yet.</Empty> : (
          <ul>
            {rows.map((r) => (
              <li key={r.source} className="sync-row">
                <span>{SOURCE_LABEL[r.source] ?? r.source}</span>
                <span className="muted small">
                  {r.last_ok_at ? relativeTime(r.last_ok_at, now) : 'Never'}{' '}
                  {isStale(r, now) && <Badge tone="warn">Stale</Badge>}
                </span>
                {r.consecutive_failures > 0 && r.last_error && <p className="error small">{r.last_error}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {s && (
        <Card aria-labelledby="targets-h">
          <CardHead id="targets-h" title="Targets" />
          <div className="check-row">
            <span>LeetCode per day</span>
            <Stepper label="LeetCode per day" value={s.daily_lc_count} min={5} max={8} onChange={(v) => update.mutate({ daily_lc_count: v })} />
          </div>
          <NumberField label="Applications per week" value={s.weekly_app_target} min={1} max={200} onSave={(v) => update.mutate({ weekly_app_target: v })} />
          <NudgeTimes value={s.nudge_times} onSave={(v) => update.mutate({ nudge_times: v })} />
        </Card>
      )}

      <ProjectsCard projects={projects.data ?? []} />

      {s && (
        <Card aria-labelledby="mac-h">
          <CardHead id="mac-h" title="Mac" />
          <TextField label="Resume folder" value={s.resume_root} onSave={(v) => update.mutate({ resume_root: v })}
            validate={(v) => (v ? null : 'Required.')} />
          <TextField label="App URL" value={s.app_url ?? ''} placeholder="https://lock-in.vercel.app"
            validate={(v) => (!v || safeHref(v) ? null : 'Use a full https:// link.')}
            onSave={(v) => update.mutate({ app_url: v || null })} />
        </Card>
      )}

      <Card aria-labelledby="rules-h">
        <CardHead id="rules-h" title="Sheet stages" />
        <table className="rules" aria-labelledby="rules-h">
          <thead className="sr-only"><tr><th scope="col">Status matches</th><th scope="col">Stage</th></tr></thead>
          <tbody>
            {STAGE_RULES.map(([pattern, stage]) => (
              <tr key={pattern}><td><code>{pattern}</code></td><td>{STAGE_LABEL[stage]}</td></tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">First match wins. Anything else is Other.</p>
      </Card>

      <div>
        <Button variant="danger" onClick={async () => { await auth.signOut(); qc.clear(); }}>Sign out</Button>
      </div>
    </div>
  );
}
```
Note on the test name `textbox 'App URL'`: the `<label htmlFor>` association gives the input that accessible name. The "Saved" live region is empty until a save.

Add one style for the fieldset (append to `web/src/styles/app.css`):
```css
fieldset.field { margin: 0; padding: 0; border: 0; min-width: 0; }
.field > label { font-size: 0.85rem; color: var(--muted); }
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npx vitest run src/screens/Projects.test.tsx src/screens/Settings.test.tsx && npm run typecheck && npm run lint`
Expected: 11 passed; clean. (Requires Errata E2, so `suggestState` returns `launched`.)

- [ ] **Step 6: Commit**

```bash
git add web/src/screens/Projects.tsx web/src/screens/Projects.test.tsx web/src/screens/Settings.tsx web/src/screens/Settings.test.tsx web/src/styles/app.css
git commit -m "Add Projects (ideas, commit strip, suggest) and Settings screens"
```

---

### Task 9: Applications and Jobs screens

**Files:**
- Modify: `web/src/screens/Applications.tsx`, `web/src/screens/Jobs.tsx` (replace the starters)
- Create: `web/src/screens/Applications.test.tsx`, `web/src/screens/Jobs.test.tsx`

**Interfaces:**
- Consumes: hooks `useNow, useApplications, useSettings, usePostings, useSetPostingStatus, useQueueOutreach`; `appliedThisWeek, funnel, groupByStage, searchApps, STAGE_LABEL, NO_FILTERS, filterPostings, sortPostings, termsOf, topLocations, JobFilters, safeHref, localDay, relativeTime, shortDate`; primitives incl. `Chip`, `ExternalLink`
- Produces: default exports `Applications` (route `/apps`; primary = this-week card) and `Jobs` (route `/jobs`; primary = inbox card)

Applications layout: **This week** (`N of target`, progress bar) → Funnel table (count, stage-to-stage rate, typical rate; footnote with 582 → 54 → 13 → 5) → Board (search; one collapsible group per stage, offer/interview/OA open, the rest closed; search opens all) → "Open sheet" in the header (only if `settings.sheet_id`).

Jobs layout: quick chips (⭐ Starred, Internship, New grad) → term/location chips behind a "More filters" tap → **Inbox** (new postings, ⭐ first; per row Open / Cold email / Dismiss) → "Opened (n)" behind a tap. Open marks a posting `seen`; Cold email queues outreach (`job_url`, `company`, `role`), marks the posting `outreach`, and goes to `/outreach`; Dismiss marks it `dismissed`. A posting whose URL isn't http(s) shows the raw text and can't be opened or cold-emailed.

- [ ] **Step 1: Write the failing tests**

`web/src/screens/Applications.test.tsx`:
```tsx
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { createDemoApi } from '../data/demo';
import type { Application } from '../data/types';
import { localDay } from '../lib/time';
import { renderWithData } from '../test/render';
import Applications from './Applications';

const app = (id: number, applied_on: string | null): Application => ({
  id, company: `Co${id}`, role: 'SWE Intern', track: null, term: null, location: null, status: 'Submitted', stage: 'applied', priority: null, applied_on,
});

describe('Applications', () => {
  it('leads with this week vs target', async () => {
    const api = createDemoApi();
    const today = localDay(new Date());
    api.listApplications = async () => [app(1, today), app(2, today), app(3, '2020-01-01')];
    const { container } = renderWithData(<Applications />, { api });
    const primary = container.querySelector('[data-primary]') as HTMLElement;
    expect(await within(primary).findByText('2')).toBeInTheDocument();
    expect(primary).toHaveTextContent('of 25');
    expect(within(primary).getByRole('progressbar', { name: 'Applications this week' })).toHaveAttribute('aria-valuenow', '2');
  });
  it('funnel shows counts, rates and the typical rates', async () => {
    renderWithData(<Applications />);
    const table = await screen.findByRole('table', { name: 'Funnel' });
    const oa = within(table).getByRole('row', { name: /^OA/ });
    expect(oa).toHaveTextContent('4');
    expect(oa).toHaveTextContent('20%');
    expect(oa).toHaveTextContent('9.3%');
  });
  it('search narrows the board and opens matching groups', async () => {
    renderWithData(<Applications />);
    await userEvent.type(await screen.findByRole('searchbox', { name: 'Search' }), 'stripe');
    expect(screen.getByText('OA (1)')).toBeInTheDocument();
    expect(screen.queryByText(/Applied \(/)).toBeNull();
  });
  it('links to the sheet', async () => {
    renderWithData(<Applications />);
    expect(await screen.findByRole('link', { name: 'Open sheet' })).toHaveAttribute('href', 'https://docs.google.com/spreadsheets/d/demo-sheet-id');
  });
});
```

`web/src/screens/Jobs.test.tsx`:
```tsx
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { createDemoApi } from '../data/demo';
import { renderWithData } from '../test/render';
import Jobs from './Jobs';

const tree = (
  <Routes>
    <Route path="/" element={<Jobs />} />
    <Route path="/outreach" element={<p>outreach page</p>} />
  </Routes>
);

describe('Jobs', () => {
  it('lists new postings with starred first', async () => {
    const { container } = renderWithData(tree);
    await screen.findAllByRole('button', { name: 'Cold email' });
    const titles = [...container.querySelectorAll('[data-primary] .job-title')].map((n) => n.textContent);
    expect(titles).toHaveLength(8);
    expect(titles.slice(0, 3).every((t) => t?.includes('Starred'))).toBe(true);
  });
  it('filters by star and clears', async () => {
    renderWithData(tree);
    await userEvent.click(await screen.findByRole('button', { name: '⭐ Starred' }));
    expect(screen.getAllByRole('button', { name: 'Cold email' })).toHaveLength(3);
    await userEvent.click(screen.getByRole('button', { name: 'New grad' }));
    expect(screen.getByText('Nothing matches these filters.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getAllByRole('button', { name: 'Cold email' })).toHaveLength(8);
  });
  it('dismiss removes a posting', async () => {
    const api = createDemoApi();
    const spy = vi.spyOn(api, 'setPostingStatus');
    renderWithData(tree, { api });
    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss Ramp Software Engineer, New Grad' }));
    expect(spy).toHaveBeenCalledWith('p3', 'dismissed');
    expect(await screen.findAllByRole('button', { name: 'Cold email' })).toHaveLength(7);
  });
  it('cold email queues outreach and goes to Outreach', async () => {
    const api = createDemoApi();
    const queue = vi.spyOn(api, 'queueOutreach');
    const status = vi.spyOn(api, 'setPostingStatus');
    const { container } = renderWithData(tree, { api });
    await screen.findAllByRole('button', { name: 'Cold email' });
    const stripe = [...container.querySelectorAll('li.job')].find((li) => li.textContent?.includes('Stripe')) as HTMLElement;
    await userEvent.click(within(stripe).getByRole('button', { name: 'Cold email' }));
    expect(queue).toHaveBeenCalledWith({ job_url: expect.stringMatching(/^https:\/\/boards\.greenhouse\.io\/stripe\//), company: 'Stripe', role: 'Software Engineer Intern, Winter 2027' });
    expect(await screen.findByText('outreach page')).toBeInTheDocument();
    expect(status).toHaveBeenCalledWith('p1', 'outreach');
  });
  it('Jobs renders a javascript: URL as text', async () => {
    const api = createDemoApi();
    api.listPostings = async () => [{
      id: 'evil', company: 'Evil', title: 'Intern', location: null, url: 'javascript:alert(1)', term: null,
      posted_at: null, tier: null, starred: false, status: 'new', found_at: new Date().toISOString(),
    }];
    const { container } = renderWithData(tree, { api });
    expect(await screen.findByText('Link: javascript:alert(1)')).toBeInTheDocument();
    expect(container.querySelector('a[href^="javascript"]')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Cold email' })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest run src/screens/Applications.test.tsx src/screens/Jobs.test.tsx`
Expected: FAIL (starters render no content).

- [ ] **Step 3: Implement Applications**

`web/src/screens/Applications.tsx`:
```tsx
import { useState } from 'react';
import { useApplications, useNow, useSettings } from '../data/hooks';
import { STAGE_LABEL, appliedThisWeek, funnel, groupByStage, searchApps } from '../lib/funnel';
import { localDay, shortDate } from '../lib/time';
import { Card, CardHead, Disclosure, Empty, ExternalLink, LoadError, Skeleton } from '../ui/primitives';

const OPEN_BY_DEFAULT = new Set(['offer', 'interview', 'oa']);

export default function Applications() {
  const now = useNow();
  const apps = useApplications();
  const settings = useSettings();
  const [q, setQ] = useState('');
  const list = apps.data ?? [];
  const week = appliedThisWeek(list, localDay(now));
  const target = settings.data?.weekly_app_target ?? 25;
  const rows = funnel(list);
  const searching = q.trim() !== '';
  const groups = groupByStage(searchApps(list, q));
  const sheetId = settings.data?.sheet_id;
  const sheet = sheetId ? `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}` : null;

  return (
    <div className="screen">
      <header className="screen-head">
        <h1>Applications</h1>
        {sheet && <ExternalLink className="btn btn-quiet" href={sheet}>Open sheet</ExternalLink>}
      </header>

      <Card data-primary aria-labelledby="week-h">
        <CardHead id="week-h" title="This week" />
        {apps.isPending ? (
          <Skeleton label="Loading applications" />
        ) : apps.isError ? (
          <LoadError what="applications" onRetry={() => void apps.refetch()} />
        ) : (
          <>
            <p className="big-num"><b>{week}</b><span className="muted">of {target}</span></p>
            <div className="bar" role="progressbar" aria-label="Applications this week"
              aria-valuemin={0} aria-valuemax={target} aria-valuenow={week}>
              <span style={{ width: `${Math.min(100, (week / Math.max(1, target)) * 100)}%` }} />
            </div>
          </>
        )}
      </Card>

      <Card aria-labelledby="funnel-h">
        <CardHead id="funnel-h" title="Funnel" />
        <table className="funnel" aria-labelledby="funnel-h">
          <thead>
            <tr><th scope="col">Stage</th><th scope="col">You</th><th scope="col">Rate</th><th scope="col">Typical</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.stage}>
                <th scope="row">{r.label}</th>
                <td>{r.count}</td>
                <td>{r.pct === null ? '—' : `${r.pct}%`}</td>
                <td className="muted">{r.refPct === null ? '—' : `${r.refPct}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">Typical: 582 → 54 → 13 → 5.</p>
      </Card>

      <Card aria-labelledby="board-h">
        <CardHead id="board-h" title="Board" />
        <label className="field">
          <span>Search</span>
          <input type="search" value={q} placeholder="Company, role or status" onChange={(e) => setQ(e.target.value)} />
        </label>
        {groups.length === 0 ? (
          <Empty>{searching ? 'No matches.' : 'No applications yet.'}</Empty>
        ) : (
          groups.map(([stage, items]) => (
            <Disclosure key={`${stage}-${searching}`} open={searching || OPEN_BY_DEFAULT.has(stage)}
              summary={`${STAGE_LABEL[stage]} (${items.length})`}>
              <ul>
                {items.map((a) => (
                  <li key={a.id} className="app-row">
                    <span className="job-title">{a.company}</span>
                    {a.role && <span className="small">{a.role}</span>}
                    <span className="muted small">{[a.status, a.applied_on && shortDate(a.applied_on)].filter(Boolean).join(' · ')}</span>
                  </li>
                ))}
              </ul>
            </Disclosure>
          ))
        )}
      </Card>
    </div>
  );
}
```
Demo fixture funnel: 20 reached Applied (13 applied + 3 closed + 2 OA + 2 interview), 4 reached OA (20%), 2 reached interview (50%), 0 offers (0%).

- [ ] **Step 4: Implement Jobs**

`web/src/screens/Jobs.tsx`:
```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useNow, usePostings, useQueueOutreach, useSetPostingStatus } from '../data/hooks';
import type { Posting } from '../data/types';
import { NO_FILTERS, filterPostings, sortPostings, termsOf, topLocations, type JobFilters } from '../lib/jobs';
import { relativeTime } from '../lib/time';
import { safeHref } from '../lib/url';
import { Button, Card, CardHead, Chip, Disclosure, Empty, LoadError, Skeleton } from '../ui/primitives';

function JobRow({ p, now, busy, onOpen, onCold, onDismiss }: {
  p: Posting; now: Date; busy: boolean; onOpen?: () => void; onCold: (href: string) => void; onDismiss: () => void;
}) {
  const href = safeHref(p.url);
  const meta = [p.location, p.term, relativeTime(p.posted_at ?? p.found_at, now)].filter(Boolean).join(' · ');
  return (
    <li className="job">
      <div>
        <p className="job-title">
          {p.starred && <><span aria-hidden="true">⭐ </span><span className="sr-only">Starred: </span></>}
          {p.company} · {p.title}
        </p>
        <p className="muted small">{meta}</p>
        {!href && p.url && <p className="muted small">Link: {p.url}</p>}
      </div>
      <div className="row-actions">
        {href && <a className="btn" href={href} target="_blank" rel="noopener noreferrer" onClick={onOpen}>Open</a>}
        <Button variant="primary" disabled={!href || busy} onClick={() => { if (href) onCold(href); }}>Cold email</Button>
        <Button aria-label={`Dismiss ${p.company} ${p.title}`} onClick={onDismiss}>Dismiss</Button>
      </div>
    </li>
  );
}

export default function Jobs() {
  const now = useNow();
  const postings = usePostings();
  const setStatus = useSetPostingStatus();
  const queue = useQueueOutreach();
  const navigate = useNavigate();
  const [f, setF] = useState<JobFilters>(NO_FILTERS);

  const all = postings.data ?? [];
  const fresh = all.filter((p) => p.status === 'new');
  const inbox = sortPostings(filterPostings(fresh, f));
  const opened = sortPostings(all.filter((p) => p.status === 'seen'));
  const terms = termsOf(fresh);
  const places = topLocations(fresh);
  const filtering = f.starred || f.track !== null || f.term !== null || f.location !== null;
  const toggle = <K extends keyof JobFilters>(k: K, v: JobFilters[K]) => setF({ ...f, [k]: f[k] === v ? NO_FILTERS[k] : v });

  const coldEmail = (p: Posting, href: string) =>
    queue.mutate({ job_url: href, company: p.company, role: p.title }, {
      onSuccess: () => {
        setStatus.mutate({ id: p.id, status: 'outreach' });
        navigate('/outreach');
      },
    });
  const row = (p: Posting, markSeen: boolean) => (
    <JobRow key={p.id} p={p} now={now} busy={queue.isPending}
      onOpen={markSeen ? () => setStatus.mutate({ id: p.id, status: 'seen' }) : undefined}
      onCold={(href) => coldEmail(p, href)}
      onDismiss={() => setStatus.mutate({ id: p.id, status: 'dismissed' })} />
  );

  return (
    <div className="screen">
      <header className="screen-head">
        <h1>Jobs</h1>
        {fresh.length > 0 && <span className="count">{fresh.length} new</span>}
      </header>

      <div className="chips" role="group" aria-label="Filters">
        <Chip pressed={f.starred} onToggle={() => setF({ ...f, starred: !f.starred })}>⭐ Starred</Chip>
        <Chip pressed={f.track === 'internship'} onToggle={() => toggle('track', 'internship')}>Internship</Chip>
        <Chip pressed={f.track === 'new_grad'} onToggle={() => toggle('track', 'new_grad')}>New grad</Chip>
      </div>
      {(terms.length > 0 || places.length > 0) && (
        <Disclosure summary="More filters">
          <div className="chips" role="group" aria-label="Term and location">
            {terms.map((t) => <Chip key={t} pressed={f.term === t} onToggle={() => toggle('term', t)}>{t}</Chip>)}
            {places.map((l) => <Chip key={l} pressed={f.location === l} onToggle={() => toggle('location', l)}>{l}</Chip>)}
          </div>
        </Disclosure>
      )}

      <Card data-primary aria-labelledby="inbox-h">
        <CardHead id="inbox-h" title="Inbox" />
        {postings.isPending ? (
          <Skeleton label="Loading postings" />
        ) : postings.isError ? (
          <LoadError what="postings" onRetry={() => void postings.refetch()} />
        ) : inbox.length === 0 ? (
          filtering ? (
            <div className="stack">
              <Empty>Nothing matches these filters.</Empty>
              <div><Button onClick={() => setF(NO_FILTERS)}>Clear filters</Button></div>
            </div>
          ) : (
            <Empty>Inbox zero.</Empty>
          )
        ) : (
          <ul>{inbox.map((p) => row(p, true))}</ul>
        )}
      </Card>

      {opened.length > 0 && (
        <Disclosure summary={`Opened (${opened.length})`}>
          <ul>{opened.map((p) => row(p, false))}</ul>
        </Disclosure>
      )}
    </div>
  );
}
```
The `⭐ Starred` chip's accessible name is the text "⭐ Starred", which the test uses.

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npx vitest run src/screens/Applications.test.tsx src/screens/Jobs.test.tsx && npm run typecheck && npm run lint`
Expected: 9 passed; clean.

- [ ] **Step 6: Commit**

```bash
git add web/src/screens/Applications.tsx web/src/screens/Applications.test.tsx web/src/screens/Jobs.tsx web/src/screens/Jobs.test.tsx
git commit -m "Add Applications (funnel, week target, board) and Jobs inbox screens"
```

---

### Task 10: Outreach screen with "Copy prompt" fallback

**Prerequisite:** Plan 3 Task 1 is committed, so `prompts/outreach.md` exists at the repo root. Check: `test -f ../prompts/outreach.md && echo ok` (from `web/`) → `ok`. If it prints nothing, stop: run Plan 3 Task 1 first. This task never creates or edits anything in `prompts/` (Plan 3 owns those files).

**Files:**
- Modify: `web/src/screens/Outreach.tsx` (replace the starter)
- Create: `web/src/lib/outreachPrompt.ts`, `web/src/lib/outreachPrompt.test.ts`, `web/src/screens/Outreach.test.tsx`

**Interfaces:**
- Consumes: `prompts/outreach.md` via Vite `?raw` (placeholders `outreach_id, job_url, company, resume_path, resume_note, lockin`, defined by Plan 3 Task 1); `renderTemplate` (Task 2); hooks `useNow, useOutreach, useContacts, useLaunchRequests, useQueueOutreach, useUpdateOutreach, useRequestLaunch`; `outreachPhase, sortOutreach, followUpOn, PHASE_LABEL, isJobUrl, hostOf, safeHref, localDay, shortDate`; primitives incl. `CopyButton`, `ExternalLink`
- Produces: `outreachPrompt.copyPrompt(o: Outreach): string` (fills `resume_path` = "(your Mac will pick the resume)", `resume_note` = "", `lockin` = "~/.lockin/venv/bin/lockin", as agreed with Plan 3); default export `Outreach` (route `/outreach`; primary = paste card)

Layout: **paste card** (job link input + Draft emails) → one card per outreach (due follow-ups first): company (or URL host), status badge, role; while waiting for the Mac: "Queued for Mac" / "Opened on Mac" / "Launch failed" + error, **Copy prompt** (and **Try again** when failed or never queued); each contact: name · title, email + confidence + Copy email, then the draft (subject, body, Copy subject, Copy body, LinkedIn, why) behind a "Draft" tap; **Sent** on drafted cards (sets `sent_on = today`, `follow_up_on = today + 5`); **Replied** / **Close** on sent cards → replied/closed cards behind "Done (n)".

The web can't see the Mac's resume folders, so the copied prompt says the Mac will pick the resume. Badge text per launcher state: `queued` → "Queued for Mac", `launched` → "Opened on Mac" (Errata E1), `failed` → "Launch failed" plus the error (max 500 chars from the launcher, shown in full) and **Try again**, which inserts a new `launch_requests` row.

- [ ] **Step 1: Write the failing tests**

`web/src/lib/outreachPrompt.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { Outreach } from '../data/types';
import { copyPrompt } from './outreachPrompt';

const o: Outreach = {
  id: 'o-123', job_url: 'https://jobs.lever.co/acme/1?a=1&b=2', company: null, role: null, resume_path: null,
  status: 'queued', sent_on: null, follow_up_on: null, created_at: '2026-10-14T12:00:00Z',
};

describe('copyPrompt', () => {
  it('renders the shared template with the phone values from the Plan 3 contract', () => {
    const p = copyPrompt(o);
    expect(p).toContain('~/.lockin/venv/bin/lockin save-outreach --id o-123');
    expect(p).toContain('https://jobs.lever.co/acme/1?a=1&b=2');
    expect(p).toContain('Resume to use: (your Mac will pick the resume)');
    expect(p).toContain('unknown (read it from the posting)');
    expect(p).not.toContain('{{');
  });
  it('uses the company when known', () => {
    expect(copyPrompt({ ...o, company: 'Acme' })).toContain('Company (best guess, confirm it on the posting): Acme');
  });
});
```

`web/src/screens/Outreach.test.tsx`:
```tsx
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createDemoApi } from '../data/demo';
import { followUpOn } from '../lib/outreach';
import { localDay } from '../lib/time';
import { renderWithData } from '../test/render';
import Outreach from './Outreach';

const cardFor = async (name: string) => (await screen.findByRole('heading', { level: 2, name })).closest('section') as HTMLElement;

describe('Outreach', () => {
  it('rejects a pasted string that is not a job link', async () => {
    const api = createDemoApi();
    const spy = vi.spyOn(api, 'queueOutreach');
    renderWithData(<Outreach />, { api });
    await userEvent.type(await screen.findByRole('textbox', { name: 'Job link' }), 'javascript:alert(1){Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Paste a full job link');
    expect(spy).not.toHaveBeenCalled();
  });
  it('a pasted link becomes a card queued for the Mac', async () => {
    const api = createDemoApi();
    const spy = vi.spyOn(api, 'queueOutreach');
    renderWithData(<Outreach />, { api });
    await userEvent.type(await screen.findByRole('textbox', { name: 'Job link' }), ' https://jobs.lever.co/acme/42 {Enter}');
    expect(spy).toHaveBeenCalledWith({ job_url: 'https://jobs.lever.co/acme/42' });
    const card = await cardFor('jobs.lever.co');
    expect(within(card).getByText('Queued for Mac')).toBeInTheDocument();
  });
  it('Copy prompt copies the rendered template', async () => {
    const user = userEvent.setup();
    renderWithData(<Outreach />);
    const card = await cardFor('Ramp');
    expect(within(card).getByText('Queued for Mac')).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Copy prompt' }));
    expect(await navigator.clipboard.readText()).toContain('save-outreach --id o2');
    expect(within(card).getByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });
  it('drafted card: contacts, drafts behind a tap, Sent sets the follow-up', async () => {
    const api = createDemoApi();
    const spy = vi.spyOn(api, 'updateOutreach');
    renderWithData(<Outreach />, { api });
    const card = await cardFor('Stripe');
    expect(within(card).getByText('Dana Reyes')).toBeInTheDocument();
    expect(within(card).getByText('dreyes@stripe.com')).toBeInTheDocument();
    expect(within(card).getAllByText('Draft')).toHaveLength(2);
    await userEvent.click(within(card).getByRole('button', { name: 'Sent' }));
    const today = localDay(new Date());
    expect(spy).toHaveBeenCalledWith('o1', { status: 'sent', sent_on: today, follow_up_on: followUpOn(today) });
  });
  it('never links a non-http LinkedIn value', async () => {
    const api = createDemoApi();
    const base = await api.listContacts();
    api.listContacts = async () => base.map((c) => ({ ...c, linkedin_url: 'javascript:alert(1)' }));
    const { container } = renderWithData(<Outreach />, { api });
    await cardFor('Stripe');
    expect(container.querySelector('a[href^="javascript"]')).toBeNull();
  });
  it('a launched request shows Opened on Mac', async () => {
    const api = createDemoApi();
    const reqs = await api.listLaunchRequests();
    api.listLaunchRequests = async () => reqs.map((r) => ({ ...r, status: 'launched' as const }));
    renderWithData(<Outreach />, { api });
    expect(within(await cardFor('Ramp')).getByText('Opened on Mac')).toBeInTheDocument();
  });
  it('failed launch shows the error and Try again', async () => {
    const api = createDemoApi();
    const reqs = await api.listLaunchRequests();
    api.listLaunchRequests = async () => reqs.map((r) => ({ ...r, status: 'failed' as const, error: 'osascript failed (1): Not authorized' }));
    const spy = vi.spyOn(api, 'requestLaunch');
    renderWithData(<Outreach />, { api });
    const card = await cardFor('Ramp');
    expect(within(card).getByText('osascript failed (1): Not authorized')).toBeInTheDocument();
    await userEvent.click(within(card).getByRole('button', { name: 'Try again' }));
    expect(spy).toHaveBeenCalledWith('outreach', { outreach_id: 'o2', job_url: 'https://jobs.ashbyhq.com/ramp/7d1c' });
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest run src/lib/outreachPrompt.test.ts src/screens/Outreach.test.tsx`
Expected: FAIL with `Failed to resolve import "./outreachPrompt"` and missing elements.

- [ ] **Step 3: Implement the prompt helper**

`web/src/lib/outreachPrompt.ts`:
```ts
import template from '../../../prompts/outreach.md?raw';
import type { Outreach } from '../data/types';
import { renderTemplate } from './prompt';

// Same template and placeholders as the launcher (Plan 3). Values fixed by the contract with Plan 3.
export const WEB_RESUME_PATH = '(your Mac will pick the resume)';
export const WEB_LOCKIN = '~/.lockin/venv/bin/lockin';

export function copyPrompt(o: Outreach): string {
  return renderTemplate(template, {
    outreach_id: o.id,
    job_url: o.job_url,
    company: o.company ?? 'unknown (read it from the posting)',
    resume_path: WEB_RESUME_PATH,
    resume_note: '',
    lockin: WEB_LOCKIN,
  });
}
```

- [ ] **Step 4: Implement the screen**

`web/src/screens/Outreach.tsx`:
```tsx
import { useState, type FormEvent } from 'react';
import {
  useContacts, useLaunchRequests, useNow, useOutreach, useQueueOutreach, useRequestLaunch, useUpdateOutreach,
} from '../data/hooks';
import type { Contact, Outreach as OutreachRow } from '../data/types';
import { PHASE_LABEL, followUpOn, outreachPhase, sortOutreach, type Phase } from '../lib/outreach';
import { copyPrompt } from '../lib/outreachPrompt';
import { localDay, shortDate } from '../lib/time';
import { hostOf, isJobUrl, safeHref } from '../lib/url';
import { Badge, Button, Card, CardHead, CopyButton, Disclosure, Empty, ExternalLink, LoadError, Skeleton } from '../ui/primitives';

const TONE: Record<Phase['kind'], 'accent' | 'warn' | 'danger' | 'muted'> = {
  not_queued: 'warn', queued: 'muted', on_mac: 'muted', failed: 'danger', drafted: 'accent',
  sent: 'muted', due: 'warn', replied: 'accent', closed: 'muted',
};
const CONFIDENCE_TONE = { verified: 'accent', pattern: 'muted', guess: 'warn' } as const;

function ContactBlock({ c }: { c: Contact }) {
  return (
    <div className="contact">
      <p className="contact-name">{c.name}{c.title && <span className="muted small"> · {c.title}</span>}</p>
      {c.email_guess && (
        <div className="row-actions">
          <span className="email">{c.email_guess}</span>
          {c.email_confidence && <Badge tone={CONFIDENCE_TONE[c.email_confidence]}>{c.email_confidence}</Badge>}
          <CopyButton text={c.email_guess} label="Copy email" />
        </div>
      )}
      <Disclosure summary="Draft">
        {c.draft_subject && <p><b>{c.draft_subject}</b></p>}
        {c.draft_body && <pre className="draft-body">{c.draft_body}</pre>}
        <div className="row-actions">
          {c.draft_subject && <CopyButton text={c.draft_subject} label="Copy subject" />}
          {c.draft_body && <CopyButton text={c.draft_body} label="Copy body" />}
          {safeHref(c.linkedin_url) && <ExternalLink className="btn btn-quiet" href={c.linkedin_url}>LinkedIn</ExternalLink>}
        </div>
        {c.why && <p className="muted small">{c.why}</p>}
      </Disclosure>
    </div>
  );
}

function OutreachCard({ o, phase, contacts, prompt, busy, onSent, onReplied, onClose, onRetry }: {
  o: OutreachRow; phase: Phase; contacts: Contact[]; prompt: () => string; busy: boolean;
  onSent: () => void; onReplied: () => void; onClose: () => void; onRetry: () => void;
}) {
  const headId = `out-${o.id}`;
  const waiting = phase.kind === 'queued' || phase.kind === 'on_mac' || phase.kind === 'failed' || phase.kind === 'not_queued';
  const followUp = (phase.kind === 'sent' || phase.kind === 'due') && o.follow_up_on ? `Follow up ${shortDate(o.follow_up_on)}` : null;
  return (
    <Card aria-labelledby={headId}>
      <CardHead id={headId} title={o.company ?? hostOf(o.job_url)}>
        <Badge tone={TONE[phase.kind]}>{PHASE_LABEL[phase.kind]}</Badge>
      </CardHead>
      {(o.role || followUp) && <p className="muted small">{[o.role, followUp].filter(Boolean).join(' · ')}</p>}
      {phase.kind === 'failed' && <p className="error small">{phase.error}</p>}
      <div className="row-actions">
        {(phase.kind === 'failed' || phase.kind === 'not_queued') && <Button onClick={onRetry} disabled={busy}>Try again</Button>}
        {waiting && <CopyButton text={prompt()} label="Copy prompt" />}
        {phase.kind === 'drafted' && <Button variant="primary" onClick={onSent} disabled={busy}>Sent</Button>}
        {(phase.kind === 'sent' || phase.kind === 'due') && (
          <>
            <Button variant="primary" onClick={onReplied} disabled={busy}>Replied</Button>
            <Button variant="quiet" onClick={onClose} disabled={busy}>Close</Button>
          </>
        )}
        <ExternalLink className="btn btn-quiet" href={o.job_url}>Posting</ExternalLink>
      </div>
      {contacts.map((c) => <ContactBlock key={c.id} c={c} />)}
    </Card>
  );
}

export default function Outreach() {
  const now = useNow();
  const today = localDay(now);
  const outreach = useOutreach();
  const contacts = useContacts();
  const requests = useLaunchRequests();
  const queue = useQueueOutreach();
  const update = useUpdateOutreach();
  const launch = useRequestLaunch();
  const [url, setUrl] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const reqs = requests.data ?? [];
  const list = sortOutreach(outreach.data ?? [], reqs, today);
  const active = list.filter((o) => o.status !== 'replied' && o.status !== 'closed');
  const finished = list.filter((o) => o.status === 'replied' || o.status === 'closed');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const u = url.trim();
    if (!isJobUrl(u)) {
      setErr('Paste a full job link (https://…).');
      return;
    }
    setErr(null);
    queue.mutate({ job_url: u }, { onSuccess: () => setUrl('') });
  };

  const card = (o: OutreachRow) => (
    <OutreachCard key={o.id} o={o} phase={outreachPhase(o, reqs, today)}
      contacts={(contacts.data ?? []).filter((c) => c.outreach_id === o.id)}
      prompt={() => copyPrompt(o)} busy={update.isPending || launch.isPending}
      onSent={() => update.mutate({ id: o.id, patch: { status: 'sent', sent_on: today, follow_up_on: followUpOn(today) } })}
      onReplied={() => update.mutate({ id: o.id, patch: { status: 'replied' } })}
      onClose={() => update.mutate({ id: o.id, patch: { status: 'closed' } })}
      onRetry={() => launch.mutate({ kind: 'outreach', payload: { outreach_id: o.id, job_url: o.job_url } })} />
  );

  return (
    <div className="screen">
      <header className="screen-head"><h1>Outreach</h1></header>

      <Card data-primary aria-labelledby="new-h">
        <CardHead id="new-h" title="New" />
        <form className="inline-form" onSubmit={submit} noValidate>
          <input aria-label="Job link" type="url" inputMode="url" placeholder="Paste a job link" value={url}
            aria-invalid={err ? true : undefined} aria-describedby={err ? 'url-err' : undefined}
            onChange={(e) => setUrl(e.target.value)} />
          <Button type="submit" variant="primary" disabled={queue.isPending}>Draft emails</Button>
        </form>
        {err && <p id="url-err" role="alert" className="error small">{err}</p>}
      </Card>

      {outreach.isPending ? (
        <Skeleton label="Loading outreach" />
      ) : outreach.isError ? (
        <LoadError what="outreach" onRetry={() => void outreach.refetch()} />
      ) : list.length === 0 ? (
        <Empty>No outreach yet.</Empty>
      ) : (
        active.map(card)
      )}
      {finished.length > 0 && <Disclosure summary={`Done (${finished.length})`}>{finished.map(card)}</Disclosure>}
    </div>
  );
}
```
An `<input type="url">` has the ARIA role `textbox`, which the tests rely on. `noValidate` keeps the browser's own URL popup from replacing the short inline error.

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npx vitest run src/lib/outreachPrompt.test.ts src/screens/Outreach.test.tsx && npm run typecheck && npm run lint`
Expected: 9 passed (requires Errata E1 for "Opened on Mac"); clean. Then the whole suite: `npm test` → all pass.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/outreachPrompt.ts web/src/lib/outreachPrompt.test.ts web/src/screens/Outreach.tsx web/src/screens/Outreach.test.tsx
git commit -m "Add Outreach screen with Mac queue state, drafts and Copy prompt"
```

---

### Task 11: Playwright smoke test and UI quality pass

**Files:**
- Create: `web/playwright.config.ts`, `web/e2e/smoke.spec.ts`, `web/e2e/flows.spec.ts`
- Modify: `.github/workflows/ci.yml` (add e2e to the `web` job); any of `web/src/styles/*.css`, `web/src/ui/*.tsx`, `web/src/screens/*.tsx` as the review requires (keep their unit tests green)

**Interfaces:**
- Consumes: every screen (Tasks 4–10), demo mode (`npm run dev:demo`, port 5199)
- Produces: `npm run e2e` (4 projects: phone-dark, phone-light, desktop-dark, desktop-light); screenshots in `web/e2e/__screens__/<project>/<screen>.png` (git-ignored)

**Acceptance checks (all enforced by `smoke.spec.ts` on all 4 projects, for all 7 screens):**
1. No horizontal scroll: `scrollWidth - clientWidth <= 0` at 390 px and 1280 px.
2. Tap targets: every visible `button`, `a[href]`, `input`, `select`, `summary` is at least 44 × 44 px (checkboxes count their wrapping `<label>`).
3. Visible focus: the first Tab stop has a non-`none` outline.
4. Contrast and a11y: axe (`wcag2a, wcag2aa, wcag21aa, wcag22aa`) reports no violations (covers color contrast AA, names, roles, labels).
5. Primary above the fold: the `[data-primary]` element's top edge plus its first 100 px fit inside the viewport above the bottom tab bar (phone) / viewport (desktop).
6. Short copy: every button's text is at most 24 characters, and the screen has exactly one `<h1>`.

- [ ] **Step 1: Write the Playwright config and specs**

`web/playwright.config.ts`:
```ts
import { defineConfig, devices } from '@playwright/test';

const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 };
const desktop = { viewport: { width: 1280, height: 800 } };

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:5199', trace: 'retain-on-failure' },
  webServer: { command: 'npm run dev:demo', url: 'http://localhost:5199', reuseExistingServer: !process.env.CI, timeout: 60_000 },
  projects: [
    { name: 'phone-dark', use: { ...devices['Desktop Chrome'], ...phone, colorScheme: 'dark' } },
    { name: 'phone-light', use: { ...devices['Desktop Chrome'], ...phone, colorScheme: 'light' } },
    { name: 'desktop-dark', use: { ...devices['Desktop Chrome'], ...desktop, colorScheme: 'dark' } },
    { name: 'desktop-light', use: { ...devices['Desktop Chrome'], ...desktop, colorScheme: 'light' } },
  ],
});
```

`web/e2e/smoke.spec.ts`:
```ts
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const SCREENS = [
  { name: 'today', path: '/', heading: /^Day \d+$/ },
  { name: 'leetcode', path: '/leetcode', heading: 'LeetCode' },
  { name: 'projects', path: '/projects', heading: 'Projects' },
  { name: 'apps', path: '/apps', heading: 'Applications' },
  { name: 'jobs', path: '/jobs', heading: 'Jobs' },
  { name: 'outreach', path: '/outreach', heading: 'Outreach' },
  { name: 'settings', path: '/settings', heading: 'Settings' },
];

for (const s of SCREENS) {
  test(`${s.name}: fits, primary above the fold, targets, copy, a11y`, async ({ page }, info) => {
    await page.goto(s.path);
    await expect(page.getByRole('heading', { level: 1, name: s.heading })).toBeVisible();
    await expect(page.locator('[role="status"][aria-label^="Loading"]')).toHaveCount(0);
    await expect(page.locator('h1')).toHaveCount(1);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, 'horizontal scroll').toBeLessThanOrEqual(0);

    const box = await page.locator('[data-primary]').first().boundingBox();
    const vh = page.viewportSize()!.height;
    const navH = info.project.name.startsWith('phone') ? 64 : 0;
    expect(box, 'primary element exists').not.toBeNull();
    expect(box!.y + Math.min(box!.height, 100), 'primary above the fold').toBeLessThanOrEqual(vh - navH);

    const small = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('button, a[href], input, select, summary')]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === 'hidden') return false;
          if (el.closest('.skip-link')) return false;
          const target = (el as HTMLInputElement).type === 'checkbox' && el.closest('label') ? el.closest('label')!.getBoundingClientRect() : r;
          return target.height < 44 || target.width < 44;
        })
        .map((el) => `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40)}"`));
    expect(small, 'tap targets under 44px').toEqual([]);

    const longLabels = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('button')].map((b) => (b.textContent ?? '').trim()).filter((t) => t.length > 24));
    expect(longLabels, 'button labels over 24 chars').toEqual([]);

    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(axe.violations.map((v) => `${v.id} (${v.nodes.length}): ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);

    await page.screenshot({ path: `e2e/__screens__/${info.project.name}/${s.name}.png`, fullPage: true });
  });
}

test('every tab is reachable from the navigation', async ({ page }) => {
  await page.goto('/');
  for (const [label, path] of [['LeetCode', '/leetcode'], ['Projects', '/projects'], ['Apps', '/apps'], ['Jobs', '/jobs'], ['Outreach', '/outreach'], ['Today', '/']] as const) {
    await page.getByRole('link', { name: label, exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp(`${path === '/' ? '/' : path}$`));
  }
  await page.getByRole('link', { name: /^Settings/ }).first().click();
  await expect(page).toHaveURL(/\/settings$/);
});

test('keyboard focus is visible', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  const focus = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    return { tag: el.tagName, outline: getComputedStyle(el).outlineStyle };
  });
  expect(focus.tag).not.toBe('BODY');
  expect(focus.outline).not.toBe('none');
});
```

`web/e2e/flows.spec.ts`:
```ts
import { expect, test } from '@playwright/test';

test('rate a fresh solve with one tap', async ({ page }) => {
  await page.goto('/');
  const group = page.getByRole('group', { name: /How did .* go\?/ });
  await expect(group).toHaveCount(1);
  await group.getByRole('button', { name: 'Nailed it' }).click();
  await expect(group).toHaveCount(0);
});

test('paste a job link and see it queued for the Mac', async ({ page }) => {
  await page.goto('/outreach');
  await page.getByRole('textbox', { name: 'Job link' }).fill('https://jobs.lever.co/acme/42');
  await page.getByRole('button', { name: 'Draft emails' }).click();
  const card = page.locator('section', { has: page.getByRole('heading', { name: 'jobs.lever.co' }) });
  await expect(card.getByText('Queued for Mac')).toBeVisible();
});

test('cold email from a posting lands on Outreach', async ({ page }) => {
  await page.goto('/jobs');
  await page.getByRole('button', { name: 'Cold email' }).first().click();
  await expect(page).toHaveURL(/\/outreach$/);
  await expect(page.getByText('Queued for Mac').first()).toBeVisible();
});
```

- [ ] **Step 2: Install the browser and run it once to see the starting point**

Run: `npx playwright install chromium && npm run e2e`
Expected: the runner starts the demo server and runs 4 projects × 12 tests. Some smoke checks may fail at this point; that's the input to the review. Screenshots land in `e2e/__screens__/` for every screen whose checks got that far (all 7 if only axe or targets fail, since those run before the screenshot... if a test fails early, take screenshots manually with `npx playwright test --project=phone-dark -g today` after temporarily moving the screenshot line to the top, or use the Playwright trace).

- [ ] **Step 3: Load the design skills**

Call the Skill tool four times and follow each skill's guidance for the review:
- `frontend-design:frontend-design`
- `better-interface`
- `better-accessibility`
- `web-design-guidelines`

- [ ] **Step 4: Review every screen at 390 and 1280, dark and light**

Open each PNG in `e2e/__screens__/{phone-dark,phone-light,desktop-dark,desktop-light}/` with the Read tool (28 images). For each screen, write down (in your working notes, not a file) concrete issues against these questions, using the skills' checklists:
- Is the one primary thing obvious in under 5 seconds? Does anything compete with it (extra borders, second accent, badges)?
- Is any text longer than it needs to be? Every heading 1–2 words, button ≤ 3 words, empty state ≤ 8 words; cut anything that isn't actionable today.
- Is the accent used only for the primary action, the active tab, progress and done states? Are difficulty colors only on difficulty labels?
- Spacing and alignment on the 4/8/12/16/24 px scale; consistent card padding; no orphaned single words in headings at 390 px.
- Desktop at 1280: does the 760 px column look intentional? If a screen has two independent cards (Today: set + idea/links; Applications: week + funnel), consider a two-column grid at ≥ 1100 px, keeping the primary card first and on the left.
- Light mode parity: same hierarchy, borders visible, no washed-out accent.
- Motion: only the refresh spinner; it stops under `prefers-reduced-motion`.

- [ ] **Step 5: Fix the issues**

Make the changes in `app.css`/`tokens.css` first, components second. Keep every Vitest test passing (`npm test`) and don't rename accessible names the tests rely on unless you update those tests in the same change. Re-run `npm run e2e` and re-read the screenshots after each round. Stop when: all 6 acceptance checks pass on all 4 projects, `flows.spec.ts` passes, and a final read of all 28 screenshots finds nothing you'd change.

- [ ] **Step 6: Add e2e to CI**

Append to the `web` job's steps in `.github/workflows/ci.yml` (after `npm run build`):
```yaml
      - run: npx playwright install --with-deps chromium
      - run: npm run e2e
        env: { CI: "true" }
```

- [ ] **Step 7: Run everything**

Run: `npm run lint && npm run typecheck && npm test && npm run build && npm run e2e`
Expected: all green; e2e prints `48 passed` (12 tests × 4 projects).

- [ ] **Step 8: Commit**

```bash
git add web/playwright.config.ts web/e2e/smoke.spec.ts web/e2e/flows.spec.ts .github/workflows/ci.yml web/src
git commit -m "Add Playwright smoke and flow tests; polish UI at phone and desktop sizes"
```

---

### Task 12: Vercel deploy config and setup docs

**Files:**
- Create: `web/vercel.json`, `web/tests/deploy.test.ts`
- Modify: `docs/setup.md` (append a "Web app (Vercel)" section; create the file with a `# Lock In setup` heading if it doesn't exist yet)

**Interfaces:**
- Consumes: the build (`npm run build` → `dist/`), `web/api/sync-leetcode.ts` (Task 5)
- Produces: Vercel project settings: root directory `web`, framework Vite, env `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`. The actual deploy happens in the batched setup session with Adam, not in this task's automated steps.

- [ ] **Step 1: Write the failing test**

`web/tests/deploy.test.ts`:
```ts
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const WEB = fileURLToPath(new URL('../', import.meta.url));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

describe('deploy config', () => {
  it('SPA rewrite sends app routes to index.html but leaves /api alone', () => {
    const v = JSON.parse(readFileSync(join(WEB, 'vercel.json'), 'utf8'));
    expect(v.rewrites).toEqual([{ source: '/((?!api/).*)', destination: '/index.html' }]);
    const re = new RegExp(`^${v.rewrites[0].source}$`);
    expect(re.test('/outreach')).toBe(true);
    expect(re.test('/api/sync-leetcode')).toBe(false);
  });
  it('api/ holds only deployable functions (no tests)', () => {
    expect(readdirSync(join(WEB, 'api'))).toEqual(['sync-leetcode.ts']);
  });
  it('no service-role key is referenced from browser code', () => {
    const hits = files(join(WEB, 'src')).filter((f) => /service_role|SERVICE_KEY/i.test(readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/deploy.test.ts`
Expected: FAIL with `ENOENT … vercel.json`.

- [ ] **Step 3: Write `vercel.json`**

`web/vercel.json`:
```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "vite",
  "installCommand": "npm ci",
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "rewrites": [{ "source": "/((?!api/).*)", "destination": "/index.html" }],
  "headers": [
    { "source": "/sw.js", "headers": [{ "key": "Cache-Control", "value": "no-cache" }] },
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" }
      ]
    }
  ]
}
```
Vercel serves real files (assets, `sw.js`, icons) before applying rewrites, so only app routes like `/outreach` fall through to `index.html`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run tests/deploy.test.ts && npm test`
Expected: 3 passed; whole suite green.

- [ ] **Step 5: Append the deploy section to `docs/setup.md`**

```markdown
## Web app (Vercel)

Done together in the setup session. Nothing here is automated.

1. **Supabase auth settings** (Dashboard → Authentication):
   - URL Configuration → Site URL: `https://<project>.vercel.app`; Redirect URLs: add the same URL and `http://localhost:5173`.
   - Email Templates → Magic Link: include the code so the iPhone home-screen app can sign in without leaving itself:
     `<p>Your Lock In code: <strong>{{ .Token }}</strong></p><p><a href="{{ .ConfirmationURL }}">Or sign in with this link</a></p>`
   - Sign-ups stay disabled (Plan 1 Task 12).
2. **Create the Vercel project** (Hobby): vercel.com → Add New → Project → import `adamkuhn1/lock-in`.
   - Root Directory: `web`. Keep "Include files outside the root directory in the Build Step" **on** (the app imports `../prompts/outreach.md`).
   - Framework: Vite (auto-detected from `web/vercel.json`).
   - Environment variables (Production and Preview), all from Supabase → Settings → API:
     `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (browser, build-time), `SUPABASE_URL`, `SUPABASE_ANON_KEY` (the `/api/sync-leetcode` function). Never add the service-role key here.
3. **Author check before the first push** (Vercel Hobby blocks other authors): `git log -1 --format='%an <%ae>'` must print `adamkuhn1 <184679495+adamkuhn1@users.noreply.github.com>`. Don't change git config; if it differs, stop and ask.
4. **Deploy**: pushing to the default branch deploys. Open the URL, sign in with the emailed code.
5. **Tell the worker the URL**: in the app, Settings → Mac → App URL = the Vercel URL (nudges open it when tapped).
6. **Install**: iPhone Safari → Share → Add to Home Screen, open it, sign in with the code. Mac: Safari → File → Add to Dock (or Chrome → Install Lock In).
7. **Check sync on open**: solve any problem on LeetCode, open the app, tap Refresh: the matching item in today's set checks itself off within a few seconds (if it isn't in today's set, it shows under LeetCode → History).

Local development: `cd web && npm run dev:demo` (fixture data, no Supabase). Against the real project: copy `.env.example` to `.env.local`, fill the `VITE_` values, `npm run dev`. `/api/sync-leetcode` only runs under `vercel dev` or on Vercel; under plain `npm run dev` the refresh button quietly reports an error and everything else works.
```

- [ ] **Step 6: Commit**

```bash
git add web/vercel.json web/tests/deploy.test.ts docs/setup.md
git commit -m "Add Vercel config and web deploy steps to setup docs"
```

---

## Self-Review Notes

- **Spec coverage:**
  - §1 UX principle, design skills, screenshot loop → Global Constraints; Task 11 (skills, 28 screenshots, 6 enforced checks).
  - §3 web stack, PWA install, Vercel Hobby, commit author → Tasks 1, 12.
  - §3 Auth (magic link, sign-ups off, RLS) → Tasks 3 (`supabaseAuth`, `shouldCreateUser:false`), 4 (`SignIn`, link **or** code — needed for the iPhone PWA), 12 (email template).
  - §4 tables/columns → `types.ts` mirrors Plan 1's `0001_init.sql`; writes limited per Global Constraints.
  - §5.1 Today (day counter, three streaks, ordered set with links, check-off on sync, one-tap rating, idea with Done/commit/swap, follow-ups and postings hidden at zero) → Tasks 2, 6.
  - §5.2 LeetCode (roadmap colored by level incl. `available`, review queue, heatmap, daily count, focus override) → Tasks 2, 7.
  - §5.3 Projects (last commit, 30-day strip, ideas add/reorder/done/drop, Suggest improvements) → Tasks 2, 8.
  - §5.4 Applications (funnel with conversion and 582/54/13/5, week vs target, board by stage, search, Open sheet) → Tasks 2, 9.
  - §5.5 Jobs (inbox, ⭐/internship/new grad/term/location chips, Open/Cold email/Dismiss) → Tasks 2, 9.
  - §5.6 Outreach (paste box, cards, contacts, drafts with copy buttons, Sent/Replied, follow-up = sent + 5 d, Queued for Mac, Copy prompt) → Tasks 2, 10.
  - §5.7 Settings (nudge times, counts, targets, projects, resume folder, sync status with last synced and stale badge, stage mapping) → Tasks 2, 8. `ntfy_topic` is shown nowhere: it's a secret-ish value set by the seed script, and the decisions list doesn't include it among web-writable settings.
  - §6 sync on open (Vercel function, JWT auth, once a minute, on open + refresh) → Tasks 3 (`useSyncOnOpen`), 4 (Refresh), 5. Rating rules and "unrated counts toward the streak" → Tasks 2, 6.
  - §8 steps 1, 5, 6 → Tasks 9, 10. Resume matching and the launcher are Plan 3.
  - §10 status→stage mapping shown in Settings, kept equal to the worker by a drift test → Tasks 2, 8.
  - §12 last synced + quiet stale badge → Tasks 2, 4 (dot on the Settings link), 8.
  - §13 Vitest helpers, Playwright at 390/1280 light/dark walking each tab, CI → Tasks 1, 2, 11. Demo mode replaces "signs in with a test session" (decision).
- **Placeholder scan:** none. The seven starter screens in Task 4 are complete, compiling components that later tasks replace wholesale; angle-bracket values appear only in human setup docs (`<project>`, `<ref>`).
- **Type consistency:** `DataApi` method names match across `api.ts`, `supabase.ts`, `demo.ts`, hooks and tests; `SyncResult` (client) vs `ServerSyncResult` (function) are intentionally separate, the client adds the `error` variant; `copyPrompt` placeholders match Plan 3 Task 1's `outreach.md` exactly (`outreach_id, job_url, company, resume_path, resume_note, lockin`).
- **Clarifications made in this plan:** focus override writes `lc_focus_topic`/`lc_focus_since` (spec §5/§6 require it; it takes effect with the next generated set); Open on a posting marks it `seen`, which moves it to "Opened"; the funnel counts `closed` rows as applied only (the Sheet loses the stage a rejection came from); the iPhone PWA signs in with the emailed code; `web/api` tests live in `web/tests/api` so Vercel doesn't deploy them.

---

## Errata for Tasks 1–5

Tasks 1–5 were frozen while being built. Apply these corrections (they come from the Plan 3 contract review); Tasks 8 and 10 depend on E1 and E2.

- **E1 (Task 2, `web/src/lib/outreach.ts`)**: the launcher's `launched` state is shown as "Opened on Mac". In `PHASE_LABEL`, change `on_mac: 'Drafting on Mac'` to `on_mac: 'Opened on Mac'`. No test change is needed (`outreach.test.ts` asserts kinds, not labels).
- **E2 (Task 2, `web/src/lib/ideas.ts` and `ideas.test.ts`)**: Projects cards must show "Opened on Mac" too, so `suggestState` reports `launched` instead of `idle`:
  ```ts
  export function suggestState(requests: LaunchRequest[], projectId: string):
    { kind: 'idle' } | { kind: 'queued' } | { kind: 'launched' } | { kind: 'failed'; error: string } {
    const mine = requests
      .filter((r) => r.kind === 'suggest_ideas' && r.payload.project_id === projectId)
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    const r = mine[0];
    if (!r) return { kind: 'idle' };
    if (r.status === 'queued') return { kind: 'queued' };
    if (r.status === 'launched') return { kind: 'launched' };
    return { kind: 'failed', error: r.error ?? 'Unknown error' };
  }
  ```
  In `ideas.test.ts` → `suggestState`, change the line
  `expect(suggestState([R('launched', '2026-10-14T12:00:00Z')], '27b')).toEqual({ kind: 'idle' });`
  to `expect(suggestState([R('launched', '2026-10-14T12:00:00Z')], '27b')).toEqual({ kind: 'launched' });`
  and update the Task 2 Interfaces line for `ideas.suggestState` to include `{kind: 'launched'}`.
- **Contract check, no change needed (Task 3)**: `createSupabaseApi().queueOutreach` already awaits the `outreach` insert (`.select().single()`, which returns its id) before inserting `launch_requests {kind:'outreach', payload:{outreach_id, job_url}}`, and `supabase.test.ts › queueOutreach inserts the outreach, then a launch request for it` pins that order (`[['POST','/rest/v1/outreach'], ['POST','/rest/v1/launch_requests']]`, with the second body carrying the id returned by the first). The demo implementation does the same in memory.
- **Contract check, no change needed (Tasks 3, 8)**: the `suggest_ideas` payload is exactly `{project_id}`. No path is ever sent from the web.
