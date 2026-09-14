// Recorded Tavily "Right now" responses, trimmed to the
// fields the acceptance boundary reads. Answers and snippets are verbatim; dates are service metadata.
import type { TavilySearchResponse } from './tavily';

export const FIXTURE_NOW = Date.parse('2026-09-08T12:00:00Z');

export type RightNowFixture = { artist: string; region: string; note: string; response: TavilySearchResponse };

export const kusamaSf: RightNowFixture = {
  artist: "Yayoi Kusama", region: "sf-bay-area",
  note: "accepted: first sentence supported by the top Chronicle article",
  response: {
    answer: "Yayoi Kusama, the renowned Japanese artist known for her signature polka dots, passed away on August 14, 2026, in Tokyo at the age of 97. Her 2023 solo exhibition \"Yayoi Kusama: Infinite Love\" at the San Francisco Museum of Modern Art attracted over 170,000 visitors during its six-month run. The museum also acquired the \"Infinity Mirror Room,\" \"Dreaming of Earth’s Sphericity, I Would Offer My Love\" (2023) during the exhibition.",
    images: [], credits: 1, requestId: "172dd362-eeda-40b9-bd9d-361f2ea9e1d4",
    results: [
      {
        url: "https://www.sfchronicle.com/entertainment/arts-exhibits/article/yayoi-kusama-death-sfmoma-controversy-22406208.php",
        title: "How Yayoi Kusama’s San Francisco triumph became an SFMOMA reckoning",
        content: "During the run of the show, the institution eventually acquired the “Infinity Mirror Room,” “Dreaming of Earth’s Sphericity, I Would Offer My Love” (2023).\n\nA party guest stands near Yayoi Kusama’s “Aspiring to Pumpkin’s Love, the Love in My Heart” in 2025. Her 2023 solo exhibition “Yayoi Kusama: Infinite Love” brought more than 170,000 visitors to the museum during its six-month run.\n\nCarlos Avila Gonzalez/S.F. Chronicle\n\nThis was Kusama at a major career pinnacle. [...] Subscribe\n\nArts & Entertainment//Arts & Exhibits\n\n# How Yayoi Kusama’s San Francisco triumph became an SFMOMA reckoning\n\nBy Tony Bravo, Arts & Culture ColumnistUpdated\n\nYayoi Kusama, pictured here in Tokyo, in 2012. The artist died on Aug. 14, at age 97.\n\nItsuo Inouye/Associated Press\n\nFor many Bay Area museumgoers, Yayoi Kusama’s first solo Northern California exhibition at the San Francisco Museum of Modern Art in 2023 became the backdrop for selfies and Instagram reels. [...] Now, with news of Kusama’s death in Tokyo at 97 on Aug. 14, confirmed by the Yayoi Kusama Studio this week, the controversy that shadowed that SFMOMA show is inseparable from her local legacy.",
        score: 0.6964752, publishedDate: "Thu, 27 Aug 2026 20:28:25 GMT", images: [],
      },
      {
        url: "https://www.mercurynews.com/2026/08/26/yayoi-kusama-who-splashed-polka-dots-across-the-art-world-dies-at-97-in-tokyo",
        title: "Yayoi Kusama, who splashed polka dots across the art world, dies at 97 in Tokyo",
        content: "TOKYO (AP) — Japanese artist Yayoi Kusama, who splashed her signature polka dots on paintings, sculptures and museum installations around the world,",
        score: 0.35999444, publishedDate: "Tue, 25 Aug 2026 11:00:00 GMT", images: [],
      },
      {
        url: "https://www.mercurynews.com/2026/08/26/yayoi-kusama-who-splashed-polka-dots-across-art-world-dies-at-97/amp",
        title: "Yayoi Kusama, who splashed polka dots across art world, dies at 97",
        content: "TOKYO (AP) — Japanese artist Yayoi Kusama, who splashed her signature polka dots on paintings, sculptures and museum installations around the world,",
        score: 0.35770264, publishedDate: "Tue, 25 Aug 2026 11:00:00 GMT", images: [],
      },
      {
        url: "https://www.sfchronicle.com/sports/article/the-year-in-review-influential-people-who-have-22418109.php",
        title: "The year in review: Influential people who have died in 2026",
        content: "Yayoi Kusama, 97. She was the Japanese artist who splashed her signature polka dots on paintings, sculptures and museum installations around the world. Aug. 14.\n\nTommy John, 83. He won 288 games during a 26-year big league career and became the first pitcher to successfully return following groundbreaking elbow surgery that later was named after him. Aug. 15. [...] Other noteworthy people who died in August include former Chinese premier Zhu Rongji, actor Tim Curry, ZZ Top drummer Frank Beard, Japanese artist Yayoi Kusama, Canadian TV news anchor Lloyd Robertson and Norwegian King Harald V.\n\nHere is a roll call of some influential figures who have died this year (the cause of death is cited, if available):\n\n\\_\\_\\_\n\nJANUARY \\_\\_\\_\n\nAdvertisement\n\nArticle continues below this ad [...] Valentino Garavani, 93. He was the jet-set Italian designer whose high-glamour gowns — often in his trademark shade of “Valentino red” — were fashion show staples for nearly half a century. Jan. 19.\n\nAdvertisement\n\nArticle continues below this ad\n\nOta Zaremba, 68. He won a weightlifting gold medal at the 1980 Moscow Olympics before admitting to using performance-enhancing drugs under a secret program run by the totalitarian regime in the former Czechoslovakia. Jan. 23.",
        score: 0.2808584, publishedDate: "Fri, 04 Sep 2026 18:31:21 GMT", images: [],
      },
    ],
  },
};

