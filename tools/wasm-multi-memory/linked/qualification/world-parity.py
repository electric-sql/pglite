"""Compare the complete event lists produced by two PostgreSQL check-world runs."""

import hashlib
import json
import sys
from collections import Counter
from pathlib import Path


def read(path):
    return json.loads(path.read_text())


def result(directory, abi):
    summary = read(directory / "results/check-world.json")
    assert summary["target"] == "check-world" and summary["status"] == "pass"
    assert summary["upstreamExitStatus"] == 0
    assert summary["clusters"]["passed"] > 0 and summary["clusters"]["failed"] == 0
    assert (directory / "world-abi.txt").read_text().strip() == abi
    counts = Counter()
    event_dir = directory / "results/raw-check-world/capabilities/events"
    for path in event_dir.glob("*.json"):
        event = read(path)
        assert event["target"] == "check-world"
        assert event["postgresRevision"] == summary["postgresRevision"]
        counts[event["kind"], event["path"], event["state"], event["outcome"]] += 1
    assert counts and sum(counts.values()) == summary["testPolicy"]["eventCount"]
    inputs = {}
    for line in (directory / "world-inputs.sha256").read_text().splitlines():
        digest, name = line.split()
        inputs[name] = digest
    return counts, {
        "postgres": summary["postgresRevision"],
        "inputs": inputs,
        "events": summary["testPolicy"]["eventCounts"],
        "clusters": summary["clusters"],
        "upstreamExitStatus": summary["upstreamExitStatus"],
        "jobs": summary["jobs"],
        "maxConnections": summary["maxConnections"],
    }


def compare(native, linked):
    expected, reference = result(native, "pglite.multi-memory.abi")
    actual, candidate = result(linked, "pglite.linked-memory.abi")
    for key in ("postgres", "jobs", "maxConnections"):
        assert reference[key] == candidate[key], key
    policy = "postgres-test-capabilities.json"
    assert reference["inputs"][policy] == candidate["inputs"][policy]
    if expected != actual:
        raise ValueError(
            f"Missing or different linked events: {expected - actual}\n"
            f"Extra linked events: {actual - expected}"
        )
    events = [(*event, count) for event, count in sorted(actual.items())]
    return {
        "matchedEvents": sum(actual.values()),
        "eventListSha256": hashlib.sha256(json.dumps(events).encode()).hexdigest(),
        "native": reference,
        "linked": candidate,
    }


if __name__ == "__main__":
    print(json.dumps(compare(Path(sys.argv[1]), Path(sys.argv[2])), indent=2))
