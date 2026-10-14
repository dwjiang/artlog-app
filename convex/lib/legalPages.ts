export type LegalDocument = {
  title: string;
  updated?: string;
  intro: string[];
  sections: { heading: string; paragraphs: string[] }[];
};

export type ThirdPartyNotices = {
  entries: { name: string; version?: string; license: string; holder?: string; text: number }[];
  texts: string[];
};

const UPDATED = "October 14, 2026";
const EMAIL = "danieljiang1999@gmail.com";
const CONTACT = `Questions or requests: email ${EMAIL}, or open Settings → Send feedback in Artlog.`;

// Every statement here describes current app and backend behavior; update it with any change to what leaves the phone.
const privacy: LegalDocument = {
  title: "Privacy Policy",
  updated: "October 13, 2026",
  intro: [
    "This policy explains what Artlog collects, how it’s used and shared, and the choices you have. Artlog is made by Daniel Jiang (“we”, “us”).",
    "Artlog doesn’t show ads, sell your information or track you across other companies’ apps and websites.",
  ],
  sections: [
    {
      heading: "On your iPhone",
      paragraphs: [
        "Your collection lives on your iPhone first: visits, saved artworks, notes and photos. Original photos stay on your iPhone. If you don’t sign in, the name and photo you choose during setup stay on your iPhone too.",
      ],
    },
    {
      heading: "Identifying art",
      paragraphs: [
        "Identification sends a numeric fingerprint of your photo, never the photo itself, with the museum, the visit and the time you took it. We keep scan results to improve recognition and delete scan fingerprints after 180 days, unless they’ve been added to the shared index.",
        "Label reading happens on your iPhone and sends only the label’s text, plus the web address of a QR code on the label if there is one. To check the label and write artwork guides, we send that text, and searches for the artwork’s title and artist, to our AI and search providers.",
      ],
    },
    {
      heading: "Your collection backup",
      paragraphs: [
        "Artlog backs up your collection so it can sync and be restored, whether or not you sign in. The backup holds your visits, saved artworks, notes, a numeric fingerprint of each saved artwork and private, resized copies of the photos you keep. Camera and location metadata are removed from those copies.",
        "Without an account, the backup is tied to an anonymous identity for this iPhone.",
      ],
    },
    {
      heading: "Helping other visitors",
      paragraphs: [
        "Saving an artwork confirmed from its wall label contributes the label’s details, the artwork’s numeric fingerprint and a small crop of your photo, at most 256 pixels wide, to a shared index. The crop may be shown to other visitors as the artwork’s thumbnail. Contributions don’t show who made them. When you delete your data, the crop is deleted; the label’s details and the fingerprint stay in the index, no longer linked to you.",
      ],
    },
    {
      heading: "Your location",
      paragraphs: [
        "Artlog uses your location only while you’re using the app, to find nearby museums on your iPhone. Apple Maps searches may send a search area centered on your location to Apple. Artlog’s servers receive the selected museum, but not your GPS coordinates. Confirming a new place also sends that place’s name, coordinates and website to Artlog.",
        "When you import a photo, Artlog may read the photo’s location on your iPhone to suggest the museum.",
      ],
    },
    {
      heading: "Your account",
      paragraphs: [
        "You can use Artlog without an account. On first launch, Artlog creates an anonymous identity for your iPhone and uses Apple’s App Attest to confirm that requests come from the genuine app.",
        "If you sign in with Apple or Google, we receive an account identifier and your email address if it’s provided. With Apple, this may be a private relay address. Google may also include your name and profile picture in the sign-in information sent to our servers. We store the account identifier and email address, but not the name or profile picture from sign-in. Your name from Apple or Google fills in the profile form on your iPhone; we store the name you choose when you save your profile.",
      ],
    },
    {
      heading: "Profiles and sharing",
      paragraphs: [
        "After signing in, you can create a profile with a username, a name and an optional bio and photo. Profiles are public: anyone can find them, including people without an account.",
        "A posted visit shows your profile, the museum, the date, your visit note, the artworks and the photos you select, to the audience you choose: only you, friends or everyone. You can post a visit without its note, and notes on visits you don’t post aren’t shared. Anyone can see public visits and your public wall. Opening an artwork you’ve shared shows its title, artist, date, medium and museum.",
        "We store friends, likes, comments and in-app notifications to show them to the people involved. Notifications are deleted after 30 days. Friend suggestions come from mutual friends, likes, and the artworks and museums you have in common with what other people have shared.",
        "If you turn on safety checks, our moderation provider, OpenAI, checks the comments, visit notes and profile bios you post for harmful content before others can see them. OpenAI receives only the text, not your name or account. Without safety checks, you can’t post comments, visit notes or a bio. Artlog asks when you first open it; to change your answer, open Settings, tap your name, then Safety checks.",
        "Exhibitions you save to Want to see are stored on Artlog’s servers, with your account once you sign in. If you have a profile, your friends see that you want to see them.",
        "Leaderboards show your profile and your number of saved artworks and visits. New profiles appear on the global leaderboard; you can change this in Settings → Leaderboards.",
      ],
    },
    {
      heading: "Reports and feedback",
      paragraphs: [
        "When you report a person, a post or AI-generated content, we keep the report and a copy of what was reported so we can review it. Feedback you send from Settings is stored with your app and iOS versions.",
      ],
    },
    {
      heading: "Crash reports",
      paragraphs: [
        "When the app or our servers hit an error, a report goes to Sentry with technical details such as the error, your device model and your iOS and app versions. Reports leave out photos, notes, location and the content of your requests. The app also records how long screens and requests take.",
      ],
    },
    {
      heading: "Service providers",
      paragraphs: [
        "These providers run parts of Artlog for us. They use your information only to provide their service and must give it the same or equal protection as this policy does:",
        "Convex hosts Artlog’s servers and database. Cloudflare stores backed-up photos, profile photos, shared index crops, fingerprints and audio. Pinecone searches artwork fingerprints. Nebius runs the AI models that read label text and write guides. Tavily searches the web for artwork information. OpenAI turns guides into narration and, if you turn on safety checks, checks comments, visit notes and profile bios for harmful content. Sentry receives crash reports. Expo delivers push notifications. Apple provides Sign in with Apple, App Attest and Maps search. Google provides Google sign-in.",
        "To look up artworks, our servers also send label details such as the title and artist, but nothing about you, to Wikidata, Wikipedia, Wikimedia Commons, the Art Institute of Chicago and museum websites. The app also loads artwork images and information directly from museums, Wikimedia and other public sources, which see your iPhone’s IP address as any website would.",
        "We may disclose information when the law requires it or to protect Artlog and its users. If Artlog changes ownership, this policy continues to apply to your information.",
      ],
    },
    {
      heading: "How long we keep information",
      paragraphs: [
        "We keep your collection backup until you delete your data. Records of deleted artworks remain in the backup, including their artwork details and visit information, and continue to sync across your devices. Deleting your account also removes your profile and posts.",
        "Scan fingerprints are deleted after 180 days unless they’ve been added to the shared index, and notifications after 30 days. We keep scan results, reports, feedback and shared index contributions to run and improve Artlog. Sentry keeps crash reports for a limited time.",
      ],
    },
    {
      heading: "Deleting your information",
      paragraphs: [
        "Deleting an artwork or photo removes the affected backed-up photo files. The artwork records described above remain. To delete your account, open Settings, tap your name, then Delete account. This deletes your profile, friends, posts, wall, likes, comments, notifications, Want to see exhibitions and the collection backed up with your account, and signs out your other devices. Without an account, open Settings → Your collection → Delete my data to delete this iPhone’s backup and Want to see exhibitions.",
        "Either way, Artlog also erases its data on this iPhone and deletes the photo crops you added to the shared index. Their label details and fingerprints, and your scan results, remain without any link to you, and reports and feedback you sent are kept without your name. Artlog data on your other devices stays until you delete the app there.",
      ],
    },
    {
      heading: "Your rights",
      paragraphs: [
        "Depending on where you live, you may have the right to access, correct, delete or export your information, or to object to how we use it. Contact us to make a request, and we’ll respond within the time the law requires.",
        "Because Artlog doesn’t track you across other companies’ apps and websites, it doesn’t respond differently to browser Do Not Track signals.",
      ],
    },
    {
      heading: "Children",
      paragraphs: [
        "Artlog isn’t intended for children under 13, and we don’t knowingly collect their information. If you believe a child has given us information, contact us and we’ll delete it.",
      ],
    },
    {
      heading: "Where information is processed",
      paragraphs: [
        "Our providers process information in the United States and other countries, whose data protection laws may differ from yours.",
      ],
    },
    {
      heading: "Changes",
      paragraphs: [
        "We’ll update this policy as Artlog changes and revise the date above. For significant changes, we’ll let you know in the app.",
      ],
    },
    { heading: "Contact", paragraphs: [CONTACT] },
  ],
};

