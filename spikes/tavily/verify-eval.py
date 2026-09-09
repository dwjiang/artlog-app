from common import Evaluation

TRIPLES = [
    ("The Starry Night", "Vincent van Gogh", "MoMA", "moma.org"),
    ("The Persistence of Memory", "Salvador Dalí", "MoMA", "moma.org"),
    ("Water Lilies", "Claude Monet", "Metropolitan Museum of Art", "metmuseum.org"),
    (
        "Washington Crossing the Delaware",
        "Emanuel Leutze",
        "Metropolitan Museum of Art",
        "metmuseum.org",
    ),
    ("Nighthawks", "Edward Hopper", "Art Institute of Chicago", "artic.edu"),
    ("A Sunday on La Grande Jatte", "Georges Seurat", "Art Institute of Chicago", "artic.edu"),
    ("The Fighting Temeraire", "J. M. W. Turner", "National Gallery", "nationalgallery.org.uk"),
    ("A Bigger Splash", "David Hockney", "Tate", "tate.org.uk"),
    ("The Thinker", "Auguste Rodin", "Cleveland Museum of Art", "clevelandart.org"),
    ("The Red Studio", "Henri Matisse", "MoMA", "moma.org"),
]


def main():
    evaluation = Evaluation()
    try:
        for index, (title, artist, museum, domain) in enumerate(TRIPLES, 1):
            params = {
                "query": f'"{title}" {artist}',
                "search_depth": "basic",
                "auto_parameters": False,
                "topic": "general",
                "include_domains": [domain],
                "include_domains_mode": "filter",
                "include_images": True,
                "max_results": 5,
                "include_usage": True,
                "timeout": 60,
            }
            evaluation.run(
                f"verify-{index:02}",
                "search",
                params,
                {"title": title, "artist": artist, "museum": museum, "domain": domain},
            )
    finally:
        evaluation.close()


if __name__ == "__main__":
    main()
