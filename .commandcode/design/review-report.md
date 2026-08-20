# Review Report — LunixPanel

**Project:** LunixPanel for QyroCloud by Clover Studios — Paid-only Game & Proxmox Hosting Panel
**Mode:** review
**Date:** 2026-08-20

## Scores

| Lens | Score | Note |
|---|---|---|
| First impression | 7/10 | Quiet, operator-grade dark — reads as tool not marketing. Loses a point for still-generic empty states |
| Hierarchy | 6/10 | User/admin split is strong; overviews flatten Status vs Vendor equally |
| Color voice | 8/10 | Neutral dark with restrained accents is intentional for long sessions |
| Type voice | 6/10 | Instrument Sans + Geist Mono present but scale is default |
| Interaction feel | 7/10 | Real forms for every task, but feels utilitarian — no affordance on table rows, skeletons minimal |
| Composition | 7/10 | Sidebar + content is correct for Operate/Monitor hybrid; auth centering is task-correct |
| **Average** | **6.8/10** | Solid product panel, needs hierarchy + type tuning + a little warmth |

## Walkthrough

- **Auth (`/login`, `/request-access`):** Minimal, centered — correct for that job. Brand mark is still just "L" — functional but not authored. Side explainer is honest copy, not marketing fluff.
- **User (`/`, `/servers`, `/account`):** Split is the strongest decision — user sees only their world. Stats are accurate but equal weight buries the real signal (is my access expiring?).
- **Admin (`/admin*`):** Every provision step is a real form — the core win. Tables are scannable, badges are restrained. Empty states are accurate but generic.

## Findings

| # | Severity | Discipline | Location | Before | After | Why |
|---|---|---|---|---|---|---|
| 1 | MEDIUM | Layout | `main.tsx` overview stat grids | 4 equal stats at same size/weight | Promote primary (Status, Servers) to large value; demote secondary (Access, Vendor) to meta line or collapse to 2+2 with weight contrast | Equal cards signal an unchosen layout — hierarchy is earned by choosing what matters |
| 2 | MEDIUM | Type | `styles.css` type scale | Default scale, no step tuning | Tighten H1 26, H2 16, body 13/1.6, mono 11/0.02 tracking, label 11 uppercase | Type is present but unvoiced — scale contrast is how dense admin UIs earn calm |
| 3 | LOW | Surface | `main.tsx` empty/table states | "No servers — submit at /request-access" generic | "No servers yet — an admin will assign yours. Requests → approve → server." + action link where relevant | Empty states should teach the space, not label it |
| 4 | LOW | Writing | `main.tsx` brand mark + ledes | "L" mark, ledes like "Your servers and VPS." | Keep minimal mark for now but tune ledes to the artifact: "Your game servers and VPS" + one line of proof | Generic copy is the last slop to leave |

## Considered but Rejected

| Location | Candidate | Rejected because |
|---|---|---|
| `styles.css` — add accent color system | Domain has no strong hue anchor; neutral is honest for operator tool | Would add decoration without task value |
| `main.tsx` sidebar icons | 6–8 labels scan faster as text on dense admin | Icon would be decoration |
| Dark palette overall | Could go light | Dark is correct for long-session monitoring on hosting panel |

## Verification

- Inspected `apps/web/src/main.tsx` + `styles.css` source and rendered output at `:25050`.
- Compared user vs admin routes — split is effective and consistent.
- Tabbed all routes — focus visible, tables scroll.

## Verdict

**Needs changes** — no HIGH blockers. Tune stat hierarchy, type scale, and empty states, then ship. No structural redesign needed.