export const kusamaNy: RightNowFixture = {
  artist: "Yayoi Kusama", region: "new-york",
  note: "refused: answer says August 9 while the sources say Aug. 14",
  response: {
    answer: "As of August 9, 2026, Yayoi Kusama, the renowned Japanese artist, passed away at the age of 97 in Tokyo. Her career spanned several decades, marked by her innovative contributions to various art forms including painting, sculpture, installation, and performance. Kusama's work, characterized by themes of infinity, accumulation, and polka dots, gained global recognition in recent years, with significant exhibitions and collaborations, including her museum in Tokyo and her partnership with Louis Vuitton. Despite her reclusive nature in her later years, her influence on contemporary art remains profound.",
    images: [], credits: 1, requestId: "841a14ce-a24e-47fb-80f4-9882d4179c95",
    results: [
      {
        url: "https://www.nytimes.com/2026/09/02/arts/design/yayoi-kusama-final-years.html",
        title: "The Mysterious and Lonely Final Decade of Yayoi Kusama’s Life - The New York Times",
        content: "In April, the gallerist David Zwirner will exhibit a selection of Kusama’s final works in New York.\n\n“We’re so excited about the last decade,” the dealer said. “Arguably, this was the most extraordinary and successful decade of her career.”\n\nIt was also the most elusive, as the artist receded from view. [...] One of Kusama’s last public appearances was in 2017 at the opening of her museum in Tokyo. Longtime friends, curators and collectors said that she stopped receiving most guests in 2019 at the psychiatric hospital where she had lived for decades.\n\nYet her studio — a small group of assistants meant to carry out her artistic vision — was more prolific than ever, producing dozens of paintings and sculptures with her signature. [...] In 2024, a new pumpkin sculpture on the Yayoi Kusama Museum’s Tokyo rooftop prompted questions. Although it was signed and dated by the artist, it was created at a time when, according to those closest to her, she was mostly bedridden and making paintings with the help of assistants who carried small canvases to her.\n\nWe are having trouble retrieving the article content.\n\nPlease enable JavaScript in your browser settings.",
        score: 0.7125728, publishedDate: "Wed, 02 Sep 2026 15:14:25 GMT", images: [],
      },
      {
        url: "https://www.nytimes.com/interactive/2026/09/01/arts/yayoi-kusama-art-pieces.html",
        title: "The Genius of Yayoi Kusama in Three Works - The New York Times",
        content: "In December 1963, Kusama showed her first known immersive installation, “Aggregation: One Thousand Boats Show,” in a solo exhibition at Gertrude Stein Gallery, on Manhattan’s East 81st Street. [...] The mesmerizing art of Yayoi Kusama —who died in Tokyo on Aug. 14, at 97 — has in recent decades become ubiquitous, visible inblockbuster exhibitions and public spaces across the world,splashed across the facades of high-end luxury stores and snapped in thousands of selfies. But the characteristic motifs and themes — accumulation, infinity, love, life, death — of the artist born in 1929 in rural Japan, where creative expectations for women were nonexistent, have dominated her oeuvre since she [...] “I will keep painting until I die,” she told The Associated Press in 2012, and she did. Kusama also innovated across mediums including sculpture, installation, film, performance, fashion and literature. We look at three defining works in detail.\n\nPhoto of “Aggregation: One Thousand Boats Show” installation in New York, featuring a rowboat ornamented with white soft-sculpture protrusions.\n\nAggregation: One Thousand Boats Show",
        score: 0.7043437, publishedDate: "Tue, 01 Sep 2026 16:32:32 GMT", images: [],
      },
      {
        url: "https://www.nytimes.com/2026/09/06/opinion/yayoi-kusama-art-tokyo.html",
        title: "Opinion | Yayoi Kusama’s Fame Eclipsed Her Art",
        content: "In 1988, when I met her, Yayoi Kusama had been living in a psychiatric hospital in Tokyo for over a decade, and was nearly forgotten by the art world in New York. As a graduate student researching postwar Japanese art, I had been invited to curate the opening exhibition at a new institution in New York, the Center for International Contemporary Arts (CICA). I chose Ms. Kusama, with the ambition to wrest her from obscurity. [...] Supported by\n\nGuest Essay\n\n# She Changed the World From an Asylum in Tokyo\n\nBy Alexandra Munroe\n\nMs. Munroe is a writer and senior curator at the Guggenheim Museum and organized Yayoi Kusama’s first retrospective exhibition. [...] There has been an outpouring of tributes to her after her death, at 97, in Tokyo. Everyone notes how she had a role in the Minimalism and Pop Art movements of the 1960s avant-garde when she lived in New York City before moving back to Tokyo in 1973. And they mention her late-in-life career revival, with record-smashing auction prices as a female artist, the crowds lined up at her mirrored immersive installations and the signature range of polka-dot luxury goods she designed — twice — for Louis",
        score: 0.5758033, publishedDate: "Sun, 06 Sep 2026 10:00:23 GMT", images: [],
      },
      {
        url: "https://www.nytimes.com/section/arts/design?page=4",
        title: "Art and Design - Page 4",
        content: "The monarch was invited to see the historic embroidery days before a major British Museum exhibition, almost 40 years after seeing it in France with Diana.\n\nBy\n\nThe Genius of Yayoi Kusama in Three Works\n\nMarking the artist’s death, and ahead of a retrospective at Amsterdam’s Stedelijk Museum, a critic chooses epic works that highlight Kusama’s creative range and impact.\n\nBy\n\nArt Gallery Shows to See in September [...] After several delays, George Lucas’s legacy project is finally ready to open. There’s less “Star Wars” than you might expect.\n\nBy Matt StevensRobin Pogrebin and\n\nAmbassador Who Removed Kehinde Wiley Work Described It as a Lesbian Picnic\n\nTrump officials recently removed a painting from the U.S. Embassy in the Dominican Republic without explaining why. An interview by Ambassador Leah Campos shed some light.\n\nBy\n\nThe Mysterious and Lonely Final Decade of Yayoi Kusama’s Life [...] Advertisement\n\nElaborate coffins, produced by Ghanaian artisans, are the centerpieces of funerals that celebrate the life of the deceased and get them to the afterlife in style.\n\nBy Patricia Leigh Brown\n\nIn her mass-produced ubiquity, Kusama became one of her own dots, spreading her image into every corner of our culture.\n\nBy Blake Gopnik",
        score: 0.5608546, publishedDate: "Sat, 22 Aug 2026 10:00:00 GMT", images: [],
      },
      {
        url: "https://www.nytimes.com/video/obituaries/100000003009467/the-last-word-gloria-steinem-obituary.html",
        title: "In Her Words: Gloria Steinem - The New York Times",
        content: "# In Her Words: Gloria Steinem\n\n## Watch Today’s Videos\n\n## More in Obituaries ›\n\nThe Philanthropic Life of Dolly Parton\n\n### The Philanthropic Life of Dolly Parton\n\nThe Japanese Artist Yayoi Kusama Dies at 97\n\n### The Japanese Artist Yayoi Kusama Dies at 97\n\nThe British Actor Tim Curry Dies at 80\n\n### The British Actor Tim Curry Dies at 80\n\nHayden Panettiere, Known for ‘Nashville’ and ‘Heroes,’ Dies at 36\n\n### Hayden Panettiere, Known for ‘Nashville’ and ‘Heroes,’ Dies at 36",
        score: 0.12814304, publishedDate: "Thu, 03 Sep 2026 10:07:10 GMT", images: [],
      },
    ],
  },
};

