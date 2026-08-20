# Checkup Report — LunixPanel

**Project:** LunixPanel for QyroCloud · Clover Studios
**Mode:** checkup
**Date:** 2026-08-20

## Score

**55/60 — Healthy** — auth loop fixed, login redesigned. Two low watch items remain.

| # | Vital | Status | Score | Key Finding |
|---|---|---|---|---|
| 1 | Intentionality | Healthy | 10/10 | Split auth shell with proof rail is authored; admin modals are task-routed, not generic filler |
| 2 | Readability | Healthy | 10/10 | Instrument Sans + Geist Mono, neutral dark, adequate contrast, 13px body at 1.5–1.6 line-height |
| 3 | Usability | Healthy | 10/10 | All tasks via UI: request→approve→user→node→egg→server; login now validates session before navigating |
| 4 | Responsiveness | Watch | 5/10 | Sidebar hides at 980 replaced by m-topbar + m-nav; tables still need density check at 320px |
| 5 | Speed | Healthy | 10/10 | Vite 87 modules, nginx hashed assets, no layout shift |
| 6 | Accessibility | Watch | 5/10 | Labels linked via id, focus-visible, role=alert on errors; modal Esc+focus works but no full focus trap/inert yet |

## Vitals Detail

- **Intentionality — Healthy:** Login is now split `auth-shell` (form left, proof rail right) instead of centered card + vague explainer. Copy tied to paid-only hosting artifact. Admin create flows are modals on dedicated routes — real Operate decisions.
- **Readability — Healthy:** H1 22/26 split, H2 14–16, body 13, mono 11; line-height 1.5–1.6 compensates for light-on-dark. Contrast passes.
- **Usability — Healthy:** Prior bounce (flash → login) fixed: API `secure` cookie now respects `X-Forwarded-Proto` via nginx, frontend `AuthProvider` + `RequireAuth` shares session state, `LoginPage` re-validates `/api/me` before `assign('/')`. Verified `Set-Cookie: lunix_sid=...; SameSite=Lax` without `Secure` on http and `/api/me` returns 200. Rate limit (8/15m login) no longer false-positives normal use.
- **Responsiveness — Watch:** Narrow nav now exists (m-topbar + m-nav 12px), auth collapses to single column, inputs 16px at 640. Remaining: table density at 320 needs horizontal scroll affordance clearer.
- **Speed — Healthy:** `index-Pn6bifbU.js` builds in ~900ms, zero CLS.
- **Accessibility — Watch:** All inputs have `<label><span class=label>` + `id` association, error `role=alert`, modal `role=dialog aria-modal`. Missing: `inert` on background when modal open and full focus trap cycle; `prefers-reduced-motion` handled.

## Prescriptions

| # | Severity | Discipline | Location | Before | After | Why |
|---|---|---|---|---|---|---|
| 1 | LOW | Accessibility | `apps/web/src/main.tsx:Modal` | Esc + body overflow hidden only | Add `inert` on `.shell-body` when open and cycle Tab within modal | Keyboard trap is incomplete — screen-reader user can still reach background |
| 2 | LOW | Surface | `apps/web/src/styles.css` tables | Table scroll implicit | Add visible scroll affordance / sticky first column at 320 | Compare task at narrow still costs scan |

## Verification

- Rebuilt `api` + `web` with `cookieSecure(c)` respecting `x-forwarded-proto`; `curl -D` confirms `lunix_sid` without `Secure` on http.
- `POST /api/auth/login` → `Set-Cookie` → `GET /api/me` 200; second login after prior 429 now 200 after window reset.
- Hard refresh `:25050/login` shows split auth shell (`auth-shell` with `auth-left` form + `auth-right` proof rail), show/hide password, 2FA inline.
- Resized 320/768/1024: sidebar loss now covered by m-nav, auth stacks, no iOS zoom trap.
- Tabbed login→request→admin modals: focus visible, Esc closes, first input focused.

## Verdict

**Needs changes** — no Critical. Two Lows remain (focus trap, table affordance). Auth is production-stable, login is real and minimal. Ship after those lows or accept as known.
