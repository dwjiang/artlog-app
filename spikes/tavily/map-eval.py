from common import Evaluation


def main():
    evaluation = Evaluation()
    try:
        for name, endpoint, overrides in [
            (
                "map-collections",
                "map",
                {"select_paths": ["/art/collection/.*"], "max_depth": 1, "limit": 50},
            ),
            (
                "map-objects",
                "map",
                {"select_paths": [r"^/art/[0-9]{4}\.[^/]+$"], "max_depth": 2, "limit": 2000},
            ),
            (
                "crawl-objects",
                "crawl",
                {
                    "select_paths": [r"^/art/[0-9]{4}\.[^/]+$"],
                    "max_depth": 1,
                    "limit": 20,
                    "extract_depth": "basic",
                },
            ),
            (
                "map-collection-start",
                "map",
                {
                    "url": "https://www.clevelandart.org/art/collection/search",
                    "select_paths": [r"^/art/[0-9]{4}\.[^/]+$"],
                    "max_depth": 2,
                    "limit": 2000,
                },
            ),
            (
                "map-object-start",
                "map",
                {
                    "url": "https://www.clevelandart.org/art/1927.393",
                    "select_paths": [r"^/art/[0-9]{4}\.[^/]+$"],
                    "max_depth": 1,
                    "limit": 20,
                },
            ),
            (
                "crawl-object-start",
                "crawl",
                {
                    "url": "https://www.clevelandart.org/art/1927.393",
                    "select_paths": [r"^/art/[0-9]{4}\.[^/]+$"],
                    "max_depth": 1,
                    "limit": 20,
                    "extract_depth": "basic",
                },
            ),
            (
                "map-any-path-control",
                "map",
                {"select_paths": [".*"], "max_depth": 1, "limit": 20},
            ),
        ]:
            params = {
                "url": "https://www.clevelandart.org/",
                "max_breadth": 100,
                "allow_external": False,
                "include_usage": True,
                "timeout": 150,
            }
            params.update(overrides)
            record = evaluation.run(
                name,
                endpoint,
                params,
                {
                    "museum": "Cleveland Museum of Art",
                    "reason": "Native object paths replace the eMuseum example",
                },
            )
            if record["metrics"]["external_urls"] or record["metrics"]["unexpected_paths"]:
                raise RuntimeError(
                    "STOP: returned URLs violate host or path filter; record evidence before further mapping"
                )
    finally:
        evaluation.close()


if __name__ == "__main__":
    main()
