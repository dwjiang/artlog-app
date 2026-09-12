# Demo video outline (under 3 minutes)

Public YouTube, English, one continuous phone screen recording where possible, with a short
architecture slide at the end. Film in light mode on a physical iPhone at a museum whose
collection is in the index (the demo venue is decided by plan 04.12's live check). Keep every
on-screen claim consistent with the README's "Where NVIDIA and Nebius are used" table.

Before filming: production backend with the index pushed; `FLAG_MUSEUM_SEARCH=on` and museum-site
search consent granted once in Settings; `FLAG_RIGHT_NOW=on` only for the filming session
(decision 007 keeps it off by default, and its acceptance rules show nothing for most artists,
so pick a famous artist with current news for beat 4 or drop the beat); a wall label with a QR
code or an accession number for beat 6.

| # | Beat | Seconds | What is on screen | Say |
|---|---|---|---|---|
| 1 | Open to the camera | 0–15 | App opens straight to the viewfinder, no sign-in; the venue pill resolves the museum from the on-device venue table | "No account, no upload of your photo: the phone embeds the painting itself with NVIDIA's C-RADIO and sends 20 KB." |
| 2 | Scan | 15–35 | Frame a painting; the subject crop and confidence indicator; the card appears in about a second | "One vector search on Convex, ORB verification, a calibrator that says confident or not." |
| 3 | Card with docent text | 35–60 | Title, artist, date, institution; "about this work" sentences with a source chip on each | "Written once by Nemotron 3 Super and Nemotron 3.5 Lightning on Nebius Token Factory from a cited fact sheet, then cached for every visitor." |
| 4 | "Right now" | 60–75 | The "From the web" line with its source link | "Tavily answers the one thing a museum database never knows." (Skip if nothing passes the acceptance rules.) |
| 5 | A miss | 75–100 | Scan a work not in the index; the soft card with runner-ups; museum-site search runs with consent and lands "Found on the museum's site" with the page link | "Kimi K2.6 describes the painting, one Tavily search scoped to the museum's own site proposes pages, and the phone confirms the image by embedding and homography. Text proposes, pixels decide." |
| 6 | Label flow | 100–135 | Point at the wall label; fields fill and lock as they verify (QR or accession on the museum's site, Wikidata) | "Read on Token Factory, verified against the museum's records; unverified fields stay editable." |
| 7 | Contribution | 135–160 | The consent sheet listing exactly what leaves the phone; save to the collection; the visit view | "Opt in and the next visitor gets an instant match. No museum image is ever stored." |
| 8 | Architecture slide | 160–175 | The README's architecture diagram: phone → Convex → Token Factory / Tavily; local batch jobs → Convex | "Nothing idles: the phone and Convex serve every scan, Nebius serves the models, and the index was built once with the same weights the phone runs." |

Cut anything that runs long from beats 4 and 7 first. The Tavily call must be visible on screen
(beat 5, or beat 4) for the Best Use of Tavily prize.
