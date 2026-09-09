# Plan 06.02: README, "Where NVIDIA and Nebius are used", rebuild-from-scratch docs, feedback notes, and the submission checklist

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 86571a3..HEAD -- README.md docs/hackathon LICENSE`

## Status

- **Priority**: P1 (a submission requirement)
- **Effort**: M
- **Risk**: LOW
- **Depends on**: 00.04 (model corrections), 02.01–02.07 (job runbooks), 06.01 (links) — the README can be drafted earlier and finished last
- **Category**: docs
- **Planned at**: commit `86571a3`, 2026-09-08

## Why this matters

Devpost requirements (verified 2026-09-08 on the hackathon page): public repo with an OSS license file; "a README with setup instructions and clear guidance for running your project. Make sure to highlight how you've used NVIDIA Nemotron or other NVIDIA open source models and where Token Factory accelerated your workflow and any other Nebius Tools or Services used"; a working demo URL free of charge (TestFlight public link); a < 3-minute public YouTube video; written feedback on Token Factory/AI Cloud/NVIDIA tools (Most Valuable Feedback prize, $100 × 10); Best Use of Tavily ($3,000) requires "a functional, runtime call to the Tavily API". Design §2 promises ingest/crawl/re-embed/enrichment scripts so the index can be rebuilt, plus a "run against the hosted backend" path.

## Current state

- `README.md` is the `create-expo-app` template text; `LICENSE` is MIT (already at the top level — confirm the header says MIT).
- `jobs/README.md` (02.01–02.09) documents each job; `docs/runbooks/` (02.08, 06.01); `docs/decisions/` (spikes); `docs/design/art-identifier.md` (the design, with §5.7's "Where each NVIDIA / Nebius component is used" table and §7's Tavily story, both to be corrected per `docs/decisions/004-token-factory-models.md`).

## Scope

**In scope**: `README.md` (rewrite), `docs/hackathon/{feedback-notes.md,submission-checklist.md,video-outline.md}` (create), `docs/design/art-identifier.md` (apply only the corrections listed in `docs/decisions/004-token-factory-models.md` "Design corrections", each marked with a `**Corrected 2026-…**` note), `.github/` nothing.

**Out of scope**: the video itself, store metadata.

## Steps

### Step 1: README

Sections, in order: title + one-paragraph pitch (from §1); **Demo** (TestFlight public link placeholder → real; video link); **Where NVIDIA and Nebius are used** — the §5.7 table corrected by 00.04 (C-RADIOv3-B on every scan on the phone and, with the same weights, in the index build; Nemotron 3 Super for fact sheets; Nemotron 3.5 Lightning (or the chosen text model) for docent prose and moderation; the label-reading model and the honest note if it is not NVIDIA; **where the index was actually built** — the initial build ran locally on Apple silicon (plan 02.04), and Nebius Serverless AI Jobs appear only if plan 02.10 ran them for crawls/enrichment; never claim a Nebius build that did not happen; "nothing idles on Nebius by design" stays true either way); **Tavily** (the three runtime calls + Map, from §7, with the code locations `convex/rightNow.ts`, `convex/label.ts`, `convex/docent.ts`, `jobs/artlog_jobs/crawler/discover.py`); **Architecture** (a short text diagram: phone → Convex → Token Factory/Tavily; Nebius jobs → Convex); **Run the app against the hosted backend** (prerequisites: Node 22, Xcode 26, a physical iPhone; `npm ci`; `cp .env.example .env.local` and set `EXPO_PUBLIC_CONVEX_URL` to the hosted prod URL; `npm run model:fetch`; `npx expo prebuild --platform ios --clean && npx expo run:ios --device`); **Run your own backend** (`npx convex dev`, env vars list with what each does, seed venues, push the index — pointers into `jobs/README.md`); **Rebuild the index from scratch** (spikes → jobs order: seed venues → metadata → build → dedupe/push → crawler → enrichment; costs from §10 as measured); **Data sources and terms** (Met CC0, AIC, Wikidata/Commons, museum sites crawled politely with opt-out; WikiArt not used and why; no museum image stored); **Privacy** (what leaves the phone; App Attest); **Development** (`npm run lint`, `npm run typecheck`, `npm test`, `cd jobs && uv run pytest`); **License** (MIT). Keep it under ~300 lines; link out for detail.

**Verify**: every command in the README runs on a clean clone (do it in a temp dir up to `npm run model:fetch`); every relative link resolves (`grep -o '](\([^)]*\.md\))' README.md` targets exist).

### Step 2: Feedback notes

`docs/hackathon/feedback-notes.md`: a dated running log with sections Token Factory (deprecations encountered, structured-output behavior, rate limits, pricing clarity), Serverless AI Jobs (CLI ergonomics, quotas, logs, scratch storage), NVIDIA models (C-RADIO export experience, adaptor loading, Nemotron JSON reliability), Tavily (Map cost predictability, `published_date` gaps). Seed it with the findings already recorded in `docs/decisions/00{1,4,7,8}-*.md` and instruct every executor to append.

**Verify**: file exists with ≥ 10 dated entries by submission.

### Step 3: Submission checklist and video outline

`submission-checklist.md`: repo public + license; README sections present; demo link works free of charge; video < 3 min on YouTube, English; feedback submitted; Tavily runtime call demonstrated in the video; NVIDIA/Nebius callouts explicit; team/city fields; deadline 2026-10-30 10:00 PDT. `video-outline.md`: 6 beats (open to camera → scan → card with docent → "Right now" → a miss → label flow → contribution; end with the architecture slide).

**Verify**: checklist items each have an owner and a status.

### Step 4: Design-doc corrections

Apply the corrections from 00.04 (VL model reality, model IDs, Tavily field notes) and, from this planning pass, the embedding dimension (1536 instead of 768; storage math ×2), the VisionCamera 5 / `@expo/app-integrity` facts, and the local index build (§5.2/§5.7 say "Nebius Serverless Job, L40S"; the build ran on the operator's Mac — see `docs/plans/README.md`, "Decisions made while planning"), each as a short **Corrected** note next to the original sentence rather than rewriting history.

**Verify**: `grep -c "Corrected" docs/design/art-identifier.md` ≥ 5.

## Test plan

Docs only: link check and a clean-clone command run.

## Done criteria

- [ ] README rewritten with all sections; commands verified on a clean clone
- [ ] `docs/hackathon/*` created; design corrections applied
- [ ] `docs/plans/README.md` updated

## STOP conditions

- The hosted prod URL or TestFlight link does not exist yet — leave clearly marked placeholders and report.

## Maintenance notes

- The README's model/usage claims must match `docs/decisions/004-*.md`; re-check before submission.
