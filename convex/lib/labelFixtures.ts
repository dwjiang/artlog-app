// Recorded Tavily and Wikidata responses, including live Wikidata data from 2026-09-10;
// only the fields the verifier reads are kept.

const artic = (path: string) => `https://www.artic.edu${path}`;
const met = (path: string) => `https://www.metmuseum.org${path}`;
const cma = (path: string) => `https://www.clevelandart.org${path}`;
const moma = (path: string) => `https://www.moma.org${path}`;

export const tavilySeurat = {
  query: '"A Sunday on La Grande Jatte" Georges Seurat',
  images: [
    artic('/iiif/2/2d484387-2509-5e8e-2c43-22f9981972eb/full/843,/0/default.jpg'),
    'https://shop.artic.edu/cdn/shop/files/60442_2_1024x728.jpg?v=1763657967',
    'https://archive.artic.edu/seurat/images/lagrandejatte.jpg',
  ],
  results: [
    {
      url: artic('/artworks/150773/seated-woman-with-a-parasol-study-for-la-grande-jatte'),
      title: 'Seated Woman with a Parasol (study for La Grande Jatte) | The Art Institute of Chicago',
      content: 'During 1884 and 1885, Georges Seurat was hard at work on the most ambitious painting of his career, A Sunday on La Grande Jatte—1884, now a centerpiece of the Art Institute’s collection of 19th-century French painting.',
      score: 0.8536326,
      images: [artic('/iiif/2/8769be30-7bda-37f2-16a8-30e5396d47dc/full/843,/0/default.jpg')],
    },
    {
      url: artic('/artworks/61616/oil-sketch-for-a-sunday-on-la-grande-jatte-1884'),
      title: 'Oil Sketch for "A Sunday on La Grande Jatte — 1884" | The Art Institute of Chicago',
      content: 'This small oil on thin wood panel is one of over 20 painted studies Georges Seurat made for A Sunday on La Grande Jatte—1884.',
      score: 0.8497846,
      images: [artic('/iiif/2/081be15c-8812-c174-eeb2-cf318a2e67cf/full/843,/0/default.jpg')],
    },
    {
      url: 'https://shop.artic.edu/products/60442',
      title: 'Georges Seurat A Sunday on La Grande Jatte—1884 Poster – The Art Institute of Chicago Museum Shop',
      content: 'Poster developed from Georges Seurat’s A Sunday on La Grande Jatte—1884, 1884/86 from The Art Institute of Chicago’s collection.',
      score: 0.8430832,
      images: ['https://shop.artic.edu/cdn/shop/files/60442_2_1200x853.jpg?v=1763657967'],
    },
    {
      url: artic('/artists/40810/georges-seurat'),
      title: 'Georges Seurat | The Art Institute of Chicago',
      content: 'Large painting of people in a crowded park, brushstrokes are dots. A Sunday on La Grande Jatte — 1884, 1884–86, border added 1888–89 Georges Seurat',
      score: 0.8184036,
      images: ['https://artic-web.imgix.net/a0b8219d-bd2c-41d2-b99d-58a7549f59d8/Georges_Seurat_1888.jpg'],
    },
    {
      url: artic('/artworks/27992/a-sunday-on-la-grande-jatte-1884'),
      title: 'A Sunday on La Grande Jatte — 1884',
      content: '## Status\n:   On View, Gallery 240\n\n## Department\n:   Painting and Sculpture of Europe\n\n## Artist\n:   Georges Seurat\n\n## Title\n:   A Sunday on La Grande Jatte — 1884',
      score: 0.81133276,
      images: [
        artic('/iiif/2/2d484387-2509-5e8e-2c43-22f9981972eb/full/843,/0/default.jpg'),
        'https://artic-web.imgix.net/b55a24a5-ab1c-453e-9ecd-e30ee5473f6e/navigation-thumbnail-visit.jpg?auto=format&q=1',
      ],
    },
  ],
  usage: { credits: 1 },
  request_id: 'seurat-fixture',
};

