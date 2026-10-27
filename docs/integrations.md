# AI and search integrations

Artlog runs image recognition on iOS and model-backed artwork research in Convex.
The [root README](../README.md) describes the product and setup in plain language, and
the [technical overview](technical-overview.md) describes the request paths; provider
adapters and configured model IDs are the implementation source of truth.

## Runtime contracts

- C-RADIOv3-B produces artwork fingerprints on the iPhone. The bundled CoreML
  export, preprocessing, PCA projection, corpus vectors, and model version must
  agree; see [the model workflow](../scripts/model/README.md).
- Apple Vision reads wall labels on the iPhone. Label text goes to a Nemotron
  model through Nebius Token Factory; label photographs remain on the phone.
- Token Factory serves the Nemotron models used for label sorting, artwork fact
  sheets, docent prose, exhibition listings, and moderation. The shared adapter is
  [tokenFactory.ts](../convex/lib/tokenFactory.ts).
- Tavily supplies search evidence for label verification and artwork research,
  and reads exhibition listings the backend's own fetch cannot. The runtime paths
  are [label.ts](../convex/label.ts), [docentSources.ts](../convex/lib/docentSources.ts)
  and [exhibitionRefresh.ts](../convex/exhibitionRefresh.ts). Search results propose
  evidence; an image URL alone does not establish artwork identity or rights.
- OpenAI supplies narration speech and shared-text moderation. Shared text reaches
  OpenAI only from accounts that turned on safety checks (App Review 5.1.2(i));
  without them that text can't be posted. Provider failures must preserve retry
  and moderation behavior without exposing content or credentials in diagnostics.

Changes to providers, models, endpoints, environment variables, or request paths
must keep setup instructions, privacy disclosures, and README claims consistent
with code. Evaluation results must name the measured workload and its limits;
model availability, pricing, and quotas require provider verification before use.

## Licensing and public descriptions

The repository's source license is AGPL-3.0 in [LICENSE](../LICENSE). Model weights,
SDKs, and data sources retain their own terms. Adding a data source requires
checking metadata and image permissions separately; an image URL or museum
attribution does not grant reuse rights.

Setup instructions must explain how to obtain model assets and credentials
without publishing secrets. Demo descriptions and footage must show behavior
available in the demonstrated build and name what each provider does. Public
claims must not imply that experimental batch jobs run production recognition.