export const monetLondon: RightNowFixture = {
  artist: "Claude Monet", region: "london",
  note: "refused: the first sentence concerns a page that scores below the cutoff, not the top result",
  response: {
    answer: "The National Gallery in London will feature Monet's \"The Beach at Trouville\" as the Picture of the Month for September 2026. Additionally, Monet's \"Bathers at La Grenouillère\" will be part of the Renoir and Love exhibition, displayed alongside Pierre-Auguste Renoir's \"La Grenouillère,\" marking the first time in 19 years that these works are shown together. The gallery also includes Monet's \"The Water-Lily Pond\" among its permanent collection.",
    images: [], credits: 1, requestId: "2af38322-ba94-48de-aee7-9f7438d796e8",
    results: [
      {
        url: "https://www.nationalgallery.org.uk/about-us/press-and-media/press-releases-archive/exclusive-preview-of-the-national-gallery-s-autumn-blockbuster-exhibition-renoir-and-love",
        title: "Exclusive preview of the National Gallery’s autumn blockbuster exhibition Renoir and Love | Press releases archive | National Gallery, London",
        content: "For a limited period, Claude Monet's Bathers at La Grenouillère and Pierre-Auguste Renoir's 'La Grenouillère' (both 1869) will be displayed together at the Gallery for the first time in 19 years. Painted side by side from a very similar viewpoint, the works capture a defining moment in the birth of Impressionism, offering a first glimpse into the artistic friendships, emotional storytelling and spirit of experimentation that will be explored throughout 'Renoir and Love'. [...] 2/2\n\nPierre-Auguste Renoir, 'La Grenouillère', 1869 © Nationalmuseum, Stockholm. Gift 1924 unknown donor through Nationalmusei Vänner.\n\nClaude Monet, 'Bathers at La Grenouillère', 1869\n\nClaude Monet, 'Bathers at La Grenouillère', 1869\n\n2/2\n\n2/2\n\n1\n\nPierre-Auguste Renoir, 'La Grenouillère', 1869 © Nationalmuseum, Stockholm. Gift 1924 unknown donor through Nationalmusei Vänner.\n\nClaude Monet, 'Bathers at La Grenouillère', 1869\n\n## Notes to editors\n\n#### Image credits [...] #### Image credits\n\nClaude Monet, 'Bathers at La Grenouillère', 1869 © The National Gallery, London. Bequeathed by Mrs M.S. Walzer as part of the Richard and Sophie Walzer Bequest, 1979.\n\nPierre-Auguste Renoir, 'La Grenouillère', 1869 © On loan from Nationalmuseum, Stockholm. Gift 1924 unknown donor through Nationalmusei Vänner.\n\n#### The National Gallery",
        score: 0.61196244, publishedDate: "Mon, 10 Aug 2026 18:00:00 GMT", images: [],
      },
      {
        url: "https://www.nationalgallery.org.uk/about-us/press-and-media/press-releases-archive/for-the-first-time-a-new-online-tour-shows-all-the-picture-displays-in-the-national-gallery",
        title: "For the first time a new online tour shows all the picture displays in the National Gallery | Press releases archive | National Gallery, London",
        content: "Room 34 A Distinct Style: British Painting 1740–1800  \n\nRoom 46 Claude Monet (1840–1926)  \n\nCentral Hall Image and Identity: Full-Length Portraits 1550–1900  \n\nRoom 52 Creating Illusion: Netherlandish Painting 1420–1480 [...] in a Straw Hat, Edouard Manet's portrait of the artist Eva Gonzalès, Sir Thomas Lawrence’s The Red Boy and Claude Monet's The Water-Lily Pond. [...] The National Gallery is one of the greatest art galleries in the world. Founded by Parliament in 1824, the Gallery houses the nation’s collection of paintings in the Western European tradition from the late 13th to the early 20th century. The collection includes works by Artemisia Gentileschi, Bellini, Cezanne, Degas, Leonardo, Monet, Raphael, Rembrandt, Renoir, Rubens, Titian, Turner, Van Dyck, Van Gogh and Velázquez. The Gallery’s key objectives are to care for and enhance the collection and",
        score: 0.37751824, publishedDate: "Tue, 18 Aug 2026 00:00:00 GMT", images: [],
      },
      {
        url: "https://www.nationalgallery.org.uk/paintings/picture-of-the-month/picture-of-the-month-september-2026",
        title: "Picture of the month: September 2026 | Picture of the month | National Gallery, London",
        content: "## More like this\n\nClaude Monet’s ‘The Beach at Trouville’\n\n### Claude Monet’s ‘The Beach at Trouville’\n\n#### Picture of the month August 2026\n\nEscape to the Normandy coast with Lily Le Brun as she reflects on this seaside scene by Claude Monet.\n\nArticle\n\nClaude Monet’s ‘The Beach at Trouville’: Read more\n\nPintoricchio’s ‘Penelope with the Suitors’\n\n### Pintoricchio’s ‘Penelope with the Suitors’\n\n#### Picture of the month July 2026 [...] Article\n\nCaravaggio’s ‘Boy bitten by a Lizard’: Read more\n\nSavoldo's 'Mary Magdalene'\n\n### Savoldo's 'Mary Magdalene'\n\n#### Picture of the month April 2025\n\nLook beyond the dazzling silver shawl to discover the identity of this enigmatic woman\n\nVideo\n\nSavoldo's 'Mary Magdalene': Read more\n\nMonet's 'Bathers at La Grenouillère'\n\n### Monet's 'Bathers at La Grenouillère'\n\n#### Picture of the month February 2025 [...] What do schoolchildren think of Monet’s ‘Bathers at La Grenouillère’, and what do they want to know?\n\nVideo\n\nMonet's 'Bathers at La Grenouillère': Read more\n\nPieter Bruegel the Elder's 'The Adoration of the Kings'\n\n### Pieter Bruegel the Elder's 'The Adoration of the Kings'\n\n#### Picture of the month January 2025\n\nDelve into this sacred moment, filled with curious characters\n\nArticle\n\nPieter Bruegel the Elder's 'The Adoration of the Kings': Read more",
        score: 0.37127393, publishedDate: "Tue, 01 Sep 2026 01:00:00 GMT", images: [],
      },
    ],
  },
};

