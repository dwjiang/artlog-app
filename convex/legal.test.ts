import { expect, it } from "vitest";

import { renderLegalPage } from "./lib/legalPages";
import { harness } from "./test.helpers";

it.each([
  ["/privacy", "Privacy Policy", "Identifying art"],
  ["/terms", "Terms of Service", "Governing law"],
])("serves %s as a public web page", async (path, title, heading) => {
  const response = await harness().fetch(path);
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
  const html = await response.text();
  expect(html).toContain(`<h1>${title}</h1>`);
  expect(html).toContain(`<h2>${heading}</h2>`);
  expect(html).toContain('<a href="mailto:danieljiang1999@gmail.com">danieljiang1999@gmail.com</a>');
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