export const tavilyMonet = {
  query: '"Water Lilies" Claude Monet',
  images: [
    'https://collectionapi.metmuseum.org/api/collection/v1/iiif/437127/2331256/source',
    'https://vitruvius.museumseven.com/render/600-600@2/dp-489064-30.jpg',
  ],
  results: [
    {
      url: met('/art/collection/search/437137'),
      title: 'Claude Monet - Water Lilies - The Metropolitan Museum of Art',
      content: '# Water Lilies\n\nWater Lilies, Claude Monet (French, Paris 1840–1926 Giverny), Oil on canvas\n\n## Artwork Details\n\n## More Artwork\n\nBridge over a Pond of Water Lilies, Claude Monet  French, Oil on canvas',
      score: 0.8380581,
      images: [
        'https://collectionapi.metmuseum.org/api/collection/v1/iiif/437137/2018391/restricted',
        'https://images.metmuseum.org/CRDImages/ep/web-large/DP-40794-001.jpg',
        'https://images.metmuseum.org/CRDImages/mi/web-large/238693.jpg',
        'https://images.metmuseum.org/CRDImages/ep/web-large/DT1570.jpg',
        'https://cdn.sanity.io/images/cctd4ker/production/3ff67a6c75da93b3aa6b180e3e6444edbe384621-250x304.jpg?w=3840&q=75',
      ],
    },
    {
      url: 'https://customprints.metmuseum.org/detail/489058/monet-water-lilies',
      title: 'Water Lilies by Claude Monet | Paper Print | Met Custom Prints',
      content: 'As part of his extensive gardening plans at Giverny, Monet had a pond dug and planted with lilies in 1893. Water Lilies by Claude Monet.',
      score: 0.79769903,
      images: ['https://customprints.metmuseum.org/vitruvius/render/1200/489058.jpg'],
    },
    {
      url: met('/perspectives/monet-conversation'),
      title: 'Exploring Late Monet with Art Historian Kathryn Calley Galitz - The Metropolitan Museum of Art',
      content: 'Water Lilies (1916–19) by Monet\n\nClaude Monet (French, 1840–1926). Water Lilies, 1916–19. Oil on canvas, 51 1/4 x 79 in. The Metropolitan Museum of Art, New York, Gift of Louise Reinhardt Smith, 1983',
      score: 0.79119295,
      images: ['https://cdn.sanity.io/images/cctd4ker/production/cca3f8a98beb107f9c647bb946bbbe3b6740b6ed-3200x1800.jpg'],
    },
    {
      url: met('/art/collection/search/438008'),
      title: 'Claude Monet - Water Lilies - The Metropolitan Museum of Art',
      content: '# Water Lilies\n\nWater Lilies, Claude Monet (French, Paris 1840–1926 Giverny), Oil on canvas\n\n## Artwork Details\n\n## Audio',
      score: 0.78334314,
      images: ['https://collectionapi.metmuseum.org/api/collection/v1/iiif/438008/1606693/restricted'],
    },
    {
      url: met('/art/collection/search/437127'),
      title: 'Claude Monet - Bridge over a Pond of Water Lilies - The Metropolitan Museum of Art',
      content: 'Bridge over a Pond of Water Lilies, Claude Monet (French, Paris 1840–1926 Giverny), Oil on canvas',
      score: 0.7610953,
      images: ['https://collectionapi.metmuseum.org/api/collection/v1/iiif/437127/2331256/restricted'],
    },
  ],
  usage: { credits: 1 },
  request_id: 'monet-fixture',
};

export const tavilyRodin = {
  query: '"The Thinker" Auguste Rodin',
  images: ['https://openaccess-cdn.clevelandart.org/1917.42/1917.42_print.jpg'],
  results: [
    {
      url: cma('/art/1979.138'),
      title: 'The Thinker | Cleveland Museum of Art',
      content: 'A shiny dark-brown and green bronze sculpture depicts a muscular, nude man seated, his right elbow supported by his left knee as he rests his chin on the back of his hand. Auguste Rodin, bronze, 1979.138.',
      score: 0.8095324,
      images: [cma('/_next/image?url=https%3A%2F%2Fpiction.clevelandart.org%2Fcma%2Fump.di%3Ff%3D1979.138_o5.jpg&w=640&q=75')],
    },
    {
      url: cma('/art/1917.42'),
      title: 'The Thinker | Cleveland Museum of Art',
      content: '# Artwork Page for The Thinker\n\n## Details / Information for The Thinker\n\n### The Thinker\n\n#### Auguste Rodin\n\n(French, 1840–1917)\n\nCulture\n\nFrance, 19th century\n\nMedium\n\nbronze',
      score: 0.78334314,
      images: [cma('/_next/image?url=https%3A%2F%2Fpiction.clevelandart.org%2Fcma%2Fump.di%3Ff%3D1917.42_o5.jpg&w=640&q=75')],
    },
    {
      url: cma('/articles/rodin-100-years'),
      title: 'Rodin—100 Years | Cleveland Museum of Art',
      content: 'A universal image of a man lost in thought, The Thinker has become one of the most celebrated sculptures in the history of art. Rodin originally planned to place the figure in the lintel above the doors.',
      score: 0.76972175,
      images: ['https://web-drupal-cms-prod.clevelandart.org/sites/default/files/R1_A3.jpg'],
    },
  ],
  usage: { credits: 1 },
  request_id: 'rodin-fixture',
};

