"""Enumerate shipped Wasm, including side modules inside Emscripten data and contrib archives."""

import json
import re
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

release, *extension_archives = map(Path, sys.argv[1:])
with tempfile.TemporaryDirectory() as scratch:
    output = Path(scratch)
    modules = {}

    def collect(name, data):
        if name.endswith((".so", ".wasm")) and not data.startswith(b"\x00asm"):
            raise ValueError(f"invalid packaged Wasm: {name}")
        if data.startswith(b"\x00asm"):
            path = output / str(len(modules))
            path.write_bytes(data)
            modules[name] = str(path)

    for wasm in sorted(release.glob("*.wasm")):
        collect(wasm.name, wasm.read_bytes())

    for package in release.glob("*.data"):
        data = package.read_bytes()
        glue = package.with_suffix(".js").read_text()
        matches = re.findall(
            r'loadPackage\((\{(?:"files"|files):\[.*?\],(?:"remote_package_size"|remote_package_size):[\d.eE+-]+\})\)',
            glue,
        )
        assert len(matches) == 1, package
        metadata = json.loads(
            re.sub(
                r"([\{,])(files|filename|start|end|remote_package_size):",
                r'\1"\2":',
                matches[0],
            )
        )
        assert metadata["remote_package_size"] == len(data)
        for entry in metadata["files"]:
            # Minifiers may spell an integral byte offset in scientific notation.
            start, end = int(entry["start"]), int(entry["end"])
            assert start == entry["start"] and end == entry["end"], entry
            assert 0 <= start <= end <= len(data), entry
            collect(package.name + entry["filename"], data[start:end])

    for bundle in [*sorted(release.glob("*.tar.gz")), *extension_archives]:
        with tarfile.open(bundle) as archive:
            for member in archive:
                if member.isfile():
                    collect(
                        bundle.name + "/" + member.name,
                        archive.extractfile(member).read(),
                    )

    manifest = output / "modules.json"
    manifest.write_text(json.dumps(modules))
    subprocess.run(
        ["node20", Path(__file__).with_name("audit.mjs"), manifest], check=True
    )