export const crosbyNy: RightNowFixture = {
  artist: "Njideka Akunyili Crosby", region: "new-york",
  note: "accepted: Met exhibition page names the work",
  response: {
    answer: "Njideka Akunyili Crosby's artwork \"Mother and Child\" is featured in \"The Face of Life: Modern Portraits at The Met\" exhibition at The Metropolitan Museum of Art. The piece, created in 2016, is an acrylic, transfer printing, colored pencil, cut and pasted paper, and printed fabric on paper work that measures 95 3/4 in. × 10 ft. 4 1/4 in. The work is a poignant meditation on memory, motherhood, and loss, with the wallpaper made from fabric commemorating her mother, Dora Akunyili, a Nigerian health official and social advocate who died in 2014.",
    images: [], credits: 1, requestId: "0e2c3fd4-85fe-4199-9703-e20e2417decf",
    results: [
      {
        url: "https://www.metmuseum.org/ru/exhibitions/the-face-of-life-modern-portraits-at-the-met%2Fa-contemporary-presence",
        title: "The Face of Life: Modern Portraits at The Met - The Metropolitan Museum of Art",
        content: "Njideka Akunyili Crosby (Nigerian, 1983). Mother and Child, 2016. Acrylic, transfer printing, colored pencil, cut and pasted paper, and printed fabric on paper, 95 3/4 in. × 10 ft. 4 1/4 in. (243.2 × 315.6 cm). The Metropolitan Museum of Art, New York, Purchase, The Jacques and Natasha Gelman Foundation Gift, 2017 (2017.106). © Njideka Akunyili Crosby [...] his wife’s solitary presence. Crosby’s scene similarly carries traces of absent others. The wallpaper behind the double portrait is made from fabric commemorating her mother, Dora Akunyili, a Nigerian health official and social advocate who died in 2014. Created while the artist was pregnant, the work is a poignant meditation on memory, motherhood, and loss. [...] Akunyili Crosby sits in her Los Angeles living room, a space imbued with elements of personal history, facing a large black‑and‑white image of her maternal grandmother and youngest aunt. The terrazzo floor recalls her childhood home in Lagos and is formed from transfers of family photographs. The composition references Vilhelm Hammershøi, whose painting she re-created on the far wall. In his atmospheric domestic interiors, open doors reveal quiet rooms, often haunted by his wife’s solitary",
        score: 0.6609831, publishedDate: "Sun, 06 Sep 2026 11:00:00 GMT", images: [],
      },
      {
        url: "https://www.metmuseum.org/fr/art/collection/search/390940",
        title: "European Porcelain Designs in Japanese Satsuma style",
        content: "European Porcelain Designs in Japanese Satsuma style n.d. Drawings, Ornament & Architecture Gift of Charles Carruth, 1946 46.119.12.",
        score: 0.019361824, publishedDate: "Sun, 06 Sep 2026 11:00:00 GMT", images: [],
      },
    ],
  },
};

