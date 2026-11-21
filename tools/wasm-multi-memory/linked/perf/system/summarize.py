"""Validate fresh-process runs, save their inputs, and render the comparison tables."""

import argparse
import hashlib
import io
import json
import tarfile
from pathlib import Path
from statistics import median

ENGINES = [
    ("stock", "classic"),
    ("linked", "classic"),
    ("stock", "postmaster"),
    ("linked", "postmaster"),
]
LABELS = ["Stock classic", "Linked classic", "Native postmaster", "Linked postmaster"]
RULES = ["baseline", "pair-only", "core-only", "candidate"]
LATENCIES = {
    "point": "Indexed point lookup",
    "indexed_update": "Indexed update",
    "join": "Hash join",
    "spatial": "Indexed PostGIS search",
    "inline_payload_heap": "Inline, heap only",
    "inline_payload_detoast": "Inline, read byte",
    "inline_payload_copy": "Inline, copy and modify",
    "external_payload_heap": "External, heap only",
    "external_payload_detoast": "External, read byte",
    "external_payload_copy": "External, copy and modify",
    "hnsw_search": "HNSW top 10",
    "hnsw_build": "Build HNSW",
    "serial_aggregate": "Serial aggregate",
    "parallel_aggregate": "Two-worker aggregate",
}
MIB = 2**20


def read(path):
    return json.loads(path.read_text())


