import { describe, expect, it } from "vitest";

import {
  artworkImageEvidence,
  parseCaptionIdentity,
} from "./exhibitionIdentity";

const pageUrl = "https://museum.example/exhibitions/colour";
const imageUrl = "https://museum.example/blue.jpg";
const html = (nodes: unknown) =>
  `<title>A Century of Colour</title><script type="application/ld+json">${JSON.stringify(nodes)}</script>`;

describe("identity of the matched exhibition image", () => {
  it("selects the matching artwork from a multi-work exhibition, never the first work or exhibition title", () => {
    const evidence = artworkImageEvidence(
      html({
        "@type": "ExhibitionEvent",
        name: "A Century of Colour",
        workFeatured: [
          {
            "@type": "Painting",
            name: "Red",
            creator: "First Artist",
            image: "/red.jpg",
          },
          {
            "@type": "Painting",
            name: "Blue",
            creator: { name: "Second Artist" },
            image: "/blue.jpg",
          },
        ],
      }),
      pageUrl,
      imageUrl,
    );
    expect(evidence).toEqual({
      fields: { title: "Blue", artist: "Second Artist" },
    });
  });

  it("reads array creators, PropertyValue identifiers and image objects, and never takes a URL identifier as an accession", () => {
    const work = {
      "@type": ["Painting", "CreativeWork"],
      name: "Blue",
      creator: [{ "@type": "Person", name: "Second Artist" }],
      image: [{ "@type": "ImageObject", contentUrl: "/blue.jpg" }],
    };
    expect(
      artworkImageEvidence(
        html({
          "@graph": [
            {
              ...work,
              identifier: { "@type": "PropertyValue", value: "1917.42" },
            },
          ],
        }),
        pageUrl,
        imageUrl,
      ),
    ).toEqual({
      fields: { title: "Blue", artist: "Second Artist", accession: "1917.42" },
    });
    expect(
      artworkImageEvidence(
        html({ ...work, identifier: "https://museum.example/objects/1" }),
        pageUrl,
        imageUrl,
      ),
    ).toEqual({ fields: { title: "Blue", artist: "Second Artist" } });
  });

  it("does not use generic page metadata or a different artwork for the matched image", () => {
    expect(
      artworkImageEvidence(
        '<meta property="og:title" content="A Century of Colour"><meta property="og:image" content="/blue.jpg">',
        pageUrl,
        imageUrl,
      ),
    ).toEqual({});
    expect(
      artworkImageEvidence(
        html({
          "@type": "Painting",
          name: "Red",
          creator: "First Artist",
          image: "/red.jpg",
        }),
        pageUrl,
        imageUrl,
      ),
    ).toEqual({});
  });

  it("refuses conflicting identities assigned to the same image", () => {
    expect(
      artworkImageEvidence(
        html([
          {
            "@type": "Painting",
            name: "Red",
            creator: "First Artist",
            image: imageUrl,
          },
          {
            "@type": "Painting",
            name: "Blue",
            creator: "Second Artist",
            image: imageUrl,
          },
        ]),
        pageUrl,
        imageUrl,
      ),
    ).toEqual({});
  });

  it("uses only the caption attached to the matched image", () => {
    const page =
      '<figure><img src="/red.jpg"><figcaption>First Artist, Red</figcaption></figure>'
      + '<figure><picture><img src="/blue.jpg"></picture><figcaption>Second Artist, <em>Blue</em>, 2020.</figcaption></figure>';
    expect(artworkImageEvidence(page, pageUrl, imageUrl)).toEqual({
      caption: "Second Artist, Blue, 2020.",
    });
  });

  it("rejects captions shared across different images", () => {
    expect(
      artworkImageEvidence(
        '<figure><img src="/red.jpg"><img src="/blue.jpg"><figcaption>First Artist, Red; Second Artist, Blue.</figcaption></figure>',
        pageUrl,
        imageUrl,
      ),
    ).toEqual({});
  });

  it("accepts only complete title/artist values present in the image caption", () => {
    const parse = parseCaptionIdentity(
      "Second Artist, Blue, 2020.",
      "A Century of Colour",
    );
    expect(parse({ title: "Blue", artist: "Second Artist" })).toEqual({
      title: "Blue",
      artist: "Second Artist",
    });
    expect(
      parse({ title: "A Century of Colour", artist: "Second Artist" }),
    ).toBeNull();
    expect(parse({ title: "Blue", artist: "Invented Artist" })).toBeNull();
    expect(parse({ title: null, artist: null })).toEqual({});
  });
});