const terms: LegalDocument = {
  title: "Terms of Service",
  updated: UPDATED,
  intro: [
    "These terms are an agreement between you and Daniel Jiang (“we”, “us”), the developer of Artlog. By using Artlog, you agree to them and to the Privacy Policy. If you don’t agree, don’t use the app.",
  ],
  sections: [
    {
      heading: "Using Artlog",
      paragraphs: [
        "You must be at least 13 years old to use Artlog. If you’re under the age of majority where you live, you need a parent’s or guardian’s permission.",
        "We may change, add or remove features at any time.",
      ],
    },
    {
      heading: "Your account",
      paragraphs: [
        "You can use Artlog without an account, or sign in with Apple or Google. You’re responsible for activity on your account and for keeping your devices secure. You can delete your account at any time in Settings.",
      ],
    },
    {
      heading: "Your content",
      paragraphs: [
        "Your photos, notes, reflections and other content stay yours. You give us a worldwide, royalty-free license to store, copy, process and display your content only as needed to run Artlog: for example, to back it up, sync it to your devices and show what you share to the audience you choose. This license ends when you delete the content or your account.",
        "Only share content you have the right to share.",
      ],
    },
    {
      heading: "Shared index contributions",
      paragraphs: [
        "Saving an artwork confirmed from its wall label adds the label’s details, a numeric fingerprint and a small crop of your photo to a shared index that helps others identify the same work. You give us a perpetual, irrevocable, worldwide, royalty-free license to use, store, modify and display these contributions in Artlog. When you delete your data, we delete your photo crops; the license continues for the label details and fingerprints.",
      ],
    },
    {
      heading: "Acceptable use",
      paragraphs: [
        "We don’t tolerate objectionable content or abusive users. Artlog automatically checks the comments, reflections, artwork details and profiles you share, and won’t post or show content it finds offensive.",
        "Don’t use Artlog to break the law or a museum’s photography rules; to post content that harasses, threatens or demeans others, or is sexually explicit, violent or hateful; to share other people’s private information, or photos of them without their permission; to impersonate anyone; to post spam; or to infringe anyone’s rights.",
        "Don’t interfere with Artlog: no scraping, overloading, probing for vulnerabilities, getting around limits, or accessing accounts or data that aren’t yours.",
      ],
    },
    {
      heading: "Reports and moderation",
      paragraphs: [
        "You can report people, posts, comments and AI-generated content in the app, and block anyone. We review reports within 24 hours and remove content that breaks these terms. We may also suspend or end the accounts that posted it.",
      ],
    },
    {
      heading: "AI-generated content",
      paragraphs: [
        "Artlog uses AI to identify artworks, read labels and write guides and narration. The narration voice is AI-generated. This content can be wrong or incomplete, so don’t rely on it to buy, value or authenticate art. Use Report to tell us when something’s wrong.",
      ],
    },
    {
      heading: "Artworks and other sources",
      paragraphs: [
        "Artwork information and images come from museums, Wikidata, Wikipedia, Wikimedia Commons and other sources. They belong to their owners and are subject to their licenses. Other sites and services linked from Artlog have their own terms.",
      ],
    },
    {
      heading: "Copyright complaints",
      paragraphs: [
        `If you believe something in Artlog infringes your copyright, report it in the app and choose Copyright infringement, or email ${EMAIL}. Include your name and contact details, the work you own, where it appears in Artlog, a statement that you believe in good faith its use isn’t authorized, and a statement that your notice is accurate and that you own the copyright or may act for its owner, with your signature.`,
        "We remove or disable content that a valid notice identifies and may end the accounts of people who repeatedly infringe.",
      ],
    },
    {
      heading: "Artlog’s source code",
      paragraphs: [
        "Artlog’s source code is available under the Mozilla Public License 2.0, which governs your use of the code. These terms govern your use of the app and its online services.",
      ],
    },
    {
      heading: "Apple",
      paragraphs: [
        "These terms are between you and us, not Apple. Apple isn’t responsible for Artlog or its content and has no obligation to provide maintenance or support. If Artlog fails to meet an applicable warranty, you may notify Apple for a refund of any purchase price; Apple has no other warranty obligation for Artlog. We, not Apple, are responsible for claims about Artlog, including product liability, legal compliance and intellectual property claims.",
        "You confirm that you aren’t in a country subject to a U.S. Government embargo or on a U.S. Government list of prohibited or restricted parties. You also agree to the App Store’s Usage Rules. Apple and its subsidiaries are third-party beneficiaries of these terms and may enforce them against you.",
      ],
    },
    {
      heading: "Ending use",
      paragraphs: [
        "You can stop using Artlog at any time and delete your account in Settings. We may suspend or end your access if you break these terms, or if we stop offering Artlog. The sections on contributions, disclaimers and liability continue to apply after that.",
      ],
    },
    {
      heading: "Disclaimers",
      paragraphs: [
        "Artlog is provided “as is” and “as available”, without warranties of any kind, including fitness for a particular purpose, accuracy and non-infringement, to the extent the law allows. We don’t guarantee that Artlog will be uninterrupted or error-free, or that your information will always be available, so keep your own copies of what matters to you.",
      ],
    },
    {
      heading: "Limitation of liability",
      paragraphs: [
        "To the extent the law allows, we aren’t liable for indirect, incidental, special, consequential or punitive damages, or for lost data, profits or goodwill. Our total liability for any claim about Artlog is limited to the greater of what you paid us for Artlog in the past 12 months or US$50. Some places don’t allow these limits, so they may not apply to you.",
      ],
    },
    {
      heading: "Governing law",
      paragraphs: [
        "California law governs these terms, without regard to its conflict-of-laws rules. Disputes about Artlog will be resolved in the state or federal courts located in California, and you and we agree to their jurisdiction. If you live outside the United States, you keep any protections your local law gives you that an agreement can’t take away.",
      ],
    },
    {
      heading: "Changes",
      paragraphs: [
        "We may update these terms. We’ll revise the date above and, for significant changes, let you know in the app. Continuing to use Artlog after a change means you accept the updated terms.",
      ],
    },
    { heading: "Contact", paragraphs: [CONTACT] },
  ],
};

