#!/usr/bin/env python3
"""Reconstitute the pinned MorphEm ONNX export without exporter-version drift.

Only Python's standard library is required (Python >= 3.10). The small vendored
recipe retains the original graph/constant/metadata bytes, not learned weights.
All 150 learned tensors come from the hash-verified upstream safetensors file;
48 matrices are transposed as uint32 words, without floating-point arithmetic.
Use --freeze-from to reproduce the recipe from the original verified export.
"""

import argparse
from array import array
import base64
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import struct
import tempfile
import urllib.request

REVISION = "0e8d58787421f83f975634d72420d85c5dfc9c2c"
WEIGHTS_BYTES = 175299208
WEIGHTS_SHA256 = "1609131fe5720d3a11ccbb802ef1c0b2cdd1e21e9628f6d2660607d1c4a1431e"
MODEL_BYTES = 86216588
MODEL_SHA256 = "819132f2ef159e04e718bdf7c9e83a1e30f81cd305ca1ff299d74c5a6a9cec31"
# Updated only when regenerating the weight-free recipe with --freeze-from.
RECIPE_SHA256 = "246f42e6fcff24dd1f8247adcf14b662487230a2571157570ccb8f167b55753c"
RECIPE = Path(__file__).with_name("morphem-vit.recipe.json.gz")
WEIGHTS_URL = f"https://huggingface.co/CaicedoLab/MorphEm/resolve/{REVISION}/model.safetensors"


def verify(path, size, sha256):
    digest = hashlib.sha256()
    actual_size = 0
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            actual_size += len(chunk)
            digest.update(chunk)
    actual_hash = digest.hexdigest()
    if actual_size != size or actual_hash != sha256:
        raise ValueError(
            f"{path}: expected {size} bytes / {sha256}; got {actual_size} / {actual_hash}"
        )


def download_weights(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".morphem-download-", dir=path.parent)
    try:
        print(f"Downloading pinned MorphEm weights ({WEIGHTS_BYTES} bytes)", flush=True)
        request = urllib.request.Request(WEIGHTS_URL, headers={"User-Agent": "musivarium-setup/1"})
        with os.fdopen(fd, "wb") as output:
            with urllib.request.urlopen(request, timeout=120) as response:
                received = 0
                while chunk := response.read(1024 * 1024):
                    received += len(chunk)
                    if received > WEIGHTS_BYTES:
                        raise ValueError("MorphEm weights exceed pinned size")
                    output.write(chunk)
        verify(Path(temporary), WEIGHTS_BYTES, WEIGHTS_SHA256)
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def read_header(stream):
    header_length = struct.unpack("<Q", stream.read(8))[0]
    if header_length > 1024 * 1024:
        raise ValueError("Unexpected safetensors header length")
    return json.loads(stream.read(header_length)), 8 + header_length


def tensor_bytes(stream, header, start, name, transpose):
    info = header[name]
    if info["dtype"] != "F32":
        raise ValueError(f"Unexpected dtype for {name}: {info['dtype']}")
    begin, end = info["data_offsets"]
    count = 1
    for dimension in info["shape"]:
        count *= dimension
    if end - begin != count * 4 or begin < 0 or end + start > WEIGHTS_BYTES:
        raise ValueError(f"Invalid tensor bounds for {name}")
    stream.seek(start + begin)
    raw = stream.read(end - begin)
    if len(raw) != end - begin:
        raise ValueError(f"Truncated tensor: {name}")
    if transpose:
        rows, columns = info["shape"]
        words = array("I")
        if words.itemsize != 4:
            raise RuntimeError("This platform does not have 32-bit unsigned int arrays")
        words.frombytes(raw)
        transposed = array("I")
        for column in range(columns):
            transposed.extend(words[column::columns])
        raw = transposed.tobytes()
    return raw


def assemble(weights, target):
    compressed = RECIPE.read_bytes()
    if hashlib.sha256(compressed).hexdigest() != RECIPE_SHA256:
        raise ValueError("MorphEm graph recipe SHA-256 mismatch")
    recipe = json.loads(gzip.decompress(compressed))
    if recipe["format"] != 1 or recipe["model_sha256"] != MODEL_SHA256:
        raise ValueError("Unexpected MorphEm graph recipe")
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".morphem-export-", dir=target.parent)
    try:
        with os.fdopen(fd, "wb") as output, weights.open("rb") as source:
            header, start = read_header(source)
            for step in recipe["steps"]:
                if "bytes" in step:
                    output.write(base64.b64decode(step["bytes"], validate=True))
                else:
                    output.write(tensor_bytes(source, header, start, step["tensor"], step["transpose"]))
        verify(Path(temporary), MODEL_BYTES, MODEL_SHA256)
        # Never replace a pre-existing model, even if another setup finished first.
        if target.exists():
            verify(target, MODEL_BYTES, MODEL_SHA256)
        else:
            os.replace(temporary, target)
    finally:
        Path(temporary).unlink(missing_ok=True)
    print(f"Verified {target} ({MODEL_BYTES} bytes; SHA-256 {MODEL_SHA256})", flush=True)


