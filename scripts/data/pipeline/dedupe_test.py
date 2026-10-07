import json

import numpy as np
import pytest

from pipeline.dedupe import find_merges, run
from pipeline.features import file_hash, read_jsonl, write_jsonl
from pipeline.model_version import EMBEDDING_DIM
from pipeline.sources.fetch import write_json


def obj(key, owner="museum:1", accession=None, artist="Claude Monet"):
    return {"key": key, "ownerKey": owner, "accession": accession, "artist": artist}


def test_accession_merge_is_normalized_and_prefers_museum_source():
    objects = [obj("wikidata:Q1", accession=" ＡＢ-12 / 3 "), obj("met:1", accession="ab-12 / 3")]
    mapping, audit = find_merges(objects, {}, {})
    assert mapping == {"wikidata:Q1": "met:1", "met:1": "met:1"}
    assert audit == [{"from": "wikidata:Q1", "into": "met:1", "rule": "accession"}]


def test_embeddings_require_known_matching_artist_and_owner():
    objects = [
        obj("met:1"),
        obj("wikidata:Q1", artist=" Claude  MONET "),
        obj("wikidata:Q2", artist="Manet"),
        obj("wikidata:Q3", owner="museum:2"),
        obj("wikidata:Q4", owner=None),
        obj("wikidata:Q5", owner=None),
        obj("wikidata:Q6", artist="Unknown artist"),
        obj("wikidata:Q7", artist="Unknown artist"),
    ]
    vectors = {o["key"]: np.array([1.0, 0.0]) for o in objects}
    artists = {o["key"]: o["artist"] for o in objects}
    mapping, audit = find_merges(objects, vectors, artists, block_size=2)
    assert mapping["wikidata:Q1"] == "met:1"
    assert all(mapping[o["key"]] == o["key"] for o in objects[2:])
    assert audit == [{"from": "wikidata:Q1", "into": "met:1", "rule": "embedding"}]


@pytest.mark.parametrize("cosine,merges", [(0.9364213943481445, True), (0.90, False)])
def test_projected_photo_pair_merges_without_admitting_weaker_visual_matches(cosine, merges):
    # The Manet pair's measured pca512 cosine was 0.93642 (0.97564 before projection).
    objects = [obj("met:436954", accession="55.193"), obj("wikidata:Q19905443")]
    reference = np.zeros(EMBEDDING_DIM, dtype=np.float32)
    reference[0] = 1
    photo = np.zeros(EMBEDDING_DIM, dtype=np.float32)
    photo[:2] = [cosine, np.sqrt(1 - cosine**2)]
    vectors = {"met:436954": reference, "wikidata:Q19905443": photo}

    mapping, audit = find_merges(objects, vectors, dict.fromkeys(vectors, "Édouard Manet"))

    assert mapping["met:436954"] == "met:436954"
    assert mapping["wikidata:Q19905443"] == ("met:436954" if merges else "wikidata:Q19905443")
    assert audit == (
        [{"from": "wikidata:Q19905443", "into": "met:436954", "rule": "embedding"}]
        if merges
        else []
    )


def test_empty_accessions_and_unowned_records_do_not_merge():
    objects = [
        obj("met:1", accession="---"),
        obj("met:2", accession="  "),
        obj("met:3", owner=None, accession="1"),
        obj("met:4", owner=None, accession="1"),
    ]
    mapping, audit = find_merges(objects, {}, {})
    assert all(mapping[o["key"]] == o["key"] for o in objects)
    assert audit == []


def test_transitive_merges_point_to_final_survivor_and_are_deterministic():
    objects = [obj("wikidata:Q1", accession="a"), obj("met:1", accession="a"), obj("aic:1")]
    vectors = {o["key"]: np.array([1.0, 0.0]) for o in objects}
    artists = {o["key"]: o["artist"] for o in objects}
    result = find_merges(objects, vectors, artists)
    assert result == find_merges(list(reversed(objects)), vectors, artists)
    assert set(result[0].values()) == {"aic:1"}
    assert all(r["into"] == "aic:1" for r in result[1])


