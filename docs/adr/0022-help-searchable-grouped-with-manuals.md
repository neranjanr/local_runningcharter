# ADR 0022: Help Page Searchable Grouped Layout with Sheet and Mobile Manuals

Date: 2026-09-15
Status: Accepted
Deciders: Neranjan

## Context

`app/help/page.tsx:1` rendered 16 flat sections (`max-w-4xl` stack, no search) titled `1. … 16.`. Users requested a structured help with search and inline manuals for linking the Google Buffer Sheet and setting up the mobile PWA. `docs/manuals/user-setup.md:1` already held 339-line self-serve steps for Sheet proxy deploy and phone file distribution; duplicating it verbatim into Help would bloat search. Grill Q4/Q5/Q8 required live title+content search with highlight and grouped TOC, distilled manuals linking to full manual.

## Decision

- Restructure Help into 18 sections across 5 groups (`Core Concepts`, `Ledger & Fuel`, `Operations & Gaps`, `Data Exchange`, `Setup & Manuals`) in `app/help/page.tsx:8` — groups rendered as `bg-paper-gutter` banners with `divide-y`, 18 `id` anchors (`book-opening` … `auth-roles` plus new `sheet-linking`, `mobile-setup`).
- Add live search: `useState` query, `useMemo` substring filter on `norm(title+content)`, hide non-matching sections, `highlight()` wraps matches in `<mark bg-amber-200>`, sticky TOC sidebar (`lg:w-56 lg:sticky`) with per-group lists and count `filtered/total`, clear button, placeholder `Search help — try sheet, fuel, gap…`.
- Inline distilled manuals: `16. How to Link Google Sheet` and `17. How to Set Up Mobile Webpage / PWA` summarize 5-step checklists and reference `docs/manuals/user-setup.md` §§1–5 and `quicktrip-mobile/README.md` plus `config/sheet.local.json` / `npm run build:mobile` / `start-service.ps1` details; full 339 lines stay in manual file.
- Update `CONTEXT.md:77` `Help Page` glossary to document search + grouped TOC + manuals; test `components/LandingHelpAuth.test.tsx:76` updated to expect 18 sections via `getAllByText` (titles appear twice: TOC + body) and search placeholder presence.

## Alternatives Considered

- Full manual inline — rejected: bloats Help, duplicates 339 lines, harms search signal.
- External search lib (fuse.js) — rejected: substring `includes` suffices for 18 sections, no dep.
- Keep flat 16 sections with anchor scroll only — rejected: fails structured navigation ask.

## Consequences

- Help is searchable without backend, groups match app mental model, manuals discoverable without leaving Help; TOC stays visible on scroll (`scroll-mt-20`).
- Reversal requires flattening to 16 sections and removing search state/highlight logic.
