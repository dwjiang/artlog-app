import { expect, it } from "vitest";

import { renderLegalPage, renderLicensesPage } from "./lib/legalPages";
import notices from "./lib/thirdPartyNotices.json";
import { harness } from "./test.helpers";

it.each([
  ["/privacy", "Privacy Policy", "Identifying art"],
  ["/terms", "Terms of Service", "Governing law"],
  ["/support", "Artlog Support", "Deleting your data"],
])("serves %s as a public web page", async (path, title, heading) => {
  const response = await harness().fetch(path);
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
  const html = await response.text();
  expect(html).toContain(`<h1>${title}</h1>`);
  expect(html).toContain(`<h2>${heading}</h2>`);
  expect(html).toContain('<a href="mailto:danieljiang1999@gmail.com">danieljiang1999@gmail.com</a>');
  expect(html).toContain('<a href="/licenses">Open source licenses</a>');
});

it("serves /licenses with a notice for every library in the app build", async () => {
  const response = await harness().fetch("/licenses");
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
  const html = await response.text();
  expect(html).toContain("<h1>Open source licenses</h1>");
  expect(html).toContain("<h2>react-native</h2>");
  expect(html.match(/<h2>/g)).toHaveLength(notices.entries.length);
  expect(html).toContain("Permission is hereby granted, free of charge");
});

it("lists each library with its version, license and notice", () => {
  const html = renderLicensesPage({
    entries: [
      { name: "boost", license: "BSL-1.0", text: 1 },
      { name: "expo", version: "57.0.1", license: "MIT", text: 0 },
      { name: "metro-runtime", version: "0.84.5", license: "MIT", holder: "Meta <oss@meta.com>", text: 0 },
    ],
    texts: ['Permission is hereby granted.\n\nTHE SOFTWARE IS PROVIDED "AS IS".', "Boost Software License"],
  });
  expect(html).toContain('<h2>boost</h2><p class="meta">BSL-1.0</p><p class="notice">Boost Software License</p>');
  expect(html).toContain('<h2>expo</h2><p class="meta">57.0.1 · MIT</p>');
  expect(html).toContain('<p class="meta">0.84.5 · MIT · Meta &lt;oss@meta.com&gt;</p>');
  expect(html).toContain(
    '<p class="notice">Permission is hereby granted.\n\nTHE SOFTWARE IS PROVIDED &quot;AS IS&quot;.</p>',
  );
  expect(html.match(/<h2>/g)).toHaveLength(3);
});

it("escapes document text as HTML", () => {
  const html = renderLegalPage({
    title: "Terms & <Conditions>",
    updated: "Today",
    intro: ['Say "hi" <b>loudly</b>'],
    sections: [{ heading: "A & B", paragraphs: ["x < y"] }],
  });
  expect(html).toContain("<h1>Terms &amp; &lt;Conditions&gt;</h1>");
  expect(html).toContain("<p>Say &quot;hi&quot; &lt;b&gt;loudly&lt;/b&gt;</p>");
  expect(html).toContain("<h2>A &amp; B</h2><p>x &lt; y</p>");
});