@pytest.mark.parametrize("museum_record", [False, True])
def test_shared_accession_does_not_collapse_distinct_source_records(museum_record):
    objects = [
        obj("wikidata:Q106750764", accession="GE-0351-2"),
        obj("wikidata:Q106750772", accession="ge-0351-2"),
    ]
    if museum_record:
        objects.append(obj("met:1", accession="GE-0351-2"))

    mapping, audit = find_merges(objects, {}, {})

    assert mapping == {row["key"]: row["key"] for row in objects}
    assert audit == []


def test_visual_evidence_can_resolve_one_view_of_an_ambiguous_accession():
    objects = [
        obj("met:1", accession="album"),
        obj("wikidata:Q1", accession="album"),
        obj("wikidata:Q2", accession="album"),
    ]
    vectors = {
        "met:1": np.array([1.0, 0.0]),
        "wikidata:Q1": np.array([1.0, 0.0]),
        "wikidata:Q2": np.array([0.0, 1.0]),
    }

    mapping, audit = find_merges(objects, vectors, dict.fromkeys(vectors, "Jan Baegert"))

    assert mapping == {"met:1": "met:1", "wikidata:Q1": "met:1", "wikidata:Q2": "wikidata:Q2"}
    assert audit == [{"from": "wikidata:Q1", "into": "met:1", "rule": "embedding"}]


@pytest.mark.parametrize("left,right", [("1982.73", "1982.7.3"), ("AB 12", "AB12")])
def test_distinct_accession_components_do_not_merge(left, right):
    objects = [obj("met:1", accession=left), obj("wikidata:Q1", accession=right)]
    mapping, audit = find_merges(objects, {}, {})
    assert mapping == {o["key"]: o["key"] for o in objects}
    assert audit == []


@pytest.mark.parametrize("via_aliases", [False, True])
def test_embeddings_cannot_join_conflicting_accessions_even_through_aliases(via_aliases):
    objects = [obj("met:1", accession="1936.126"), obj("wikidata:Q1", accession="1936.127")]
    keys = [o["key"] for o in objects]
    if via_aliases:
        objects += [obj("aic:1", accession="1936.126"), obj("aic:2", accession="1936.127")]
    mapping, audit = find_merges(
        objects, {key: np.array([1.0, 0.0]) for key in keys}, dict.fromkeys(keys, "Claude Monet")
    )
    assert mapping[keys[0]] != mapping[keys[1]]
    assert all(row["rule"] == "accession" for row in audit)


def test_embedding_alias_cannot_bridge_two_records_from_the_same_source():
    objects = [obj("met:1"), obj("met:2"), obj("wikidata:Q1")]
    mapping, audit = find_merges(
        objects,
        {o["key"]: np.array([1.0, 0.0]) for o in objects},
        {o["key"]: "Claude Monet" for o in objects},
    )
    assert mapping["met:1"] != mapping["met:2"]
    assert len(audit) == 1


@pytest.mark.parametrize(
    "name",
    [
        "Unidentified artist",
        " UNIDENTIFIED  ARTIST ",
        "Unknown",
        "Anonymous",
        "Monet; Unknown artist",
    ],
)
def test_unknown_creator_labels_do_not_establish_an_artist_match(name):
    objects = [obj("met:1"), obj("wikidata:Q1")]
    mapping, audit = find_merges(
        objects,
        {o["key"]: np.array([1.0, 0.0]) for o in objects},
        {o["key"]: name for o in objects},
    )
    assert mapping == {o["key"]: o["key"] for o in objects}
    assert audit == []


