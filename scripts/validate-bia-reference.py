# /// script
# requires-python = ">=3.11"
# dependencies = ["numcodecs==0.15.0"]
# ///
"""Verify the pinned BIA planes independently of DuckDB-Zarr; never rewrite the reference."""
import hashlib
import json
from pathlib import Path

import numcodecs

root = Path(__file__).resolve().parents[1] / 'tests/browser/fixtures/bia3204'
manifest = json.loads((root / 'manifest.json').read_text())
expected = json.loads((root / 'expected.json').read_text())
assert numcodecs.__version__ == expected['reference']['numcodecsVersion']
codec = numcodecs.Blosc(cname='lz4', clevel=5, shuffle=1)
for channel in expected['channels']:
    key = f"2/0/{channel['channel']}/0/0/0"
    entry = next(e for e in manifest['entries'] if e['key'] == key)
    compressed = (root / entry['file']).read_bytes()
    assert hashlib.sha256(compressed).hexdigest() == entry['sha256'], key
    decoded = bytes(codec.decode(compressed))
    assert len(decoded) == channel['bytes'], key
    assert hashlib.sha256(decoded).hexdigest() == channel['sha256'], key
    print(json.dumps({'channel': channel['channel'], 'bytes': len(decoded), 'sha256': channel['sha256'], 'status': 'pass'}))