export const deOthelloNy: RightNowFixture = {
  artist: "Woody De Othello", region: "new-york",
  note: "accepted: Met exhibition page names the work",
  response: {
    answer: "Woody De Othello's work, \"Tools,\" is featured in \"The Face of Life: Modern Portraits at The Met\" exhibition at The Metropolitan Museum of Art in New York. The sculpture, made of bronze, glazed ceramic, and wood, stands at 61 × 32 1/2 × 48 inches and was acquired in 2023. De Othello's art often incorporates elements from African cultural traditions, infusing his sculptures with spiritual significance and a cartoonish, exaggerated style.",
    images: [], credits: 1, requestId: "7524f69c-e40d-412c-976b-c4cab0fcb36c",
    results: [
      {
        url: "https://www.metmuseum.org/ru/exhibitions/the-face-of-life-modern-portraits-at-the-met%2Fa-contemporary-presence",
        title: "The Face of Life: Modern Portraits at The Met",
        content: "A sculpted blue figure sits cross-legged atop a green, wavy wooden shelf. Below, various abstract objects rest on the shelves\n\nWoody De Othello (American, 1991). Tools, 2022. Bronze, glazed ceramic and wood, 61 × 32 1/2 × 48 in. (154.9 × 82.6 × 121.9 cm). The Metropolitan Museum of Art, New York, Purchase, Camilo Miguel Jr., Mike Mauzé, Jeff Yabuki and Alvaro Leal Gifts, 2023 (2023.394a–j). © Woody De Othello [...] De Othello creates intriguing, and often humorous, loosely figurative sculptures that represent both the everyday and the metaphysical. An abstracted, headless figure made of clay sits atop an irregularly shaped ladder. On the six rungs are depictions of common items, rendered larger than life with the same cartoonish sensibility as the ladder. By exaggerating each component’s form and expressive quality, the artist expands the emotional and psychological impact of the work. De Othello is also [...] De Othello is also inspired by the cultural traditions of western Africa and the African diaspora, including those of the Yoruba, Bantu, and Kongo peoples. He has embraced certain aspects of their practices, particularly by endowing the objects and sculptures he makes with spiritual power and significance.",
        score: 0.6219319, publishedDate: "Sun, 06 Sep 2026 11:00:00 GMT", images: [],
      },
      {
        url: "https://www.nytimes.com/topic/ewan-mcgregor?page=7",
        title: "Ewan McGregor - Page 7 - The New York Times",
        content: "In London, new productions of “Othello” and “Much Ado About Nothing” reveal a common theme: love’s susceptibility to deception.\n\n    By Charles Isherwood\n69. Movie Review | 'Cassandra’s Dream'\n\n    ### In Over Their Heads, With Destiny Looming\n\n    “Cassandra’s Dream,” Woody Allen’s latest excursion to the dark side of human nature, is good enough that you may wonder why he doesn’t just stop making comedies once and for all.\n\n    By Manohla Dargis\n70. FILM IN REVIEW [...] Celebrities have found that taking a stand either way on Scotland's independence referendum can stir anger in about half of its population.\n\n    By Katrin Bennhold\n30. ArtsBeat\n\n    ### Ewan McGregor to Make Broadway Debut in ‘Real Thing’\n\n    He will star in the Roundabout Theater Company revival of Tom Stoppard’s play in October 2014.\n\n    By Allan Kozinn\n31. ### What’s on Tuesday\n\n    A listing of shows to watch on Tuesday.\n\n    By Kathryn Shattuck\n32. ArtsBeat [...] ### Long Career but Still Learning\n\n    After a six-decade stage and film career, Christopher Plummer still has plenty of acting work. “I want to be able to play as many things as possible,” he says, “before I croak.”\n\n    By Melena Ryzik\n59. ArtsBeat\n\n    ### Susan Stroman Signs On to Direct Stage Musical of Tim Burton’s ‘Big Fish’\n\n    The show is aiming to open on Broadway next spring.\n\n    By Patrick Healy\n60. Movie Review | 'Beginners'\n\n    ### Remembering When Dad Came Out",
        score: 0.0764423, publishedDate: "Sun, 30 Aug 2026 01:00:00 GMT", images: [],
      },
    ],
  },
};

export const hockneyNy: RightNowFixture = {
  artist: "David Hockney", region: "new-york",
  note: "refused: explicit abstention with unrelated results",
  response: {
    answer: "Based on the provided data, there is no direct information about a David Hockney exhibition or news related to it. The sources given focus on a different topic, \"Electric Kool-Aid Acid Blue\" and a guide on what to watch on streaming services. For the most up-to-date and relevant information on a David Hockney exhibition, I recommend checking official art institution websites or reputable news outlets closer to the event date.",
    images: [], credits: 1, requestId: "2488a0f3-ca7e-4a6e-b3b6-6bdbd4ff916b",
    results: [
      {
        url: "https://www.nytimes.com/2026/08/15/style/electric-kool-aid-acid-blue-aqua.html",
        title: "Is Electric Kool-Aid Acid Blue for You?",
        content: "It's nostalgic, optimistic and, some argue, easier to pull off than you may think.",
        score: 0.021518527, publishedDate: "Tue, 18 Aug 2026 11:00:00 GMT", images: [],
      },
      {
        url: "https://www.nytimes.com/spotlight/what-to-watch?page=7",
        title: "What to Watch - Page 7",
        content: "Overwhelmed by Netflix, Hulu and other TV and movie streaming services? We are here to help!",
        score: 0.01879171, publishedDate: "Sat, 05 Sep 2026 11:00:00 GMT", images: [],
      },
    ],
  },
};

