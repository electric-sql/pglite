"""Check the hot loops in the final pgvector binaries from the pinned SDK."""

import re
import subprocess
import sys
from pathlib import Path


def loops(wat, export):
    function = re.search(r'\(export "' + export + r'" \(func (\$[^)]+)\)', wat)[1]
    body = wat.split(f"\n (func {function} ", 1)[1].split("\n (func ", 1)[0]
    for loop in re.finditer(r"^( +)\(loop ", body, re.MULTILINE):
        # wasm-dis indents the closing parenthesis to match the opening one.
        yield body[loop.start() :].split("\n" + loop[1] + ")", 1)[0]


output = Path(sys.argv[1])
mixed = sys.argv[2:] == ["--mixed"]
scalar = (4, 4, 4, 0)
direct = (0, 4, 0, 0)
for backend in ["native", "linked"]:
    versions = ["mixed"] if mixed else ["original", "versioned"]
    for version in versions:
        binary = output / f"{backend}-{version}" / "files/lib/postgresql/vector.so"
        wat = subprocess.check_output(["wasm-dis", "--all-features", binary], text=True)
        expected = [scalar]
        if version != "original":
            expected.append(direct)
        if mixed:
            if backend == "linked":
                symbol = re.search(
                    r'\(import "pgl_global" "load_f32_4u" \(func (\$\S+)', wat
                )[1]
                access = "(call " + symbol + "\n"
                expected.append((0, 2, 2, 2))
            else:
                symbol = re.search(
                    r'\(import "pglite" "global_memory" \(memory (\$\S+)', wat
                )[1]
                access = "(f32.load " + symbol + "\n"
                expected.append((0, 4, 0, 2))
        for name in [
            "l2_distance",
            "vector_l2_squared_distance",
            "l1_distance",
            "cosine_distance",
        ]:
            shapes = [
                (
                    code.count("(if "),
                    code.count("(f32.load"),
                    code.count("(call "),
                    code.count(access) if mixed else 0,
                )
                for code in loops(wat, name)
            ]
            assert sorted(shapes) == sorted(expected), (backend, version, name, shapes)
print("Verified packaged distance loops and their memory instructions.")
