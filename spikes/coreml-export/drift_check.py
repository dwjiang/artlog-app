import argparse
from hashlib import sha256
import json
from pathlib import Path
import time

import coremltools as ct
import numpy as np
from PIL import Image
import torch

from calibration import CALIBRATION, image_path, letterbox
from wrapper import ARTIFACTS, EMBEDDING_DIM, build


def normalized(vectors):
    values = np.asarray(vectors, dtype=np.float64)
    if values.ndim != 2 or not np.isfinite(values).all():
        raise ValueError("Expected a finite matrix of embeddings")
    norms = np.linalg.norm(values, axis=1, keepdims=True)
    if np.any(norms == 0):
        raise ValueError("Zero embedding")
    return values / norms


def cosine(left, right):
    if np.shape(left) != np.shape(right) or not len(left):
        raise ValueError("Embedding batches must have the same nonzero shape")
    scores = np.sum(normalized(left) * normalized(right), axis=1)
    return {"mean": float(scores.mean()), "min": float(scores.min()), "count": len(scores)}


def agreement(left, right, index):
    if np.shape(left) != np.shape(right) or not len(left) or not len(index):
        raise ValueError("Expected matching queries and a nonempty index")
    database = normalized(index)
    a = np.argmax(normalized(left) @ database.T, axis=1)
    b = np.argmax(normalized(right) @ database.T, axis=1)
    return float(np.mean(a == b) * 100)


def pytorch_embeddings(model, images, half=False, device="mps"):
    model.to(device)
    if half:
        model.half()
        # Module.half() does not update RADIO's ordinary Python dtype attribute.
        model.radio.input_conditioner.dtype = torch.float16
    vectors = []
    with torch.inference_mode():
        for image in images:
            tensor = torch.from_numpy(np.asarray(image).copy()).permute(2, 0, 1).unsqueeze(0).float() / 255
            tensor = tensor.to(device=device, dtype=torch.float16 if half else torch.float32)
            vectors.append(model(tensor).float().cpu().numpy()[0])
    return np.asarray(vectors)


def coreml_embeddings(size, variant, images):
    path = ARTIFACTS / f"cradio-v3b-dino-{size}-{variant}.mlpackage"
    started = time.perf_counter()
    model = ct.models.MLModel(str(path), compute_units=ct.ComputeUnit.CPU_AND_NE)
    load_ms = (time.perf_counter() - started) * 1000
    vectors = []
    for image in images:
        result = np.asarray(model.predict({"image": image})["embedding"]).reshape(-1)
        if result.shape != (EMBEDDING_DIM,) or not np.isfinite(result).all():
            raise ValueError(f"Invalid {variant} CoreML output")
        vectors.append(result)
    return np.asarray(vectors), load_ms


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--size", type=int, choices=(448, 512), default=512)
    parser.add_argument("--iphone", type=Path)
    parser.add_argument("--torch-device", choices=("cpu", "mps", "cuda"), default="mps")
    args = parser.parse_args()
    urls = (CALIBRATION / "urls.txt").read_text().splitlines()
    if len(urls) != len(set(urls)) or not urls:
        raise ValueError("Calibration URLs must be unique and nonempty")
    images = [letterbox(Image.open(image_path(url)), args.size) for url in urls]
    report = {"size": args.size, "calibration_count": len(urls), "required_calibration_count": 200,
              "calibration_manifest_sha256": sha256((CALIBRATION / "manifest.json").read_bytes()).hexdigest(),
              "scope": "macOS CPU_AND_NE; not iPhone evidence", "torch_device": args.torch_device,
              "cosines": {}, "mac_load_ms": {}}
    fp32 = pytorch_embeddings(build(), images, device=args.torch_device)
    quantized = build()
    quantized.load_state_dict(torch.load(ARTIFACTS / "fakequant_state.pt", weights_only=True))
    fakequant = pytorch_embeddings(quantized, images, half=True, device=args.torch_device)
    batches = {"pytorch_fp32": fp32, "pytorch_fakequant_fp16": fakequant}
    report["cosines"]["fp32_fakequant"] = cosine(fp32, fakequant)
    for variant in (("fp16", "int8", "int4") if args.size == 512 else ("fp16", "int8")):
        vectors, load_ms = coreml_embeddings(args.size, variant, images)
        batches[f"coreml_{variant}"] = vectors
        report["mac_load_ms"][variant] = load_ms
        report["cosines"][f"fp32_coreml_{variant}"] = cosine(fp32, vectors)
        report["cosines"][f"fakequant_coreml_{variant}"] = cosine(fakequant, vectors)
        print(variant, report["cosines"][f"fakequant_coreml_{variant}"], flush=True)
    if args.iphone:
        metadata_path = args.iphone.with_name(args.iphone.name.replace("embeddings.json", "report.json"))
        metadata = json.loads(metadata_path.read_text())
        export_metadata = json.loads((ARTIFACTS / f"cradio-v3b-dino-{args.size}-int8.json").read_text())
        if (metadata["weights_sha256"] != export_metadata["weights_sha256"]
                or metadata["size"] != args.size or metadata["compute_units"] != "cpuAndNeuralEngine"):
            raise ValueError("iPhone reference does not match this export and compute configuration")
        device = json.loads(args.iphone.read_text())
        if set(device) != set(urls):
            raise ValueError("iPhone and local calibration URLs do not match")
        iphone = np.asarray([device[url] for url in urls])
        if iphone.shape != fakequant.shape:
            raise ValueError("iPhone embedding dimensions do not match")
        report["cosines"]["fakequant_iphone_int8"] = cosine(fakequant, iphone)
        batches["iphone_int8"] = iphone
    else:
        report["cosines"]["fakequant_iphone_int8"] = "not measured: no iPhone embedding file supplied"
    index_file = CALIBRATION / "index-urls.txt"
    report["top1_agreement_percent"] = "not measured: 2000-image mini-index unavailable"
    if index_file.exists():
        index_urls = index_file.read_text().splitlines()
        if len(index_urls) != 2000 or len(set(index_urls)) != 2000 or set(index_urls) & set(urls):
            raise ValueError("Index must contain exactly 2000 unique, disjoint images")
        cache = ARTIFACTS / f"index-{args.size}.npz"
        signature = sha256(index_file.read_bytes() + (ARTIFACTS / "fakequant_state.pt").read_bytes()).hexdigest()
        if cache.exists():
            data = np.load(cache)
            if str(data["signature"]) != signature:
                raise ValueError("Stale mini-index; delete the cache and rerun")
            index = data["vectors"]
        else:
            index_images = (letterbox(Image.open(image_path(url)), args.size) for url in index_urls)
            index = pytorch_embeddings(quantized, index_images, half=True, device=args.torch_device)
            np.savez(cache, signature=signature, vectors=index)
        report["top1_agreement_percent"] = {name: agreement(fp32, values, index) for name, values in batches.items() if name != "pytorch_fp32"}
    report["acceptance"] = "provisional: full calibration, iPhone drift, latency and retrieval evidence required"
    destination = ARTIFACTS / f"drift-{args.size}.json"
    destination.write_text(json.dumps(report, indent=2) + "\n")
    np.savez(ARTIFACTS / f"embeddings-{args.size}.npz", urls=urls, **batches)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