export const hockneySf: RightNowFixture = {
  artist: "David Hockney", region: "sf-bay-area",
  note: "refused: June obituary retold from a recently dated category page",
  response: {
    answer: "David Hockney, a treasured British artist known for his shimmering pool paintings and colorful iPad drawings, passed away on June 11, 2026, at the age of 88. His contributions to contemporary art have left a lasting legacy.",
    images: [], credits: 1, requestId: "cf8726cd-5abb-46f7-8fe8-dcfc9f7ce08e",
    results: [
      {
        url: "https://www.kqed.org/arts/category/visualarts?page=117",
        title: "Visual Arts",
        content: "Artist David Hockney Says the Drive to Create Pictures 'Is Deep Within Us'. Oct 13, 2016. Bay Area Sculpture Right Now: Alyssa Lempesis Wants to Gross You",
        score: 0.38373423, publishedDate: "Tue, 18 Aug 2026 11:00:00 GMT", images: [],
      },
      {
        url: "https://www.sfchronicle.com/sports/article/the-year-in-review-influential-people-who-have-22418109.php",
        title: "The year in review: Influential people who have died in 2026",
        content: "David Hockney, 88. He was a treasured British artist whose paintings of shimmering pools and colorful iPad drawings became icons of contemporary art. June 11.\n\nRonnie Schell, 94. He played the best friend to the title character on the 1960s sitcom “Gomer Pyle, U.S.M.C.” and his gradual ascendancy in show business earned him the title of “America’s Slowest Rising Comedian.” June 12. [...] Subscribe\n\nSports\n\n# The year in review: Influential people who have died in 2026\n\nBy BERNARD McGHEE, Associated Press\n\nFILE - Dolly Parton performs on NBC's \"Today\" show in New York on May 13, 2014. (Photo by Charles Sykes/Invision/AP, File)\n\nCharles Sykes/AP Photo/Charles Sykes\n\nFILE - Hayden Panettiere arrives at the 61st Primetime Emmy Awards on Sept. 20, 2009, in Los Angeles.\n\nMatt Sayles/AP Photo/Matt Sayles [...] Ned Jarrett, 93. He was a two-time NASCAR Cup Series champion and longtime broadcaster. June 4.\n\nMarjane Satrapi, 56. The acclaimed Iranian-French cartoonist and filmmaker was a prominent advocate for women’s rights and author of “Persepolis,” a coming-of-age tale set against the Islamic Revolution in her native Iran. June 4.",
        score: 0.16893952, publishedDate: "Fri, 04 Sep 2026 18:31:21 GMT", images: [],
      },
      {
        url: "https://www.kqed.org/arts/category/visualarts?page=89",
        title: "Visual Arts",
        content: "Power of Sports Enacted and on Display in 'Game Recognize Game'. Dec 7, 2017. A Fire Relief Fundraiser in Comic Strips. Dec 6, 2017",
        score: 0.117420465, publishedDate: "Tue, 25 Aug 2026 11:00:00 GMT", images: [],
      },
      {
        url: "https://www.kqed.org/arts/tag/featured?page=190",
        title: "featured Archives | KQED Arts - Page 190",
        content: "Cy and David's Picks: The Early Days of the AIDS Crisis, Women Singing the Blues, and Love in a Time of Madness. Mar 23, 2017",
        score: 0.059128825, publishedDate: "Tue, 11 Aug 2026 11:00:00 GMT", images: [],
      },
      {
        url: "https://www.kqed.org/arts/category/visualarts?page=104",
        title: "Visual Arts",
        content: "Kerry James Marshall: A Black Presence in the Art World is 'Not Negotiable'. Mar 29, 2017. Meet the Oakland 14-Year-Old Cartooning the Resistance.",
        score: 0.046886258, publishedDate: "Tue, 25 Aug 2026 11:00:00 GMT", images: [],
      },
    ],
  },
};

export const banksyNy: RightNowFixture = {
  artist: "Banksy", region: "new-york",
  note: "refused: old street-art tour under a recent archive date",
  response: {
    answer: "Banksy's month-long open-air street art tour in the city has been a topic of interest, with Stephen Colbert attempting to lure the artist to his studio. Meanwhile, NY-based street artist Hanksy paid tribute to Colbert by placing a \"Col-Bear\" on the wall at W 54th Street between 10th and 11th Avenues. Additionally, there are numerous acts of artistic resistance happening nationwide, including guerrilla installations at the Whitney Museum and satirical video games lampooning political chaos.",
    images: [], credits: 1, requestId: "c7c20914-6d3b-4cb3-bd4f-b8a5a0338713",
    results: [
      {
        url: "https://gothamist.com/arts-entertainment/photo-hanksy-pays-tribute-to-stephen-colbert-with-a-col-bear",
        title: "Photo: Hanksy Pays Tribute To Stephen Colbert With A Col-Bear - Gothamist",
        content: "Earlier this week, Stephen Colbert addressed Banksy's month-long open air street art tour of the city by attempting to lure the reclusive street artist to come vandalize the walls of his studio (see the video below). And while Banksy has yet to draw Colbert riding a shark, NY-based street artist Hanksy did show up to place the above \"Col-Bear\" on the wall at W 54th Street between 10th and 11th Avenues. \"It went up last night,\" Hanksy told us. \"Kinda sorta probably in response to Colbert's [...] to Colbert's request for Banksy to come paint his wall Monday night.\" [...] A non-profit newsroom, powered by WNYC.\n\nDonate\n\nArts & Entertainment\n\n# Photo: Hanksy Pays Tribute To Stephen Colbert With A Col-Bear\n\n\n\nBy\n\nBen Yakas\n\nPublished Oct 10, 2013\n\nModified Oct 10, 2013\n\nShare\n\nNever miss a story\n\nBen Yakas/Gothamist\n\n\n\nBy\n\nBen Yakas\n\nPublished Oct 10, 2013\n\nModified Oct 10, 2013\n\nShare\n\nWe rely on your support to make local news available to all\n\nMake your contribution now and help Gothamist thrive in 2026.  Donate today",
        score: 0.20415178, publishedDate: "Wed, 02 Sep 2026 05:00:00 GMT", images: [],
      },
      {
        url: "https://hyperallergic.com/tag/protest-art",
        title: "Protest Art - Hyperallergic",
        content: "16 Acts of Artistic Resistance Happening This Weekend \n\nNews\n\n### 16 Acts of Artistic Resistance Happening This Weekend\n\nThe exhibitions, performances, readings, and more are just a sliver of the more than 500 events in the nationwide Fall of Freedom series.\n\nWhy the Right Can’t Stand the “No Kings” Aesthetic \n\nFeature\n\n### Why the Right Can’t Stand the “No Kings” Aesthetic [...] “Billionaires could fund cures for cancer — so why are they funding glasses for perverts instead?\" asked the protest group Everyone Hates Elon.\n\nWhitney Museum Screens Taken Over With Gaza Protest Messages \n\nNews\n\n### Whitney Museum Screens Taken Over With Gaza Protest Messages\n\nJonathan Allen’s guerrilla installations superimposed anti-genocide messages onto advertising displays outside the museum.\n\nSatirical Video Game Lampoons Trump's Iran War Chaos \n\nNews [...] Hyperallergic\n\nSign in Subscribe\n\n# Protest Art\n\nEx-Pussy Riot Member Says She Was Recruited by Russia to Spy on Artists \n\nNews\n\n### Ex-Pussy Riot Member Says She Was Recruited by Russia to Spy on Artists\n\nMargarita Konovalova, who performed in the collective under the alias Rita Flores, fled Russia earlier this month with the help of her lawyer.\n\nChinese Artist Gao Zhen Gets 3-Year Prison Sentence for Mao Sculptures \n\nNews",
        score: 0.081556484, publishedDate: "Thu, 27 Aug 2026 12:00:00 GMT", images: [],
      },
      {
        url: "https://gothamist.com/arts-entertainment/a-lost-archive-of-nyc-911-street-art-memorials-comes-back-online",
        title: "A lost archive of NYC 9/11 street art memorials comes back online",
        content: "After the Twin Towers fell, life-size human silhouettes made of tape appeared throughout New York City. You'd see them on roll-down gates,",
        score: 0.036456086, publishedDate: "Mon, 07 Sep 2026 15:00:00 GMT", images: [],
      },
      {
        url: "https://gothamist.com/arts-entertainment/some-untold-911-stories-are-the-strangest-ones-they-come-to-light-in-a-new-documentary",
        title: "Some untold 9/11 stories are the strangest ones. They come to light in a new documentary. - Gothamist",
        content: "MORE arts-entertainment\n\nThe feminist icon, who died at 92, was a longtime resident of the neighborhood.\n\nPublished Sep 3, 2026\n\nA shoebox in Chelsea, a luxe apartment in Riverdale and five (!) bedrooms on Staten Island.\n\nA shoebox in Chelsea, a luxe apartment in Riverdale and five (!) bedrooms on Staten Island.\n\nCatch up on the most important headlines with a roundup of essential NYC stories, delivered to your inbox daily. [...] Gothamist is a website about New York City news, arts, events and food, brought to you by New York Public Radio. [...] WNYC\n\n# Some untold 9/11 stories are the strangest ones. They come to light in a new documentary.\n\nPublished Sep 6, 2026 at 3:45 p.m. ET\n\nShare\n\nFlowers on the ledge of one of the pools of the 9/11 Memorial\n\nPublished Sep 6, 2026 at 3:45 p.m. ET\n\nShare\n\nMake your contribution now and help Gothamist thrive in 2026.  Donate today\n\nGothamist is funded by sponsors and member donations",
        score: 0.033911232, publishedDate: "Mon, 07 Sep 2026 11:00:00 GMT", images: [],
      },
    ],
  },
};

