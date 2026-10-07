# Visitor contribution identity

A visitor contribution can help identify a work at its museum while its label
identity remains tentative. A matching painting photograph or an acceptance tap
does not independently establish the title and artist printed on a label.

[contributions.ts](../convex/contributions.ts) enforces authentication,
attestation, rate limits, crop validation, and idempotency. Publication and
recognition references commit together. Grouping uses museum, model, compatible
name/accession claims, and visual evidence; duplicate photographs do not become
independent supporting views.

[tentativeEntries.ts](../convex/lib/tentativeEntries.ts) keeps community identity
separate from corpus identity. Recognition scores established and museum-scoped
tentative candidates separately. An established confident result wins; a
visitor suggestion satisfies the visual gates and remains capped at a soft
outcome. Tentative identities are excluded from enrichment and training exports.

Identity evidence must bind exact title and artist claims to the depicted work
and retain source attribution. Image agreement alone cannot certify label text.
Canonical corpus records must not absorb unverified community claims.

[recognitionEligibility.ts](../convex/lib/recognitionEligibility.ts) checks rights,
withdrawal, bans, and proposal provenance on read paths. Evidence revisions and
transactional checks prevent cleanup races from restoring removed evidence.
Removing one contribution must preserve independently supported records and
private journal snapshots; an entry with no eligible backer cannot remain
available for recognition.

The alternate-view flow in [promotion.ts](../convex/promotion.ts) learns additional
views of established identities. It does not convert tentative visitor text into
an established identity.