@pytest.mark.parametrize("rights", ["unknown", "in_copyright"])
def test_merge_rights_propagate_through_shared_artworks_and_clear_all_thumbnails(
    merged_corpus, tmp_path, rights
):
    merged_corpus()
    metadata = tmp_path / "metadata"
    objects = read_jsonl(metadata / "objects.jsonl")
    artworks = read_jsonl(metadata / "artworks.jsonl")
    # art:0 links to art:1 through one duplicate and art:1 links to art:2 through another.
    objects[-1]["artworkKey"] = "art:1"
    objects.append({**objects[1], "key": "wikidata:Q2", "artworkKey": "art:2"})
    # The second duplicate is metadata-only; its image is not part of this feature snapshot.
    objects[-1].pop("imageRef")
    artworks[2]["rightsStatus"] = rights
    write_jsonl(metadata / "objects.jsonl", objects)
    write_jsonl(metadata / "artworks.jsonl", artworks)
    stats = json.loads((metadata / "stats.json").read_text())
    stats["objects"] = len(objects)
    write_json(metadata / "stats.json", stats)
    out = tmp_path / "reviewed"

    run(tmp_path / "features", metadata, out)

    assert {row["rightsStatus"] for row in read_jsonl(out / "artworks.jsonl")} == {rights}
    assert all("thumbnailUrl" not in row for row in read_jsonl(out / "objects.jsonl"))


def test_public_domain_survivor_keeps_an_admitted_alias_thumbnail(merged_corpus, tmp_path):
    merged_corpus()
    metadata = tmp_path / "metadata"
    objects = read_jsonl(metadata / "objects.jsonl")
    objects[0].pop("thumbnailUrl")
    objects[-1]["thumbnailUrl"] = "https://commons.test/admitted.jpg"
    objects[-1]["artworkKey"] = "art:1"
    write_jsonl(metadata / "objects.jsonl", objects)
    out = tmp_path / "reviewed"

    run(tmp_path / "features", metadata, out)

    merged = {row["key"]: row for row in read_jsonl(out / "objects.jsonl")}
    assert merged["met:0"]["thumbnailUrl"] == "https://commons.test/admitted.jpg"
    assert merged["met:1"]["thumbnailUrl"] == objects[1]["thumbnailUrl"]
    assert merged["wikidata:Q1"]["mergedIntoKey"] == "met:0"


def test_dedupe_refuses_features_from_different_download_inputs(merged_corpus, tmp_path):
    merged_corpus()
    metadata = tmp_path / "metadata"
    rows = read_jsonl(metadata / "objects.jsonl")
    rows[0]["imageRef"] = "https://museum.test/replacement.jpg"
    write_jsonl(metadata / "objects.jsonl", rows)
    out = tmp_path / "different-merged"

    with pytest.raises(ValueError, match="download inputs"):
        run(tmp_path / "features", metadata, out)

    assert not out.exists()


def test_additions_attach_to_imported_survivors_without_rewriting_them(delta_package):
    out, stats = delta_package()

    assert {row["key"] for row in read_jsonl(out / "artworks.jsonl")} == {"cma:1", "fng:2"}
    objects = {row["key"]: row for row in read_jsonl(out / "objects.jsonl")}
    assert objects.keys() == {"cma:1", "fng:2"}
    assert objects["cma:1"]["mergedIntoKey"] == "met:0"
    assert objects["cma:1"]["thumbnailUrl"] == "https://cma.test/1-small.jpg"
    assert "mergedIntoKey" not in objects["fng:2"]
    assert [
        (row["objectKey"], row["venueKey"]) for row in read_jsonl(out / "placements.jsonl")
    ] == [
        ("fng:2", "museum:2"),
        ("met:0", "museum:2"),
    ]
    assert {row["viewKey"]: row["objectKey"] for row in read_jsonl(out / "vector-index.jsonl")} == {
        "cma:1": "met:0",
        "fng:2": "fng:2",
    }
    assert read_jsonl(out / "descriptor-index.jsonl") == [
        {"objectKey": "fng:2", "viewKey": "fng:2"}
    ]
    assert read_jsonl(out / "external-references.jsonl") == [{"table": "objects", "key": "met:0"}]
    assert stats["delta"]["aliasesOfImported"] == 1