def protobuf_fields(data, start=0, end=None):
    """Yield field number and payload bounds, preserving all original wire bytes."""
    end = len(data) if end is None else end
    position = start

    def varint():
        nonlocal position
        result = 0
        for shift in range(0, 70, 7):
            byte = data[position]
            position += 1
            result |= (byte & 127) << shift
            if byte < 128:
                return result
        raise ValueError("Invalid protobuf varint")

    while position < end:
        tag = varint()
        wire_type = tag & 7
        if wire_type == 0:
            begin = position
            varint()
        elif wire_type in (1, 5):
            begin = position
            position += 8 if wire_type == 1 else 4
        elif wire_type == 2:
            length = varint()
            begin = position
            position += length
        else:
            raise ValueError(f"Unsupported protobuf wire type {wire_type}")
        if position > end:
            raise ValueError("Invalid protobuf field bounds")
        yield tag >> 3, begin, position


def weight_mapping(name):
    direct = {
        "proj_w": "patch_embed.proj.weight", "proj_b": "patch_embed.proj.bias",
        "cls_token": "cls_token", "pos_embed": "pos_embed",
        "norm_w": "norm.weight", "norm_b": "norm.bias",
    }
    if name in direct:
        return direct[name], False
    match = re.fullmatch(r"blocks\.(\d+)\.(norm[12]|qkv|proj|fc[12])_([wb])", name)
    if match:
        block, layer, kind = match.groups()
        layer = {"qkv": "attn.qkv", "proj": "attn.proj", "fc1": "mlp.fc1", "fc2": "mlp.fc2"}.get(layer, layer)
        return f"blocks.{block}.{layer}.{'weight' if kind == 'w' else 'bias'}", False
    match = re.fullmatch(r"permute(?:_(\d+))?", name)
    if match:
        index = int(match.group(1) or 0)
        layer = {0: "attn.qkv", 2: "attn.proj", 3: "mlp.fc1", 4: "mlp.fc2"}[index % 5]
        return f"blocks.{index // 5}.{layer}.weight", True
    return None


def freeze(original, weights, target):
    """Remove only verified learned tensor payloads; retain exact protobuf framing."""
    verify(original, MODEL_BYTES, MODEL_SHA256)
    data = original.read_bytes()
    graph = next((begin, end) for field, begin, end in protobuf_fields(data) if field == 7)
    replacements = []
    with weights.open("rb") as source:
        header, start = read_header(source)
        for field, begin, end in protobuf_fields(data, *graph):
            if field != 5:  # GraphProto.initializer
                continue
            fields = list(protobuf_fields(data, begin, end))
            name = next(data[a:b].decode() for f, a, b in fields if f == 8)
            mapping = weight_mapping(name)
            if mapping is None:
                if not name.startswith("val_"):
                    raise ValueError(f"Unmapped initializer {name}")
                continue  # Keep the original small non-learned constants.
            raw_begin, raw_end = next((a, b) for f, a, b in fields if f == 9)
            tensor, transpose = mapping
            if data[raw_begin:raw_end] != tensor_bytes(source, header, start, tensor, transpose):
                raise ValueError(f"Initializer does not match upstream weights: {name}")
            replacements.append((raw_begin, raw_end, tensor, transpose))
    if len(replacements) != 150:
        raise ValueError(f"Expected 150 learned tensors; found {len(replacements)}")
    steps = []
    cursor = 0
    for begin, end, tensor, transpose in sorted(replacements):
        steps.append({"bytes": base64.b64encode(data[cursor:begin]).decode()})
        steps.append({"tensor": tensor, "transpose": transpose})
        cursor = end
    steps.append({"bytes": base64.b64encode(data[cursor:]).decode()})
    recipe = {"format": 1, "model_sha256": MODEL_SHA256, "steps": steps}
    compressed = gzip.compress(json.dumps(recipe, separators=(",", ":")).encode(), mtime=0)
    if len(compressed) >= 500_000:
        raise ValueError("Weight-free recipe exceeds the vendoring budget")
    with target.open("xb") as output:
        output.write(compressed)
    print(f"Recipe: {len(compressed)} bytes; SHA-256 {hashlib.sha256(compressed).hexdigest()}", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("public/models/morphem-vit.onnx"))
    parser.add_argument("--weights", type=Path, help="Use existing pinned safetensors (offline; never overwritten)")
    parser.add_argument("--cache-dir", type=Path, default=Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")) / "musivarium" / "morphem" / REVISION)
    parser.add_argument("--freeze-from", type=Path, help="Maintenance: derive the weight-free recipe from the original pinned ONNX")
    parser.add_argument("--recipe-output", type=Path, default=RECIPE)
    args = parser.parse_args()
    if args.output.exists() and not args.freeze_from:
        verify(args.output, MODEL_BYTES, MODEL_SHA256)
        print(f"Verified existing {args.output}", flush=True)
        return
    weights = args.weights or args.cache_dir / "model.safetensors"
    if not weights.exists() and not args.weights:
        download_weights(weights)
    verify(weights, WEIGHTS_BYTES, WEIGHTS_SHA256)
    if args.freeze_from:
        freeze(args.freeze_from, weights, args.recipe_output)
    else:
        assemble(weights, args.output)


if __name__ == "__main__":
    main()
