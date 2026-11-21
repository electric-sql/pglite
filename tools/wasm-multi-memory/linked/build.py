"""Run in the shared-tools SDK. Inputs are the normal build outputs of the branch."""

import argparse
from hashlib import sha256
import json
import re
import subprocess
import tarfile
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("release", type=Path)
parser.add_argument("vector_source", type=Path)
parser.add_argument("output", type=Path)
loop_mode = parser.add_mutually_exclusive_group()
loop_mode.add_argument("--version-private-loops", action="store_true")
loop_mode.add_argument("--version-mixed-loops", action="store_true")
args = parser.parse_args()
release, vector_source, output = args.release, args.vector_source, args.output
output.mkdir(exist_ok=True, parents=True)
temp = Path("build/linked/ir")
temp.mkdir(parents=True, exist_ok=True)
loop_variant = None
if args.version_private_loops:
    loop_variant = "versioned"
elif args.version_mixed_loops:
    loop_variant = "mixed"
vector = temp / (f"vector-{loop_variant}" if loop_variant else "vector")
vector.mkdir(exist_ok=True)
with tarfile.open(vector_source) as archive:
    archive.extractall(vector, filter="data")
vector_so = vector / "lib/postgresql/vector.so"
vector_ir = temp / "vector.ir.wasm"
subprocess.run(
    [
        "pglite-transform-side-module",
        vector_so,
        vector_ir,
        temp / "vector.report",
        temp / "vector.audit",
    ],
    check=True,
)
if loop_variant:
    versioned = temp / f"vector.{loop_variant}.wasm"
    command = ["build/linked/version-loops", vector_ir, versioned]
    if args.version_mixed_loops:
        command.append("--mixed")
    subprocess.run(command, check=True)
    vector_ir = versioned
glue = (release / "postmaster.js").read_text()
data = (release / "postmaster.data").read_bytes()
pattern = r"loadPackage\(\{files:\[(.*?)\],remote_package_size:(\d+)\}\)"
match = re.search(pattern, glue)
assert int(match[2]) == len(data)
entries = re.findall(r'\{filename:"([^"]+)",start:(\d+),end:(\d+)\}', match[1])
assert len(entries) == match[1].count("filename:")
inputs = [
    (release / "postmaster.wasm", output / "postmaster.wasm"),
    (vector_ir, vector_so),
]
chunks = []
for index, (name, start, end) in enumerate(entries):
    chunk = data[int(start) : int(end)]
    if chunk.startswith(b"\0asm"):
        source = temp / f"embedded-{index}.wasm"
        target = temp / f"linked-{index}.wasm"
        source.write_bytes(chunk)
        inputs.append((source, target))
        chunks.append(target)
    else:
        chunks.append(chunk)
manifest = temp / "files"
manifest.write_text("".join(f"{a} {b}\n" for a, b in inputs))
subprocess.run(
    [
        "build/linked/lower",
        manifest,
        output / "linked-shared.wasm",
        output / "linked-unshared.wasm",
    ],
    check=True,
)
if loop_variant:
    subprocess.run(
        ["wasm-opt", "--all-features", "-O3", vector_so, "-o", vector_so], check=True
    )
result = bytearray()
files = []
for (name, _, _), chunk in zip(entries, chunks):
    start = len(result)
    result.extend(chunk.read_bytes() if isinstance(chunk, Path) else chunk)
    files.append({"filename": name, "start": start, "end": len(result)})
metadata = json.dumps(
    {"files": files, "remote_package_size": len(result)}, separators=(",", ":")
)
glue = glue[: match.start()] + "loadPackage(" + metadata + ")" + glue[match.end() :]
(output / "postmaster.data").write_bytes(result)


# Mirror the source-level dylink hook in the already-built SDK glue.
def link_glue(text):
    start = text.index('var pgliteMemoryABI=Module["pgliteMemoryABI"];')
    end = text.index("function postInstantiation(", start)
    hook = 'if(Module["pgliteLinkSideModule"]){binary=Module["pgliteLinkSideModule"](binary,info)}'
    if "pgliteLinkSideModule" in text[:start]:
        hook = ""
    return text[:start] + hook + text[end:]


def shared_syscall_strings(text):
    if "pgliteReadSharedString" in text:
        return text
    marker = "getStr(ptr){var ret=UTF8ToString(ptr)"
    assert text.count(marker) == 1
    return text.replace(
        marker,
        'getStr(ptr){var ret=(ptr>>>31)&&Module["pgliteReadSharedString"]?Module["pgliteReadSharedString"](ptr):UTF8ToString(ptr)',
    )


(output / "postmaster.js").write_text(shared_syscall_strings(link_glue(glue)))
(output / "pglite.js").write_text(link_glue((release / "pglite.js").read_text()))
config = json.loads(
    Path("packages/pglite-pgvector/extension-artifacts/wasm32-classic.json").read_text()
)
config["target"].update(topology="faceted", memoryAbi="pglite-linked-wasm32-v1")
config["capabilities"] = {
    "directSharedMemory": True,
    "backgroundWorkers": False,
    "parallelWorkers": False,
}
(temp / "config.json").write_text(json.dumps(config))
subprocess.run(
    [
        "node22",
        "tools/wasm-multi-memory/extensions/package-extension.mjs",
        temp / "config.json",
        vector,
        output / "vector.tar.gz",
        output / "vector.json",
    ],
    check=True,
)
print("Linked core, pgvector and", len(inputs) - 2, "embedded Wasm modules", flush=True)
identity = json.loads((release / "runtime-identity.json").read_text())
for mode, file in [
    ("classic", release / "pglite.wasm"),
    ("postmaster", output / "postmaster.wasm"),
]:
    digest = sha256(file.read_bytes()).hexdigest()
    identity["artifacts"][mode].update(artifactSha256=digest, buildId=digest)
identity["artifacts"]["postmaster"]["memoryTopology"] = "faceted"
(output / "runtime-identity.json").write_text(json.dumps(identity, indent=2) + "\n")
