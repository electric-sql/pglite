"""Compare installed release packages with the native reference."""
import json
import sys
from pathlib import Path
from statistics import median

from summarize import ENGINES, LABELS, LATENCIES, MIB, display, metric, read, table

def main(directory):
    groups = []
    evidence = {"packages": {}, "plans": {}, "runs": []}
    for engine, mode in ENGINES:
        group = []
        for iteration in range(4):
            run = read(directory / "runs/release" / f"{iteration}-{engine}-{mode}.json")
            assert (run["engine"], run["mode"], run["stage"], run["round"]) == (engine, mode, "release", iteration)
            for key, plan in run["plans"].items():
                assert evidence["plans"].setdefault(key, plan) == plan, key
            assert run["settings"] == evidence.setdefault("settings", run["settings"])
            assert run["node"] == evidence.setdefault("node", run["node"])
            assert run["storage"] == {"inline_payload": 0, "external_payload": 2048}
            checks = {k:v for k,v in run["checks"].items() if not k.startswith("hnswHits")}
            assert checks == evidence.setdefault("checks", checks)
            expected = set(LATENCIES)
            if mode == "classic":
                expected.remove("parallel_aggregate")
            assert set(run["latency"]) == expected
            counts = ["1","2","4","8"] if mode == "postmaster" else ["1"]
            assert list(run["memory"]) == counts
            for n in counts:
                assert 160 < run["checks"]["hnswHits"+n] <= 320
                for query in ["point", "hnsw_search"]:
                    assert run["throughput"][query][n] > 0
                if mode == "postmaster":
                    assert run["memory"][n]["privateHeaps"]-run["memory"]["1"]["privateHeaps"] == int(n)-1
            evidence["runs"].append({k:v for k,v in run.items() if k not in ("plans","settings","node")})
            group.append(run)
        groups.append(group)
        evidence["packages"][engine]=(directory / f"{engine}-packages.sha256").read_text().splitlines()
    evidence["parallelLeader"] = {e:read(directory/f"parallel-leader-{e}.json") for e in ["stock","linked"]}
    assert evidence["parallelLeader"]["linked"]["loaded"] == {"workers":2}
    evidence["startupTraces"] = {}
    for engine, mode in ENGINES:
        events = [json.loads(line) for line in (directory / f"startup-{engine}-{mode}.jsonl").read_text().splitlines()]
        first = next(event for event in events if event["op"] == "first query complete")
        cutoff = first["start"] + first["ms"]
        stages = {}
        for event in events:
            if event["start"]+event["ms"] > cutoff: continue
            op = event["op"]
            if op in ("cluster ready","classic initialization","first connection","worker online","worker runtime ready"):
                stages.setdefault(op,[]).append(round(event["ms"],3))
                if op == "cluster ready": stages["extension preparation"]=[round(event["detail"],3)]
        worker_ids = {event["threadId"] for event in events if event["threadId"] and event["start"] < cutoff}
        stages["worker wasm instantiation"] = [round(sum(event["ms"] for event in events
            if event["threadId"] == worker and event["op"] in ("Instance","instantiate") and event["start"]+event["ms"] <= cutoff),3)
            for worker in sorted(worker_ids)]
        evidence["startupTraces"][f"{engine}-{mode}"] = stages
    rows = []
    def row(label, keys, scale=1):
        values = [metric(group, keys, scale) for group in groups]
        ratio = values[3] / values[2] if values[2] else None
        rows.append([label, *map(display, values), f"{ratio:.2f}×" if ratio else "—"])
    row("Cold startup through SELECT 1, ms", ["startupMs"])
    row("First CREATE EXTENSION vector and postgis, ms", ["createExtensionsMs"])
    for key,label in LATENCIES.items():
        row(label+", ms", ["latency",key])
    for n in ["1","2","4","8"]:
        for key in ["point","hnsw_search"]:
            row(f"{key}, {n} session(s), queries/s", ["throughput",key,n])
        for key in ["rss","privateBytes","globalBytes","scopedBytes"]:
            row(f"{key}, {n} session(s), MiB",["memory",n,key],MIB)
    row("RSS before CREATE EXTENSION, MiB", ["beforeExtensionMemory","rss"], MIB)
    row("Peak process RSS, MiB", ["peakRss"], MIB)
    for label, fn in [
        ("Additional RSS per session from 1 to 8, MiB",lambda r:(r["memory"]["8"]["rss"]-r["memory"]["1"]["rss"])/7/MIB),
        ("Additional session through first SELECT, ms", lambda r:median(r["sessionSetupMs"])),
    ]:
        vals=[median(fn(r) for r in g) if g[0]["mode"]=="postmaster" else None for g in groups]
        rows.append([label,*map(display,vals),f"{vals[3]/vals[2]:.2f}×"])
    (directory/"release-measurements.json").write_text(json.dumps(evidence, indent=1)+"\n")
    (directory/"release-tables.md").write_text(
        "# Installed wasm32 package comparison\n\nFour fresh processes per cell. The ratio divides linked postmaster by native postmaster. "
        "Lower latency and higher throughput are better. Memory is measured after extension installation unless indicated.\n\n"+
        table(["Workload",*LABELS,"Postmaster ratio"], rows)+"\n"
    )

if __name__ == "__main__":
    main(Path(sys.argv[1]))
