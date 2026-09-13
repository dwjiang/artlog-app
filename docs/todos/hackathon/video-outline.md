# Demo video outline

Target: **175 seconds**, in English, with a public YouTube link under the event
requirements recorded on 2026-09-08. Use a light-mode physical-iPhone recording
and a short architecture slide. Match all claims to the current app and
[README](../../../README.md); timings below are editing allocations, not measured
service latency.

Before filming, complete the [production release checks](../release/README.md)
and choose examples that the installed build can demonstrate. Use the existing
10,000-painting production corpus; the full import is deferred. Museum-site search
needs its feature enabled and the user's consent. Keep `FLAG_RIGHT_NOW=off` and
omit that feature from the video.

| Time | Beat | Show and explain |
| --- | --- | --- |
| 0–25 s | Open and scan | Open without signing in, resolve the venue, and capture a painting. C-RADIO embeds on the phone; the normal identification request sends features, not the photo. Show the actual wait and result instead of promising a one-second result. |
| 25–55 s | Result and cited context | Show the title, artist, institution, and source links. Explain Convex retrieval, geometric verification, and the calibrator; Nemotron Super and Lightning on Token Factory generate fact sheets and cited prose that are cached. |
| 55–105 s | Unknown work and label fallback | Show a genuine miss and a consented museum-site search. Tavily searches the museum's site; the phone verifies candidate images. Kimi on Token Factory describes the painting when that search path needs it and reads a captured wall label. Show evidence links and the actual verified/editable fields. Preserve an honest unidentified outcome when evidence is insufficient. |
| 105–145 s | Save, visit, and optional contribution | Save to the private collection and show the visit. If demonstrating a contribution, show the consent sheet and what is shared. Explain that a verified contribution can help a later visitor; do not promise immediate promotion. A label photo, consented search crop, or contribution crop can leave the phone; the contribution crop is retained with consent. |
| 145–175 s | Architecture and close | Phone → Convex → Token Factory / Tavily; local batch jobs → Convex. C-RADIO runs on the phone, Kimi handles vision on Token Factory, and Nemotron handles text. The index was built on the operator's Mac; Nebius Serverless AI Jobs were evaluated but are not on a production path. End with the demo and repository links. |

For the recorded Best Use of Tavily requirement, show the runtime call through
museum-site search or label verification. Do not enable “Right now” to create a
filming beat. If the video runs long, shorten the architecture explanation and
optional contribution sequence first.
