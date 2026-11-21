"""Validate SQL benchmark results and print the three-process medians."""

import json
import sys
from pathlib import Path
from statistics import median

results = Path(sys.argv[1])
operators = ["l2", "l1", "cosine"]
metrics = [
    f"{table}_{op}_ms" for table in ["inline_points", "points"] for op in operators
] + ["searchMs", "buildIndexMs", "twoSessionsQps"]
configurations = [
    ("linked", "classic"),
    ("linked", "postmaster"),
    ("native", "postmaster"),
]
if (results / "stock-original-classic-1.json").exists():
    configurations.insert(0, ("stock", "classic"))

paired = sys.argv[2:] or ["original", "versioned"]
reference = None
print("backend mode pass", *metrics, sep="\t")
for backend, mode in configurations:
    versions = ["original"] if backend == "stock" else paired
    for version in versions:
        runs = []
        for round_number in range(1, 4):
            path = results / f"{backend}-{version}-{mode}-{round_number}.json"
            run = json.loads(path.read_text())
            assert run["mode"] == mode, path
            values = run["metrics"]
            checksums = [values[f"points_{op}_checksum"] for op in operators]
            assert checksums == [
                values[f"inline_points_{op}_checksum"] for op in operators
            ], path
            signature = (run["node"], run["settings"], checksums)
            if reference is None:
                reference = signature
            assert signature == reference, path
            runs.append(values)

        row = []
        for metric in metrics:
            if mode == "classic" and metric == "twoSessionsQps":
                row.append("-")
            else:
                row.append(f"{median(run[metric] for run in runs):.3f}")
        print(f"{backend} {mode} {version}", *row, sep="\t")
