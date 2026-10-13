# UPDATES — Latest-only auto-save + per-doctor patient list

## Step 1 — Backend: per-doctor scoping + dedupe (done)
- `POST /api/readings` and `POST /api/readings/bulk` now require `auth` and use `req.user.userId` as `userId` (no more `user1` default / client-supplied id).
- Added exact-match `findDuplicate()` (doctor + patient name case-insensitive + sys/dia/pulse + timestamp). Single POST returns `200 + {deduplicated:true}` on repeat; bulk skips dupes and reports `skippedCount`.
- `GET /api/readings` and `GET /api/readings/search` now filter by logged-in `userId`; search is exact case-insensitive match so history loads without re-typing.
- New `GET /api/patients` (auth): aggregates this doctor's readings into `{name, count, lastTimestamp, lastSys/Dia/Pulse}`, sorted newest-first. Powers the clickable list.
- Note: old rows stored with `userId: 'user1'` won't appear under any login (by design of per-doctor scoping).

## Step 2 — Frontend: burst-collect, latest-only save, auto history (done)
- Removed `syncBuffer` + 5s `bulkSaveBuffer` interval that saved every memory packet.
- Added burst collector: BLE packets queue in `burstRef`; a 2.5s quiet-timer (`BURST_WINDOW_MS`) ends the burst, picks max device-timestamp reading, and `POST /api/readings` (single, auth header) under the committed active patient.
- Added `activePatient` state: committed once on Connect & Scan (or patient-list click). History `useEffect` auto-fetches `/readings/search?name=activePatient` — no name typing needed.
- Live preview in Latest Result while burst arrives; "Recording as X — latest auto-saves" status under Device Setup.

## Step 3 — Frontend: clickable "My Patients" panel (done)
- New sidebar card fetches `GET /api/patients` on login and after each save; shows count + last date, filter box, active highlight.
- Click handler sets input + `activePatient`, history auto-reloads. History card now shows `— {activePatient}` + Refresh button; empty state guides to Connect & Scan or list click.
- Added `.patient-item` styles in `index.css`.

## Step 4 — Verification (done)
- `node --check server.js` → BACKEND_OK.
- Frontend `npm run build` (`tsc -b && vite build`) → success, dist emitted.
- Not yet live-tested against a real BM54 / MongoDB; check console logs ("Burst done… Saving…", "Duplicate ignored…") on first measurement.

## Step 5 — Latest Result: hide intermediates, show analyzing animation (done)
- Removed `setLastReading()` live preview from `queueBurstReading` — the cause of old recordings flashing through.
- Added `isCollecting` + `burstCount` state: set on first packet, cleared only after final save completes.
- Latest Result now renders an "Analyzing memory… / Saving final result…" animation (spinner + bouncing dots + packet count) while `isCollecting || isSaving`; previous final shown dimmed below as reference only.
- Only `saveLatestReading()` updates `lastReading`, so UI flips once from animation straight to the final confirmed reading.
- Added `spin` / `analyzing-bounce` keyframes + `.reading-display.analyzing` styles in `index.css`.
- Re-verified with `npm run build` → success.

## Step 6 — Collapsible System Console (done)
- Console card is now a dropdown: header is a toggle button with rotating chevron; log list renders only when expanded (`consoleOpen`), collapsed shows "Hidden — click above to expand logs."
- Logging behavior unchanged; verified with `npm run build` → success.

## Step 7 — Hospital-ID doctor identity + auth UI rework (done)
- Backend `User` model: added `hospitalId` (unique, sparse) + `name`; `username` demoted to legacy sparse field.
- `POST /api/auth/register` now requires name + hospitalId + password, rejects duplicate IDs, syncs legacy `username`.
- `POST /api/auth/login` now takes hospitalId (+ legacy username fallback) and returns `{token, doctor:{name, hospitalId}}`.
- New `GET /api/auth/me` returns the signed-in doctor profile for header persistence across reloads.
- Frontend: removed username field; Login form = Hospital ID + password, Register form = Full name + Hospital ID + password, with Login/Register toggle.
- Signed-in header is now just a green "Signed in — Dr. {name} • {hospitalId}" card + Sign out button; profile cached in `localStorage`.
- Verified: `node --check server.js` OK, `npm run build` OK.

## Step 8 — Signed-in label dedupe (done)
- Header used `Dr. {name} • {hospitalId}`, which doubled up as "Dr. Harshil • Harshil" when the ID equaled the name (and "Dr. Dr. X" when the stored name already had the prefix).
- Added `formatDoctorLabel()`: strips a stored "Dr." prefix, shows the name once, appends the Hospital ID only when it differs.
- Verified with `npm run build` → success.

## Step 9 — Dark mode (done)
- Added `[data-theme="dark"]` variable overrides in `index.css` (backgrounds, text, borders, inputs, patient states, reading display) + `color-scheme` hints.
- Replaced hardcoded light colors (`#f1f5f9`, `#fff`, `#eef2ff`, `#f0fdf4`, …) with theme variables so cards adapt.
- Added `theme` state in `App.tsx` (localStorage `theme`, falls back to OS `prefers-color-scheme`), synced to `document.documentElement.dataset.theme`.
- Added Sun/Moon toggle button in the header next to auth.
- Verified with `npm run build` → success.

## Step 10 — Auth popup cards (done)
- Header now shows only two buttons (Login / Sign up) plus theme toggle when signed out; the inline credential form is gone.
- Clicking either opens a centered modal card: Login asks Hospital ID + password, Sign up asks Full name + Hospital ID + password, with overlay-click / ✕ / Escape to dismiss and a switch link between modes.
- Sign-up success flips to the Login card keeping the Hospital ID; login success closes the modal and shows the signed-in card.
- Added `.auth-overlay` / `.auth-card` styles (theme-aware).
- Verified with `npm run build` → success.
