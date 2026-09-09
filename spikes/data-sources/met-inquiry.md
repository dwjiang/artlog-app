To: openaccess@metmuseum.org
Subject: Met Open Access CDN hotlinking from an iOS art identification app

Hello Met Open Access team,

We are developing artlog, a pre-release iOS app that helps visitors identify
paintings and save their visits. For works marked `isPublicDomain` in the
Collection API, we would like to display the returned `primaryImageSmall`
URL (`images.metmuseum.org/CRDImages/.../web-large/...jpg`) directly in a
result card, with artist/title credit and a link to the Met object page.

The app would request images on demand from the device without a Referer
header. We would not rehost the images. If a request fails, the card would
show the visitor's own photograph.

We understand the Open Access content is available under CC0. Is direct
hotlinking to this CDN endpoint acceptable for a mobile app, including a
potential future commercial release? Is there a preferred endpoint, image
size, User-Agent/contact format, cache policy, or request limit we should use?

Thank you,
[Sender name and contact to be supplied]

---

Draft prepared 2026-09-08; **not sent**. No email connector or sender identity
was available. Record an actual send timestamp and response in
`results/contacts.json` when the inquiry is sent.
