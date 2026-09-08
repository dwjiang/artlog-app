import json
from urllib.parse import urlencode, urljoin

from probe import ROOT, Probe, now, save


def run():
    probe = Probe()
    met = json.loads((ROOT / "results/met.json").read_text())
    aic = json.loads((ROOT / "results/aic.json").read_text())
    file_name = "Mona Lisa, by Leonardo da Vinci, from C2RMF retouched.jpg"
    params = {"action": "query", "format": "json", "titles": "File:" + file_name, "prop": "imageinfo", "iiprop": "url|extmetadata", "iiurlwidth": 330}
    record, commons = probe.json("https://commons.wikimedia.org/w/api.php?" + urlencode(params))
    output = {"started_at": now(), "commons_imageinfo": {"request": record, "response": commons}, "images": []}
    met_url = next(item["data"]["primaryImageSmall"] for item in met["sample"]["objects"] if item["data"] and item["data"].get("primaryImageSmall") and item["data"]["isPublicDomain"])
    aic_image = aic["samples"]["public_domain"]["data"]["image_id"]
    candidates = [("Met", met_url), ("AIC", f"https://www.artic.edu/iiif/2/{aic_image}/full/843,/0/default.jpg")]
    if commons:
        page = next(iter(commons["query"]["pages"].values()))
        if "imageinfo" in page:
            candidates.append(("Commons", page["imageinfo"][0]["thumburl"]))
    for name, url in candidates:
        item = {"name": name, "url": url, "requests": []}
        current = url
        for _ in range(5):
            record, _ = probe.request(current, method="HEAD")
            item["requests"].append(record)
            if record["status"] in (301, 302, 303, 307, 308) and "location" in record["headers"]:
                current = urljoin(current, record["headers"]["location"])
            else:
                break
        item["final_url"] = current
        output["images"].append(item)
    save("thumbnails", output)


if __name__ == "__main__":
    run()