export const emptyFilter: RightNowFixture = {
  artist: "Artlog Qzxvra Nullex 7c9e2", region: "sf-bay-area",
  note: "refused: synthetic name returns an unrelated Kusama story",
  response: {
    answer: "The San Francisco Museum of Modern Art (SFMOMA) faced controversy surrounding Yayoi Kusama's 2023 exhibition, \"Yayoi Kusama: Infinite Love,\" due to racist language in her writings. The exhibition highlighted the challenges institutions face in presenting the work of acclaimed artists with problematic pasts. Kusama passed away in Tokyo on August 14, 2026, at the age of 97.",
    images: [], credits: 1, requestId: "7ef45fd9-5270-41ea-90ce-311278617cae",
    results: [
      {
        url: "https://www.sfchronicle.com/sports/article/another-player-involved-in-college-eligibility-22410312.php",
        title: "Another player involved in college eligibility suit gets cut by an NFL team - San Francisco Chronicle",
        content: "Defensive lineman Jack Pyburn was waived by the Tampa Bay Buccaneers on Sunday and could be the latest player who tries to go back to college after spending time in an NFL camp. He'll become a free agent if he's not picked up and is among the players granted a temporary restraining order by a Louisiana court earlier this month that would make them eligible to return to college athletics. Four other players who spent time on NFL rosters this offseason before being cut were also part of the case: former LSU running back TJ Harden, former Mississippi tight end Dae'Quan Wright, former Ole Miss defensive lineman Zxavian Harris and former Oregon State running back Anthony Hankerson. Here's a look at some of the players who spent time in NFL camps this summer and now might return to college:. Pyburn originally signed as an undrafted free agent with Tampa Bay in May. He played in two exhibition games and led the NFL with four sacks in the preseason.",
        score: 0.03649728, publishedDate: "Mon, 31 Aug 2026 01:53:02 GMT", images: [],
      },
      {
        url: "https://www.sfchronicle.com/entertainment/article/metropolitan-museum-of-art-cancels-planned-met-22410659.php",
        title: "Metropolitan Museum of Art cancels planned Met Gala exhibit on fashion designer John Galliano - San Francisco Chronicle",
        content: "# Metropolitan Museum of Art cancels planned Met Gala exhibit on fashion designer John Galliano. NEW YORK (AP) — The Metropolitan Museum of Art is canceling its planned exhibit honoring British designer John Galliano, which had led to severe backlash in the Jewish community and beyond because of the designer’s past antisemitic and racist statements. “Following thoughtful discussions with John Galliano, we have together decided not to proceed with the exhibition,\" Max Hollein, director and CEO of the museum, announced in a statement. The designer joined in the statement, saying: “After much reflection and discussion with The Met and all those involved, I have decided, with great sadness, that it is best for the exhibition not to take place at this time. He was to become only the third living designer to be the subject of a solo show at the Met's Costume Institute.",
        score: 0.02792528, publishedDate: "Mon, 31 Aug 2026 13:51:37 GMT", images: [],
      },
      {
        url: "https://www.sfchronicle.com/entertainment/arts-exhibits/article/objects-usa-museum-craft-design-sf-22401184.php",
        title: "What counts as art? This S.F. exhibition offers more than 70 answers - San Francisco Chronicle",
        content: "His historic exhibition at the Smithsonian that year — “Objects: USA,” featuring more than 500 works by ceramicists, weavers, quilters, woodworkers and artists specializing in metal, glass, enamel, mosaic and more — helped shift that line of thinking. Almost six decades years later, the Museum of Craft and Design is revisiting the concept, with a new “Objects: USA” with more than 70 pieces that break down the silos of art, craft and design. Now he takes center stage in S.F. Some works, such as Wendell Castle’s “Tongue,” a shiny end table with an angled base resembling a children’s slide, come from the original “Objects: USA.” Others, like a lamp made by Jolie Ngo, as fuzzy and colorful and wacky as a Dr. Seuss illustration, hail from our era. A Michigan native whose childhood also took her to Tennessee and Texas, she holds a BA in theater studies from Yale and an MA in drama from San Francisco State.",
        score: 0.027735045, publishedDate: "Tue, 01 Sep 2026 13:00:00 GMT", images: [],
      },
      {
        url: "https://www.sfchronicle.com/entertainment/arts-exhibits/article/yayoi-kusama-death-sfmoma-controversy-22406208.php",
        title: "How Yayoi Kusama’s San Francisco triumph became an SFMOMA reckoning - San Francisco Chronicle",
        content: "For many Bay Area museumgoers, Yayoi Kusama’s first solo Northern California exhibition at the San Francisco Museum of Modern Art in 2023 became the backdrop for selfies and Instagram reels. Now, with news of Kusama’s death in Tokyo at 97 on Aug. 14, confirmed by the Yayoi Kusama Studio this week, the controversy that shadowed that SFMOMA show is inseparable from her local legacy. But the show also ignited questions over racist language in Kusama’s writings spanning several decades, placing the Japanese artist at the center of a predicament many arts institutions across the country were grappling with over how to present the work of acclaimed artists with problematic pasts. But for all her success, she could not tamp down the simmering controversy that came to a boil in San Francisco on the cusp of “Yayoi Kusama: Infinite Love” at SFMOMA in October 2023. Tony Bravo is the Chronicle’s arts and culture columnist.",
        score: 0.02315567, publishedDate: "Thu, 27 Aug 2026 20:28:25 GMT", images: [],
      },
      {
        url: "https://www.sfchronicle.com/entertainment/arts-exhibits/article/sf-yerba-buena-illuminated-22401524.php",
        title: "A 95-foot artwork is about to transform this historic San Francisco building - San Francisco Chronicle",
        content: "A 95-foot animated artwork is about to transform a historic Market Street building into one of downtown San Francisco’s largest canvases, launching a new public art partnership among three museums. The Yerba Buena Illuminated initiative will debut on Tuesday, Aug. 25, with Los Angeles artist Jennifer Steinkamp’s “It’s a nice day for a white wedding” at 785 Market St. The digital art work’s title is inspired by Billy Idol’s 1982 hit song “White Wedding” and will project a cascade of animated red, white and yellow wedding flowers on the Beaux-Arts–style Humboldt Bank Building. It comes from the collection of the San Francisco Museum of Modern Art, one of the three cultural institutions collaborating with Yerba Buena Partnership, a neighborhood community benefit district. “This installation will be a powerful symbol of the vibrancy and creativity that defines San Francisco and yet another reason for San Franciscans and visitors to enjoy the public spaces, cultural institutions, and all the Yerba Buena area has to offer.”.",
        score: 0.022271343, publishedDate: "Tue, 25 Aug 2026 17:00:00 GMT", images: [],
      },
    ],
  },
};

