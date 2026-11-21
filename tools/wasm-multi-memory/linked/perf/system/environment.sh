#!/usr/bin/env bash
# Capture the benchmark inputs on the host.
set -euo pipefail
root=$1 stock=$2 out=$3 sdk=$4 classic=$5 native=$6
cpu=$(sysctl -n machdep.cpu.brand_string 2>/dev/null || lscpu | awk -F: '/Model name/{sub(/^ +/,"",$2); print $2; exit}')
docker info --format '{{json .}}' | python3 -c '
import json,sys
from subprocess import check_output
def command(*args):
    return check_output(args,text=True).strip()
data=json.load(sys.stdin)
root,stock,cpu,*images=sys.argv[1:]
def git(path, ref):
    return command("git","-C",path,"rev-parse",ref)
pg=git(root,"HEAD:postgres-pglite")
print(json.dumps(dict(parent=git(root,"HEAD"),stockParent=git(stock,"HEAD"),postgres=pg,
    extensions=command("git","-C",root+"/postgres-pglite","ls-tree",pg+":pglite/other_extensions","vector","postgis").splitlines(),
    cpu=cpu,os=data["OperatingSystem"],arch=data["Architecture"],cpus=data["NCPU"],memoryBytes=data["MemTotal"],
    images={i:command("docker","image","inspect","--format","{{.Id}}",i) for i in images}),indent=2))' "$root" "$stock" "$cpu" "$sdk" "$classic" "$native" >"$out/environment.json"
