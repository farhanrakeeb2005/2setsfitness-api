"""Build step: download the Kokoro model from the official sherpa-onnx release,
check its SHA-256, and unpack only the files the English voice needs.

python fetch_model.py <url> <sha256> <dest dir>
"""
import hashlib
import os
import sys
import tarfile
import urllib.request

url, want, dest = sys.argv[1], sys.argv[2].lower(), sys.argv[3]
if not url.startswith("https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/"):
    sys.exit("model URL must be an official k2-fsa sherpa-onnx tts-models release")
archive = "/tmp/model.tar.bz2"
h = hashlib.sha256()
with urllib.request.urlopen(url, timeout=600) as r, open(archive, "wb") as f:
    for chunk in iter(lambda: r.read(1 << 20), b""):
        h.update(chunk)
        f.write(chunk)
if h.hexdigest() != want:
    sys.exit(f"checksum mismatch: got {h.hexdigest()}, want {want}")

# the English voice needs the model, voices, tokens, espeak data and the US lexicon
KEEP = ("model.onnx", "model.int8.onnx", "voices.bin", "tokens.txt", "lexicon-us-en.txt", "LICENSE", "espeak-ng-data/")
os.makedirs(dest, exist_ok=True)
with tarfile.open(archive, "r:bz2") as t:
    members = []
    for m in t.getmembers():
        parts = m.name.split("/", 1)
        if len(parts) < 2 or not (m.isfile() or m.isdir()):
            continue
        rel = parts[1]
        if not any(rel == k or rel.startswith(k) for k in KEEP):
            continue
        m.name = rel
        members.append(m)
    t.extractall(dest, members=members, filter="data")
os.remove(archive)
for k in ("voices.bin", "tokens.txt", "lexicon-us-en.txt", "espeak-ng-data"):
    if not os.path.exists(os.path.join(dest, k)):
        sys.exit(f"missing {k} in the archive")
print("model ready:", sorted(os.listdir(dest)))