def test_additions_supply_descriptors_for_an_imported_object_without_features(delta_package):
    from pipeline.push import Corpus

    image = "https://cma.test/1.jpg"
    out, stats = delta_package(
        artworks=[
            {
                "key": "cma:1",
                "title": "Painting 2",
                "artist": "Artist 2",
                "rightsStatus": "public_domain",
            }
        ],
        objects=[
            {
                "key": "cma:1",
                "artworkKey": "cma:1",
                "ownerKey": "museum:1",
                "accession": "2",
                "source": "corpus",
                "sourceId": "1",
                "imageRef": image,
                "pageUrl": "https://cma.test/1",
            }
        ],
        placements=[],
        axes={"cma:1": 1},
    )

    assert read_jsonl(out / "descriptor-index.jsonl") == [
        {"objectKey": "met:2", "viewKey": "cma:1"}
    ]
    assert stats["descriptors"] == 1
    corpus = Corpus(out)
    assert corpus.referenced_rows() == {"objects": ["met:2"], "artworks": []}
    assert corpus.batch("descriptors", 0, 1) == [
        {
            "objectKey": "met:2",
            "extractedFrom": image,
            **corpus.features.descriptors("cma:1"),
        }
    ]


def test_additions_never_join_two_imported_survivors(delta_package):
    # Its accession matches met:1 while its image matches met:0, which has the same artist and owner.
    out, _ = delta_package(
        artworks=[
            {
                "key": "fng:9",
                "title": "Bridge",
                "artist": "Artist 1",
                "rightsStatus": "public_domain",
            }
        ],
        objects=[
            {
                "key": "fng:9",
                "artworkKey": "fng:9",
                "ownerKey": "museum:1",
                "accession": "1",
                "source": "corpus",
                "sourceId": "9",
                "imageRef": "https://fng.test/9.jpg",
                "pageUrl": "https://fng.test/9",
            }
        ],
        placements=[],
        axes={"fng:9": 0},
    )

    assert read_jsonl(out / "merges.jsonl") == [
        {"from": "fng:9", "into": "met:1", "rule": "accession"}
    ]


def test_an_addition_answers_to_its_imported_artworks_rights(merged_corpus, delta_package):
    base = merged_corpus()
    # The imported art:1 has no public-domain claim; a museum record of the same artwork says it is.
    artworks = read_jsonl(base / "artworks.jsonl")
    for row in artworks:
        if row["key"] == "art:1":
            row["rightsStatus"] = "unknown"
    write_jsonl(base / "artworks.jsonl", artworks)
    stats = json.loads((base / "stats.json").read_text())
    stats["files"]["artworks.jsonl"] = file_hash(base / "artworks.jsonl")
    write_json(base / "stats.json", stats)

    out, _ = delta_package(
        artworks=[
            {
                "key": "art:1",
                "title": "Painting 1",
                "artist": "Artist 1",
                "rightsStatus": "public_domain",
            }
        ],
        objects=[
            {
                "key": "fng:5",
                "artworkKey": "art:1",
                "ownerKey": "museum:3",
                "source": "corpus",
                "sourceId": "5",
                "imageRef": "https://fng.test/5.jpg",
                "thumbnailUrl": "https://fng.test/5-small.jpg",
                "pageUrl": "https://fng.test/5",
            }
        ],
        placements=[],
        axes={"fng:5": 3},
        base=base,
    )

    assert read_jsonl(out / "artworks.jsonl") == []
    assert "thumbnailUrl" not in read_jsonl(out / "objects.jsonl")[0]
    assert read_jsonl(out / "external-references.jsonl") == [
        {"table": "artworks", "key": "art:1", "rightsStatus": "unknown"}
    ]
