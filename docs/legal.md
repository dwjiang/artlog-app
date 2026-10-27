# Legal pages and disclosures

The Convex HTTP router serves `/privacy`, `/terms`, `/support`, and third-party notices from
[legal.ts](../convex/legal.ts). Policy text and provider disclosures live in
[legalPages.ts](../convex/lib/legalPages.ts).

`https://artlog.dwjiang.com` proxies those paths to production's Convex site
([vercel.json](../www/vercel.json)). Welcome, Settings, and the App Store listing link
there, so every build shows the production policy. Pages use public HTML responses
and a one-hour cache, so policy deployments need neither a new iOS binary nor a site deploy.

Changes to off-device data, providers, publication audiences, retention, or
account deletion must update the policy text and affected in-app disclosures together. Read
ownership and cleanup code before describing deletion: file removal, journal
tombstones, retained shared-index details, and account erasure have different
contracts. Do not infer privacy promises from a screen's copy alone.

Third-party notices come from the dependency license inventory. Keep source,
model, data, and image licensing distinct; the repository license does not
replace upstream terms.
