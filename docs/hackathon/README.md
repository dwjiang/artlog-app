# Nebius x NVIDIA Global AI Hackathon

Requirements recorded on 2026-09-17 from the
[Devpost page](https://nebiusglobalaihackathon.devpost.com/) and its
[official rules](https://nebiusglobalaihackathon.devpost.com/rules). Recheck both
before submitting; this file exists so that code and documentation changes keep
the submission eligible.

## Event facts

| Item | Value |
|---|---|
| Submission period | 2026-08-26 09:00 PT to **2026-10-30 10:00 PT** |
| Judging | 2026-12-01 09:00 PT to 2026-12-15 12:00 PT; winners on or around 2027-01-11 |
| Track | **Best Apps and Agents**: "Build any app or agent someone would actually use, from a productivity tool or copilot to a workflow that runs itself." |
| Bonus award | **Best Use of Tavily** ($3,000): "a functional, runtime call to the Tavily API as part of its solution" |
| Other awards | Grand $20,000, 2nd $10,000, 3rd $6,000, track winners (Jetson Orin Nano), City Winner ($500, 20), Most Valuable Feedback ($100, 10). One project may win one Overall or Track award plus one Bonus award |
| Project start | Repository created 2026-09-07, inside the submission period, so no prior-work disclosure is needed as long as that stays true |

## Hard requirements

Every item below is pass/fail. Stage One judging checks that the project "reasonably
fits the theme and reasonably applies the required APIs/SDKs"; anything that breaks an
item disqualifies the submission.

1. **Runs on Nebius.** "The project makes a runtime call to the Token Factory inference
   API, or is deployed/run using Nebius AI Cloud compute (Serverless Jobs, Serverless
   Endpoints, or DevPods)." Artlog satisfies this through Token Factory calls from Convex
   actions (`convex/lib/tokenFactory.ts`). Do not remove or stub the runtime Token Factory
   path, and do not move all model calls to another provider.
2. **Uses at least one NVIDIA open source model.** Artlog uses C-RADIOv3-B on the phone
   and Nemotron 3 Ultra, Nemotron 3 Super and Nemotron 3.5 Lightning on Token Factory. Nemotron is the
   organizers' preferred family for this track; keep at least one Nemotron model on a
   live request path and keep the root README's model table accurate.
3. **Working, free demo for judges.** A URL to "a working demo, hosted application, or
   test build" that stays "available free of charge and without any restriction" until
   judging ends on 2026-12-15. For an iOS app this is the public TestFlight link; the
   submitted build must not expire before then. Private access needs credentials in the
   testing instructions.
4. **Functions as shown.** The project "must be capable of being successfully installed
   and running consistently on the platform for which it is intended and must function
   as depicted in the video and/or expressed in the text description." Do not describe
   or film features that are behind an off flag or not shipped.
5. **Public repository with a detectable license.** GitHub, GitLab or Bitbucket, with
   "an open source license file (such as Apache 2.0, MIT, or MPL 2.0)" that is
   "detectable and visible at the top of the repository page". Artlog uses MPL 2.0 in
   `LICENSE`; keep the file at the root under that name.
6. **README with setup and run instructions** plus documentation of the NVIDIA model
   usage and the Nebius integration. Any change to models, endpoints, env vars or setup
   steps must update the root README in the same change.
7. **Demo video.** Under three minutes, public on YouTube, in English (or with an
   English translation), with "footage that shows the Project functioning on the device
   for which it was built", and no third-party trademarks or copyrighted music without
   permission. Judges are not required to watch beyond three minutes.
8. **Third-party terms.** "Entrant must be authorized to use" every SDK, API and data
   source under its terms. Keep the README's data-source and terms section current
   when adding a source.
9. **Original work.** The submission must be the team's own work, solely owned, and
   built on any open source it includes rather than repackaging it.
10. **Tavily bonus.** A live runtime Tavily call must remain reachable in the shipped
    build and be shown in the video. Museum-site search and label verification are the
    current runtime paths (`convex/museumSearch.ts`, `convex/label.ts`).

## Judging criteria

Stage Two scores four equally weighted criteria; ties resolve in this order.

1. **Technological Implementation.** "How well is the project built, and how
   effectively does it use Nebius Token Factory or AI Cloud model(s), and NVIDIA
   Nemotron or other NVIDIA open source models as part of the solution?"
2. **Design.** "Does the project deliver a complete, coherent product experience not
   just a technical proof of concept?"
3. **Potential Impact.** "Does the project make a credible, specific case for solving a
   real problem for a real audience and does the solution actually address it based on
   what's demonstrated?"
4. **Quality of the Idea.** "Is this a creative, non-obvious use of Nebius Token Factory
   or AI Cloud model(s), and NVIDIA Nemotron or other NVIDIA open source models and does
   the team show genuine understanding of the problem space?"

Implication for code and docs: prefer finishing a coherent end-to-end flow over adding a
partial feature, and state plainly in the README what each Nebius and NVIDIA component
does on the request path.

## Submission form deliverables

- Project name, tagline and a text description of features and functionality.
- Track declaration (Best Apps and Agents) and the city attended, if any, for the City
  Winner Award.
- Demo URL, public repository URL, and the YouTube video URL.
- Written feedback on "Nebius Token Factory, AI Cloud and any NVIDIA tools, models, or
  technologies used". This is required for every entry and also feeds the Most Valuable
  Feedback award. Draft it from the dated [feedback notes](feedback-notes.md).
- A written explanation of what changed during the submission period, only if the
  project predates 2026-08-26.

Remaining operator work is tracked in the [submission todo](../todos/hackathon/README.md).

## Eligibility notes

Entrants must be at or above the age of majority; residents of Brazil, Quebec, Russia,
Crimea, Cuba, Iran, North Korea and other OFAC-sanctioned regions are excluded, as are
employees and household members of Nebius, NVIDIA, Devpost and the judges. Teams have
no stated size cap and one member acts as Representative. Multiple submissions are
allowed only if "unique and substantially different".
