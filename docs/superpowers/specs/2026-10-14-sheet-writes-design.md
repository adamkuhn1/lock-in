# Lock In: write to the application Sheet

Date: 2026-10-14 · Status: design approved by Adam in chat (including Editor access for the service account and the Vercel server secret). This doc is for his review.

## Purpose
Today Lock In only reads Adam's tracker Sheet (tab **Applications**, a Google Sheets Table named `ApplicationsTable`). The header row is row 5, and Status and Priority are dropdown chips. Adam wants two writes from the app:
1. **I applied**: add a row for a posting.
2. **Change status**: update an existing row's Status.

Both must show up in the app immediately.

## Decisions
| Topic | Decision |
|---|---|
| Write path | Instant. A Vercel function `/api/sheet` writes via the Sheets API as the existing service account `lockin-sheet-reader@lock-in-511620.iam.gserviceaccount.com`, which now has Editor on the Sheet (done 2026-10-14). |
| Secrets | `GOOGLE_SA_JSON` and `SHEET_ID` are stored as Vercel server env vars (Production and Preview). They are never prefixed `VITE_`, never sent to the browser and never logged. The function only ever writes to that one `SHEET_ID`. |
| Auth | Same as `/api/sync-leetcode`. The function requires `Authorization: Bearer <supabase access token>` and verifies it with Supabase (`auth.getUser`). The user id must equal the owner of the settings row; otherwise it returns 401/403. |
| Scope | Only the Applications tab. Only the Status cell, for status changes. Only a new row at the end of the table, for applies. It never rewrites other cells, formatting, formulas or other tabs. |
| Status values | The allowed options are read from the Status column's dropdown (data validation) at request time. The picker shows exactly those values. If a value isn't in the dropdown, the function refuses it with "That status isn't in your Sheet's Status dropdown. Add it there first." Adam's planned wording ("Rejected after OA", "Rejected after interview") should be added to the dropdown by him; the setup note says so. |
| Row identity | The sync stores each application's 1-based Sheet row number (`applications.sheet_row`). Before writing, the function re-reads that row and checks that Company and Role still match, normalized (trim and lowercase). If not, it searches the tab for the single row matching Company and Role. If there are zero or multiple matches, it returns 409 "Couldn't find that row in your Sheet; it may have moved. Refresh and try again." It never guesses. |
| Columns | Columns are found by header name, using the same aliases as `worker/lockin_worker/sheet.py` `COLUMNS` ("Company", "Role / Title", "Track", "Start / Term", "Location", "Status", "Priority", "Applied date"). Fixed letters are never used. |
| New row | Company, Role, Term and Location come from the posting. Status is `Applied` (it must be in the dropdown; if not, the request is refused with the same message). Applied date is today in America/Detroit, written in the format that existing date cells use (read one existing value; the default is `M/D/YYYY`). Track is a best guess from the title: `Internship` if intern, `Co-op` if co-op, `New grad` if new grad/early career/university grad, otherwise `Confirm`. Priority is `Unranked`. Other cells are left blank. The row is appended with `values:append` (`USER_ENTERED`, `INSERT_ROWS`) to the table's range, so the Table extends. |
| Duplicates | Before appending, if a row with the same Company and Role (normalized) exists, the function returns 409 `{duplicate: true}` and the UI asks "Already in your Sheet. Add anyway?" Confirming re-sends with `force: true`. |
| App state | After a successful write, the function upserts the matching `applications` row in Supabase as the user (RLS applies), so Today, Applications and the funnel update at once. The next 30-minute sync reconciles everything by `row_hash`. Applying from a posting also sets `postings.status = 'applied'` (new enum value). |
| Errors | Short fixed messages only: "Couldn't reach Google. Try again.", the not-found message, and the dropdown message. Raw Google errors are never shown in the UI; the function logs counts only. |

## UI
- **Hunt › Jobs:** each posting row gets **I applied** (≤24 chars, 44px). On success the row leaves the New list. A posting already marked applied shows "Applied ✓".
- **Hunt › Outreach:** each card for a posting also gets **I applied**, which pairs with Tailor resume.
- **Hunt › Applications:** each row gets a **Status** control. It's a native `<select>` filled with the Sheet's dropdown options (fetched once per screen visit from `GET /api/sheet?op=statuses`), and the current status is selected. Changing it writes immediately. It shows "Saving…" and then "Saved", or the short error. On error it reverts the select.

## Data (migration `0005_sheet_writes.sql`)
- `applications.sheet_row int` (nullable). The worker's sheet sync fills it from the row index in `map_rows`.
- The `postings.status` check gains `'applied'`.
- No other schema changes.

## Out of scope
- Editing cells other than Status.
- Deleting rows.
- Writing other tabs.
- Adding options to the Sheet's dropdown automatically.

## Testing
- **Function unit tests** (Vitest, Google and Supabase fetch mocked):
  - auth required, and a wrong user is rejected
  - column mapping by header aliases
  - row found by `sheet_row`; row moved but found by search; zero or multiple matches give 409
  - status not in the dropdown is refused
  - duplicate gives 409, and `force` appends
  - date format detection
  - track guess
  - the Supabase upsert payload
  - the function never touches columns other than Status
- **Worker:** `map_rows` sets `sheet_row`.
- **Web:** the I applied flow (duplicate confirm), and the Status select (optimistic update, revert on error).
- **e2e:** the demo API implements the same methods in memory.
