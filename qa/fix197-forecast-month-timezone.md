# FIX 197 — "December 2026" filtered November: UTC vs local month keys

**Reported (phone screenshot, 2026-09-16):** Production Forecast with the month
dropdown on *December 2026* listed only *November 2026* events; the results
header confessed it — `Timeframe: 2026-11`.

## Root cause

Three places derived a `YYYY-MM` key with `toISOString()`, which renders **UTC**:

* the forecast month-dropdown option values (`app.js`),
* the forecast Next-Month filter (`app.js`),
* the reservations "+90 days → expected month" (`reservations.js`).

`new Date(2026, 11, 1)` is Dec 1 00:00 **local**; on a Philippine phone
(UTC+8) that instant is Nov 30 16:00 **UTC**, so `toISOString().slice(0,7)`
returned `2026-11` while the label (formatted locally) said "December 2026".
Every option was silently one month behind its label; the Next-Month chip
broke whenever today falls in the first 8 days of a month; the +90d expected
month slipped whenever the result landed on the 1st.

## The fix

One helper, local date parts instead of UTC text:

```js
const localYM = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
```

used for the dropdown values and Next-Month filter; the reservations +90d
path builds the same local-parts key inline.

## Verified by

`qa/test-month-timezone.mjs` — extracts the shipped `localYM` from app.js and
**executes it in child processes pinned to Asia/Manila, UTC and
America/New_York** (Dec 1 / Jan 1 / Dec 31 must key to 2026-12 / 2026-01 /
2027-12 everywhere); reproduces the old derivation returning `2026-11` under
Manila to prove the diagnosis; asserts no `toISOString().slice(0, 7)` month
key survives in either file. Run: `node qa/test-month-timezone.mjs`.