def digest(data):
    return {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def package_inventory(out, sdk):
    inventory = {}
    for label, location in [
        ("stock", out / "packages/stock"),
        ("linked", sdk / "packages"),
        ("candidate", out / "packages/candidate"),
    ]:
        packages = {}
        for pkg in ["0", "pgvector-", "postgis-"]:
            source = (
                sdk / "packages"
                if label == "candidate" and pkg == "postgis-"
                else location
            )
            (path,) = source.glob("electric-sql-pglite-" + pkg + "*.tgz")
            entry = digest(path.read_bytes())
            files = {}
            with tarfile.open(path) as archive:
                for member in archive:
                    name = member.name.removeprefix("package/dist/")
                    if "/" in name or not name.endswith((".wasm", ".tar.gz")):
                        continue
                    if pkg == "0" and name.endswith(".tar.gz"):
                        continue
                    data = archive.extractfile(member).read()
                    files[name] = digest(data)
                    if name.endswith(".tar.gz"):
                        with tarfile.open(fileobj=io.BytesIO(data)) as ext:
                            files[name]["modules"] = {
                                obj.name: digest(ext.extractfile(obj).read())
                                for obj in ext
                                if obj.isfile() and obj.name.endswith(".so")
                            }
            entry["files"] = files
            packages[path.name] = entry
        inventory[label] = packages
    return inventory


def table(headers, rows):
    return "\n".join(
        "| " + " | ".join(row) + " |"
        for row in [headers, ["---"] + ["---:"] * (len(headers) - 1), *rows]
    )


def value(run, path):
    for key in path:
        run = run[key]
    return run


def samples(group, path):
    return [value(row, path) for row in group]


def metric(group, path, scale=1):
    try:
        return median(samples(group, path)) / scale
    except KeyError:
        return None


def display(number):
    if number is None:
        return "—"
    return f"{number:,.{3 if number < 1 else 2 if number < 100 else 1}f}"


def main():
    args = argparse.ArgumentParser(description=__doc__)
    for key in ["out", "sdk", "dest"]:
        args.add_argument(key, type=Path)
    a = args.parse_args()
    a.dest.mkdir(parents=True, exist_ok=True)
    evidence = {
        "environment": read(a.out / "environment.json"),
        "packages": package_inventory(a.out, a.sdk),
    }
    evidence["profile"] = {
        k: v
        for k, v in read(a.out / "profile-counts.json").items()
        if k != "hnsw_build"
    }
    evidence["parallelLeader"] = {
        k: read(a.out / f"parallel-leader-{k}.json")
        for k in ["stock", "linked", "candidate"]
    }
    expected_hashes = {
        module["sha256"]
        for pkg in evidence["packages"]["candidate"].values()
        for archive in pkg["files"].values()
        for module in archive.get("modules", {}).values()
    }
    (probe,) = read(a.sdk / "probe/linked_probe.json")["extensionManifest"][
        "sideModules"
    ]
    expected_hashes.add(probe["sha256"])
    assert len(expected_hashes) == 5
    evidence["verifiedCandidateModules"] = {}
    for node in ("node20", "node22"):
        for mode in ("classic", "postmaster"):
            key = f"{node}-{mode}"
            observations = [
                json.loads(line)
                for line in (a.out / (key + "-links.jsonl")).read_text().splitlines()
            ]
            actual = {
                event["hash"]
                for event in observations
                if (event["threadId"] == 0) == (mode == "classic")
            }
            assert actual == expected_hashes, key
            evidence["verifiedCandidateModules"][key] = sorted(actual)
    groups = {}
    stages = ("control", "candidate", "attribute")
    plans = {}
    all_runs = []
    for stage in stages:
        configs = (
            ENGINES if stage != "attribute" else [(key, "postmaster") for key in RULES]
        )
        for engine, mode in configs:
            group = []
            for round_number in range(4):
                path = (
                    a.out / "attribution" / f"{round_number}-{engine}.json"
                    if stage == "attribute"
                    else a.out / "runs" / stage / f"{round_number}-{engine}-{mode}.json"
                )
                run = read(path)
                assert (run["stage"], run["engine"], run["mode"], run["round"]) == (
                    stage,
                    engine,
                    mode,
                    round_number,
                ), path
                for key, plan in run["plans"].items():
                    assert plans.setdefault(key, plan) == plan, (path, key)
                expected = set(LATENCIES) - {"hnsw_build"}
                if stage == "attribute":
                    expected -= {"serial_aggregate", "parallel_aggregate"}
                if mode == "classic":
                    expected.discard("parallel_aggregate")
                assert set(run["plans"]) == expected, path
                assert set(run["latency"]) == expected | {"hnsw_build"}, path
                assert run["node"] == evidence.setdefault("node", run["node"]), path
                assert run["settings"] == evidence.setdefault(
                    "settings", run["settings"]
                ), path
                assert run["storage"] == {
                    "inline_payload": 0,
                    "external_payload": 2048,
                }, path
                checks = {
                    k: v
                    for k, v in run["checks"].items()
                    if not k.startswith("hnswHits")
                }
                assert checks == evidence.setdefault("resultChecks", checks), path
                sessions = ["1", "2", "4", "8"] if mode == "postmaster" else ["1"]
                assert list(run["memory"]) == sessions, path
                if mode == "postmaster":
                    for n in sessions:
                        assert (
                            run["memory"][n]["privateHeaps"]
                            - run["memory"]["1"]["privateHeaps"]
                            == int(n) - 1
                        ), path
                for query in (
                    ["hnsw_search"]
                    if stage == "attribute"
                    else ["point", "hnsw_search"]
                ):
                    assert list(run["throughput"][query]) == (
                        ["1"] if stage == "attribute" else sessions
                    ), path
                for k, v in run["checks"].items():
                    if k.startswith("hnswHits"):
                        assert 160 < v <= 320, path
                group.append(run)
                all_runs.append(
                    {
                        k: v
                        for k, v in run.items()
                        if k not in ("settings", "plans", "node")
                    }
                )
            groups[stage, engine, mode] = group
    evidence.update(plans=plans, runs=all_runs)
    (a.dest / "measurements.json").write_text(json.dumps(evidence, indent=1) + "\n")

    sections = [
        "# Four-way benchmark measurements",
        "Each cell is the median of four fresh processes. Latency and startup are milliseconds, throughput is queries/s, and memory is MiB. The individual process measurements, query-plan trees, input hashes and provider counts are in [measurements.json](measurements.json).",
    ]
    for stage in stages[:2]:
        stage_groups = [groups[(stage, *key)] for key in ENGINES]

        def row(label, path, scale=1):
            return [label] + [display(metric(g, path, scale)) for g in stage_groups]

        rows = [row("Startup through first SELECT", ["startupMs"])]
        rows += [row(label, ["latency", key]) for key, label in LATENCIES.items()]
        rows += [
            row(f"{query} queries/s, {n} session(s)", ["throughput", key, str(n)])
            for query, key in [("Point", "point"), ("HNSW", "hnsw_search")]
            for n in [1, 2, 4, 8]
        ]
        for n in ["1", "2", "4", "8"]:
            for label, key in [
                ("Process RSS", "rss"),
                ("Private linear heaps", "privateBytes"),
                ("Global heap", "globalBytes"),
                ("Scoped heaps", "scopedBytes"),
            ]:
                rows.append(row(f"{label}, {n} session(s)", ["memory", n, key], MIB))
        rows.append(
            ["Additional RSS per session, 1 to 8"]
            + [
                display(
                    median(
                        (r["memory"]["8"]["rss"] - r["memory"]["1"]["rss"]) / 7 / MIB
                        for r in g
                    )
                )
                if "8" in g[0]["memory"]
                else "—"
                for g in stage_groups
            ]
        )
        sections.extend(
            [
                "## "
                + (
                    "Qualified compiler"
                    if stage == "control"
                    else "Experimental compiler"
                ),
                table(["Workload", *LABELS], rows),
            ]
        )
    attr = [groups["attribute", key, "postmaster"] for key in RULES]
    sections.extend(
        [
            "## Linked postmaster rule attribution",
            "All four variants use the expanded providers. Cells show median [minimum, maximum] milliseconds across four fresh processes. The two rules vary independently.",
            table(
                [
                    "Workload",
                    "Neither rule",
                    "Paired reads",
                    "Constant offsets",
                    "Both rules",
                ],
                [
                    [label]
                    + [
                        display(median(nums))
                        + " ["
                        + display(min(nums))
                        + ", "
                        + display(max(nums))
                        + "]"
                        for nums in (samples(g, ["latency", key]) for g in attr)
                    ]
                    for key, label in LATENCIES.items()
                    if key not in ("parallel_aggregate", "serial_aggregate")
                ],
            ),
        ]
    )
    rows = []
    for label, packages in evidence["packages"].items():
        for name, pkg in packages.items():
            rows.append([label + " " + name, display(pkg["bytes"] / MIB)])
            rows.extend(
                [filename, display(f["bytes"] / MIB)]
                for filename, f in pkg["files"].items()
                if filename.endswith(".tar.gz")
            )
    sections.extend(
        [
            "## Compressed distribution sizes",
            table(["Package or contained archive", "MiB"], rows),
        ]
    )
    (a.dest / "tables.md").write_text("\n\n".join(sections) + "\n")


if __name__ == "__main__":
    main()
