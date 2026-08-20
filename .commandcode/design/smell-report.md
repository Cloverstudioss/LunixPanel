# Smell Report — LunixPanel

**Project:** LunixPanel for QyroCloud by Clover Studios — Game Server & Proxmox Hosting Panel
**Mode:** smell
**Date:** 2026-08-20

## Score

**6/10 — FAINT** — low tells, but a few systemic defaults worth cutting before they calcify.

| Heuristic | Present? | Note |
|---|---|---|
| Tech gradient | 0 — faint | Generic dark neutral avoids it, but earlier builds leaned indigo/cyan |
| Generic tech hue | 1 — clean | No purple identity; neutral dark is intentional for operator tool |
| Feature tile grid | 1 — clean | Split admin/user panels break the equal-card trap |
| Accent rail | 1 — clean | No rail |
| Unearned blur | 1 — clean | No glass |
| Stat monument | 0 — faint | 4-stat grid on overviews is useful but borders on monument |
| Icon topper | 1 — clean | No decorative icon caps |
| Bounce everywhere | 1 — clean | No motion yet |
| Default type | 0 — faint | Instrument Sans + Geist Mono with no tuned scale is competent but unvoiced |
| Center stack | 0 — faint | Auth pages center-stack is correct for that task; overviews do not |
| Domain default trap | 0 — faint | Dark + mono is the hosting-panel default reflex |

## Findings

| # | Severity | Discipline | Location | Before | After | Why |
|---|---|---|---|---|---|---|
| 1 | MEDIUM | Surface | `apps/web/src/main.tsx:197 UserOverview` | 4 equal stats (Status/Servers/Access/Vendor) at same weight | Keep Status + Servers as primary, demote Access/Vendor to a compact meta row or footer detail | Equal weight for unequal importance; operator scans status first |
| 2 | LOW | Type | `apps/web/src/styles.css:1 :root` | Instrument Sans at default scale, mono for metadata only | Tune a compact operator scale: H1 26→22 step, body 13, mono 11, with tighter tracking on mono | Type is present but not yet voiced for dense admin work |
| 3 | LOW | Layout | `apps/web/src/main.tsx:135 LoginPage auth-wrap` | Single centered card with side explainer | Keep center for auth (task-correct) but tighten to single purpose: sign-in only, not explainer | Auth center-stack is correct; side explainer is the faint smell |

## Considered but Rejected

| Location | Candidate | Rejected because |
|---|---|---|
| `styles.css` neutral dark | Add a domain color | Neutral dark is correct for long-session operator tool; color would be decoration |
| `main.tsx` table-wrap | Add zebras/icons | Minimal table is correct for now; decoration before density hurts scan |
| `main.tsx` sidebar | Add icons | Text labels are sufficient and faster to scan for 6–8 items |

## Verdict

**Needs changes** — nothing HIGH, but tighten stat hierarchy and tune type scale. No identity failure. Clean up these faints and ship.

## Verification

- Inspected `apps/web/src/main.tsx` and `apps/web/src/styles.css` rendered via `docker compose` on `:25050`.
- Confirmed dark neutral palette, split user/admin panels, inline forms for all actions.
- No gradients, no rails, no blur, no icon toppers present.