export const tavilyStarryNight = {
  query: '"The Starry Night" Vincent van Gogh',
  images: [moma('/media/W1siZiIsIjQ2NzUxNyJdLFsicCIsImNvbnZlcnQiLCItcXVhbGl0eSA5MCAtcmVzaXplIDIwMDB4MjAwMFx1MDAzZSJdXQ.jpg?sha=314ebf8cc678676f')],
  results: [
    {
      url: moma('/audio/playlist/3/4289'),
      title: 'Vincent van Gogh. The Starry Night. Saint Rémy, June 1889 | MoMA',
      content: 'The Starry Night is inspired by the view from Vincent van Gogh’s window at an asylum in Saint-Rémy, in southern France, where he spent a year receiving treatment for mental illness.',
      score: 0.903098,
      images: [
        moma('/media/W1siZiIsIjQ2NzUxNyJdLFsicCIsImNvbnZlcnQiLCItcXVhbGl0eSA5MCAtcmVzaXplIDIwMDB4MjAwMFx1MDAzZSJdXQ.jpg?sha=314ebf8cc678676f'),
        'https://c1.adform.net/serving/cookie/match?cid=10cbf54c-f147-410d-801f-b09d1650b40e&party=1296',
        'https://s.amazon-adsystem.com/iu3?pid=f7bb3c27-45c5-4b23-8c6f-c6c6f2907f38&event=PageView',
        'https://secure.adnxs.com/seg?add=34571930&t=2',
      ],
    },
    {
      url: moma('/collection/works/79802'),
      title: 'Vincent van Gogh. The Starry Night. Saint Rémy, June 1889',
      content: '_The Starry Night_ is based on van Gogh’s direct observations as well as his imagination, memories, and emotions.',
      score: 0.8939131,
      images: [],
    },
    {
      url: 'https://store.moma.org/products/van-gogh-the-starry-night-3',
      title: 'Van Gogh: The Starry Night – MoMA Design Store',
      content: 'This poster features a reproduction of The Starry Night by Vincent van Gogh, one of the most popular paintings in MoMA’s collection.',
      score: 0.82560414,
      images: ['http://store.moma.org/cdn/shop/files/4488_a_94c65c14-58ec-4bcd-b7fc-a9a07db805b9.jpg?v=1704232502'],
    },
  ],
  usage: { credits: 1 },
  request_id: 'starry-night-fixture',
};

const item = (id: string) => ({ mainsnak: { snaktype: 'value', datavalue: { type: 'wikibase-entityid', value: { id } } } });
const time = (value: string) => ({ mainsnak: { snaktype: 'value', datavalue: { type: 'time', value: { time: value, precision: 11 } } } });
const label = (value: string) => ({ en: { language: 'en', value } });

export const wikidataSearchWaterLilies = {
  search: [
    { id: 'Q1189907', label: 'Water Lilies', description: 'series of approximately 250 paintings by Claude Monet' },
    { id: 'Q7973309', label: 'Water Lilies', description: '1919 painting by Claude Monet' },
    { id: 'Q93512', label: 'Water Lilies', description: '2007 French drama film directed by Céline Sciamma' },
  ],
  success: 1,
};

export const wikidataSearchMonet = {
  search: [{ id: 'Q296', label: 'Claude Monet', description: 'French impressionist painter (1840–1926)' }],
  success: 1,
};

