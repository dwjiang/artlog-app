import json

from common import BASE, Evaluation

ARTISTS = {
    "famous": ["Yayoi Kusama", "David Hockney", "Banksy", "Claude Monet"],
    "mid": ["Julie Mehretu", "Njideka Akunyili Crosby", "Salman Toor", "Firelei Báez"],
    "local": ["Rupy C. Tut", "Woody De Othello", "Melissa Joseph", "Hetain Patel"],
}
REGIONS = json.loads((BASE / "regions-proposed.json").read_text())


def main():
    evaluation = Evaluation()
    try:
        for cohort, artists in ARTISTS.items():
            for index, artist in enumerate(artists):
                modes = ["filter", "boost", "none"] if cohort == "famous" else ["filter"]
                for mode in modes:
                    regions = (
                        ["global"] if mode == "none" else ["sf-bay-area", "new-york", "london"]
                    )
                    for region in regions:
                        params = {
                            "query": f"{artist} exhibition OR news",
                            "search_depth": "basic",
                            "auto_parameters": False,
                            "topic": "news",
                            "time_range": "month",
                            "include_answer": "basic",
                            "max_results": 5,
                            "include_usage": True,
                            "timeout": 60,
                        }
                        if mode != "none":
                            params.update(
                                include_domains=REGIONS[region]["domains"],
                                include_domains_mode=mode,
                            )
                        evaluation.run(
                            f"right-now-{cohort}-{index + 1}-{region}-{mode}",
                            "search",
                            params,
                            {"artist": artist, "cohort": cohort, "region": region, "mode": mode},
                        )
        for mode in ["filter", "none"]:
            params = {
                "query": '"Artlog Qzxvra Nullex 7c9e2" exhibition OR news',
                "search_depth": "basic",
                "auto_parameters": False,
                "topic": "news",
                "time_range": "month",
                "include_answer": "basic",
                "max_results": 5,
                "include_usage": True,
                "timeout": 60,
            }
            if mode == "filter":
                params.update(
                    include_domains=REGIONS["sf-bay-area"]["domains"], include_domains_mode="filter"
                )
            evaluation.run(
                f"empty-{mode}",
                "search",
                params,
                {
                    "artist": "Artlog Qzxvra Nullex 7c9e2",
                    "cohort": "synthetic-negative",
                    "mode": mode,
                },
            )
    finally:
        evaluation.close()


if __name__ == "__main__":
    main()
