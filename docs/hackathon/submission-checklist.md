# Submission checklist — Nebius × NVIDIA Global AI Hackathon

Deadline: **2026-10-30 10:00 PDT** (Devpost). Requirements as verified on the hackathon page on
2026-09-08 (plan 06.02). Update the status column as items close; every item has one owner.
"Operator" is the human submitting; "repo" means the item is satisfied by committed files.

| # | Item | Owner | Status (2026-09-11) |
|---|---|---|---|
| 1 | Repository is public at submission time | Operator | TODO — `dwjiang/artlog-app` is private; making it public also makes the pinned model release asset public, so `npm run model:fetch` stops needing a token |
| 2 | OSS license file at the top level | Repo | DONE (MIT, `LICENSE`) — the copyright line still names the Expo template author; the operator decides whether to change it |
| 3 | README: setup instructions and how to run | Repo | DONE — "Run the app against the hosted backend", "Run your own backend", "Rebuild the index from scratch" |
| 4 | README: explicit "Where NVIDIA and Nebius are used", including where Token Factory accelerated the workflow and which other Nebius services were used | Repo | DONE — honest about Kimi K2.6 for label reading and the local index build; re-check against decision 004 before submitting |
| 5 | Hosted production Convex deployment and its URL in the README | Operator (plan 06.01) | TODO — README carries a marked placeholder |
| 6 | Working demo free of charge: TestFlight public link in the README | Operator (plan 06.01) | TODO — Apple enrollment, first external build, Beta App Review; TestFlight builds expire after 90 days, so the submitted build must be newer than 2026-08-01 |
| 7 | Demo video under 3 minutes, in English, public on YouTube, linked from the README and Devpost | Operator | TODO — [video-outline.md](video-outline.md) |
| 8 | The video shows a functional runtime Tavily call (Best Use of Tavily) | Operator | TODO — museum-site search on a miss is the primary beat; "Right now" needs `FLAG_RIGHT_NOW=on` for filming |
| 9 | NVIDIA / Nebius callouts explicit in the video and Devpost text (C-RADIO on every scan, Nemotron Super and Lightning on Token Factory) | Operator | TODO |
| 10 | Written feedback on Token Factory / AI Cloud / NVIDIA tools submitted (Most Valuable Feedback) | Operator | TODO — distill [feedback-notes.md](feedback-notes.md); 22 dated entries seeded 2026-09-11, keep appending |
| 11 | Third-party data and APIs used under their terms, stated in the README | Repo | DONE — "Data sources and terms"; decision 005 holds the evidence |
| 12 | Devpost form: project name, tagline, team members, city (Builders & Brews city award), track "Best Apps and Agents" | Operator | TODO — working title still "Artlog" |
| 13 | Credits claimed: Token Factory promo form and Nebius Builders Program (includes Tavily credits) | Operator | UNKNOWN — record the date claimed here |
| 14 | Production backend hardened before the public link: `APP_ATTEST_REQUIRED=true`, `APP_ATTEST_ALLOW_DEV=false`, daily caps set, `FLAG_RIGHT_NOW` decided | Operator (plan 06.01) | TODO |
| 15 | Index pushed to production (full corpus build, plan 02.04, finished and imported per 02.05) | Operator | TODO — build was at 24 of 41 shards on 2026-09-11 |
| 16 | Design-document corrections applied (`docs/design/art-identifier.md`, "Corrected 2026-09-11" notes) | Repo | DONE |
| 17 | Final re-read of README model and usage claims against decisions 004 and 007 on submission day | Operator | TODO |

## Day-of order

1. Push the final index and confirm the TestFlight build identifies a painting against production.
2. Make the repository public; run `npm run model:fetch` from a fresh clone without a GitHub
   token to prove the asset is reachable.
3. Replace both README placeholders (TestFlight link, video link) and re-run the link check:
   `grep -o '](\([^)]*\.md\))' README.md` targets must exist.
4. Submit on Devpost; paste the feedback text; attach the video.