const support: LegalDocument = {
  title: "Artlog Support",
  intro: [CONTACT],
  sections: [
    {
      heading: "Deleting your data",
      paragraphs: [
        "Open the Collection tab and tap the gear to reach Settings. If you’re signed in, tap your name, then Delete account. Without an account, tap Your collection, then Delete my data.",
      ],
    },
    {
      heading: "Reporting and blocking",
      paragraphs: [
        "Tap ••• on a post or profile to report it or block the person. Touch and hold a comment to report it. We review reports within 24 hours.",
      ],
    },
  ],
};

export const legalDocuments = { privacy, terms, support };

const escapeHtml = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

const linkEmail = (html: string) => html.replaceAll(EMAIL, `<a href="mailto:${EMAIL}">${EMAIL}</a>`);

export function renderLegalPage({ title, updated, intro, sections }: LegalDocument) {
  const paragraphs = (texts: string[]) => texts.map((text) => `<p>${linkEmail(escapeHtml(text))}</p>`).join("");
  return renderPage(
    title,
    `<h1>${escapeHtml(title)}</h1>
${updated ? `<p class="updated">Last updated ${escapeHtml(updated)}</p>` : ""}
${paragraphs(intro)}
${sections.map(({ heading, paragraphs: texts }) => `<h2>${escapeHtml(heading)}</h2>${paragraphs(texts)}`).join("\n")}`,
  );
}