export const wikidataEntities: Record<string, object> = {
  Q1189907: {
    id: 'Q1189907', labels: label('Water Lilies'),
    claims: { P31: [item('Q15727816')], P170: [item('Q296')], P17: [item('Q142')] },
  },
  Q7973309: {
    id: 'Q7973309', labels: label('Water Lilies'),
    claims: { P31: [item('Q3305213')], P170: [item('Q296')], P195: [item('Q160236')], P571: [time('+1919-01-01T00:00:00Z')] },
  },
  Q93512: {
    id: 'Q93512', labels: label('Water Lilies'), claims: { P31: [item('Q11424')] },
  },
  Q296: {
    id: 'Q296', labels: label('Claude Monet'),
    claims: {
      P31: [item('Q5')], P106: [item('Q1028181'), item('Q1925963')],
      P569: [time('+1840-11-14T00:00:00Z')], P570: [time('+1926-12-05T00:00:00Z')],
      P6379: [item('Q160236'), item('Q679527')],
    },
  },
  Q160236: {
    id: 'Q160236', labels: label('Metropolitan Museum of Art'),
    claims: { P31: [item('Q207694')], P17: [item('Q30')] },
  },
  Q679527: {
    id: 'Q679527', labels: label('Museum Boijmans Van Beuningen'),
    claims: { P31: [item('Q3196771')], P17: [item('Q55')] },
  },
  Q1234567: {
    id: 'Q1234567', labels: label('Test Museum'),
    claims: { P31: [item('Q207694')], P17: [item('Q142')] },
  },
};

export function wikidataEntitiesResponse(ids: string[]): { entities: Record<string, object> } {
  const entities: Record<string, object> = {};
  for (const id of ids) entities[id] = wikidataEntities[id] ?? { id, missing: '' };
  return { entities };
}

export const jsonLdPage = `<!doctype html><html><head>
<title>Claude Monet - Water Lilies - The Metropolitan Museum of Art</title>
<meta property="og:title" content="Claude Monet - Water Lilies - The Metropolitan Museum of Art">
<meta property="og:image" content="https://collectionapi.metmuseum.org/api/collection/v1/iiif/437137/2018391/main-image">
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"VisualArtwork","name":"Water Lilies","creator":{"@type":"Person","name":"Claude Monet"},
 "dateCreated":"1919","artMedium":"Oil on canvas","identifier":"1998.325.2","creditText":"Gift of Louise Reinhardt Smith, 1983",
 "image":"https://collectionapi.metmuseum.org/api/collection/v1/iiif/437137/2018391/main-image"}
</script></head><body><h1>Water Lilies</h1><p>Accession Number: 1998.325.2</p></body></html>`;

export const graphPage = `<html><head><script type="application/ld+json">
{"@context":"https://schema.org","@graph":[{"@type":"WebPage","name":"Collection"},
 {"@type":["Painting","CreativeWork"],"name":"The Thinker","creator":[{"@type":"Person","name":"Auguste Rodin"}],
  "dateCreated":"1880–81, cast 1916","material":"bronze","identifier":{"@type":"PropertyValue","value":"1917.42"},
  "image":[{"@type":"ImageObject","contentUrl":"https://openaccess-cdn.clevelandart.org/1917.42/1917.42_web.jpg"}]}]}
</script></head><body></body></html>`;

export const metaPage = `<html><head>
<meta name="author" content="Edward Hopper">
<meta content="Nighthawks | The Art Institute of Chicago" property="og:title" />
<meta property="og:image" content="https://www.artic.edu/iiif/2/831a05de-d3f6-f4fa-a460-23008dd58dda/full/843,/0/default.jpg">
<title>Nighthawks &amp; more | The Art Institute of Chicago</title>
<style>.a{width:12.5px}</style>
</head><body><script>var x = "99.9999";</script>
<dl><dt>Reference Number</dt><dd>1942.51</dd><dt>Dimensions</dt><dd>84.1 &times; 152.4 cm</dd></dl>
<p>Object number 1942.51</p></body></html>`;

export const plainPage = '<html><head><title>Visit us</title></head><body><p>Opening hours</p></body></html>';

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });
}

export function completion(content: unknown, finishReason = 'stop'): Response {
  return jsonResponse({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: finishReason }] });
}

export const labelReading = {
  title: 'Water Lilies', artist: 'Claude Monet', artist_dates: 'French, 1840–1926', work_date: '1919',
  medium: 'Oil on canvas', accession: '1998.325.2', credit_line: 'Gift of Louise Reinhardt Smith, 1983',
  confidence: { title: 0.98, artist: 0.99, work_date: 0.9, medium: 0.95, accession: 0.8 },
};