export const rupyTutSf: RightNowFixture = {
  artist: "Rupy C. Tut", region: "sf-bay-area",
  note: "refused: abstention over listing pages",
  response: {
    answer: "Rupy C. Tut's exhibition or news is not mentioned in the provided data sources. The most recent information available pertains to the Artists of SFMOMA's 2024 SECA Show and a guide for an arts-filled Martin Luther King Jr. Day on January 15, 2025. There is no mention of Rupy C. Tut or any related exhibition or news.",
    images: [], credits: 1, requestId: "8645e048-279f-41e5-b82a-a99044b97b2c",
    results: [
      {
        url: "https://www.kqed.org/arts/category/the-do-list?page=48",
        title: "The Do List",
        content: "The Artists of SFMOMA's 2024 SECA Show Stand the Test of Time. Jan 15, 2025. Your Guide to an Arts-Filled Martin Luther King Jr. Day. Jan 15, 2025.",
        score: 0.026257854, publishedDate: "Tue, 11 Aug 2026 11:00:00 GMT", images: [],
      },
      {
        url: "https://www.kqed.org/arts/tag/featured-arts?page=69",
        title: "featured-arts",
        content: "KQED provides public radio, television, and independent reporting on issues that matter to the Bay Area. We're the NPR and PBS member station for Northern",
        score: 0.01478686, publishedDate: "Tue, 25 Aug 2026 11:00:00 GMT", images: [],
      },
    ],
  },
};

export const rightNowFixtures = { kusamaSf, kusamaNy, monetLondon, crosbyNy, deOthelloNy, hockneyNy, hockneySf, banksyNy, emptyFilter, rupyTutSf };

// The raw API shape (published_date, usage) for stubbing fetch in action tests.
export function rawTavily(fixture: RightNowFixture): unknown {
  const { response } = fixture;
  return {
    answer: response.answer, request_id: response.requestId, usage: { credits: response.credits },
    results: response.results.map(({ publishedDate, ...rest }) => ({ ...rest, published_date: publishedDate })),
  };
}