export function renderLicensesPage({ entries, texts }: ThirdPartyNotices) {
  const title = "Open source licenses";
  const notices = entries.map(({ name, version, license, holder, text }) => {
    const meta = [version, license, holder].filter(Boolean).map((part) => escapeHtml(String(part)));
    return `<h2>${escapeHtml(name)}</h2><p class="meta">${meta.join(" · ")}</p><p class="notice">${escapeHtml(texts[text] ?? "")}</p>`;
  });
  return renderPage(
    title,
    `<h1>${title}</h1>
<p class="updated">${entries.length} libraries in the Artlog for iOS build</p>
<p>Artlog is built with these open source libraries. Each is listed with its version, license and the notice its authors ask to be reproduced.</p>
${notices.join("\n")}`,
  );
}

function renderPage(title: string, body: string) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(title)} · Artlog</title>
<style>
body { margin: 0; background: #fff; color: #1B2531; font: 17px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; -webkit-text-size-adjust: 100%; }
main { max-width: 40rem; margin: 0 auto; padding: 32px 20px 48px; }
h1 { margin: 0 0 4px; font-size: 30px; line-height: 1.25; letter-spacing: -0.02em; }
h2 { margin: 32px 0 8px; font-size: 18px; line-height: 1.3; }
p { margin: 0 0 12px; }
.updated, .meta, nav { color: #66717C; font-size: 14px; }
.updated { margin-bottom: 24px; }
.meta { margin: -4px 0 8px; }
.notice { font-size: 14px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
a { color: #254FD4; }
nav { margin-top: 40px; padding-top: 16px; border-top: 1px solid #DCE1E8; }
</style>
</head>
<body>
<main>
${body}
<nav><a href="/support">Support</a> · <a href="/privacy">Privacy Policy</a> · <a href="/terms">Terms of Service</a> · <a href="/licenses">Open source licenses</a></nav>
</main>
</body>
</html>
`;
}
