#!/usr/bin/env bash
# Nightly snapshot of the research cockpit (marketing.vanis.ai).
#
# Called at 04:00 by /usr/local/bin/owui-snapshot.sh, which owns the schedule,
# the output directory and the 14-day retention sweep. Safe to run by hand:
#
#     bash ~/mra-compose/mra-snapshot.sh
#
# Two archives, both landing beside agentchat's so pull-backups.sh brings them
# down to the laptop with no change:
#   mra-<stamp>.tar.gz          research.db — runs, events, packets, judgements
#   mra-corpus-<stamp>.tar.gz   raw fetched bodies, content-addressed
#
# mra is NOT stopped, which is the opposite of what the agentchat half does.
# The agent runs inside the mra process, so stopping it for a backup would kill
# any research run in flight, every night. `VACUUM INTO` takes a transactionally
# consistent copy of the live WAL database instead — one self-contained file,
# with no -wal sidecar that a plain tar could split away from its database.
set -euo pipefail

OUT="${1:-/var/backups/openwebui}"
STAMP="${2:-$(date +%F-%H%M)}"
mkdir -p "$OUT"

if docker ps --format '{{.Names}}' | grep -qx mra; then
  docker exec mra sh -c 'rm -rf /data/.snapshot && mkdir /data/.snapshot'
  # Bound parameter rather than a quoted literal: VACUUM INTO takes any string
  # expression, and it spares three layers of shell quoting.
  docker exec -w /app mra node -e '
    const Database = require("better-sqlite3");
    const db = new Database("/data/research.db");
    db.prepare("VACUUM INTO ?").run("/data/.snapshot/research.db");
    db.close();'
  docker run --rm -v mra_mra_data:/data:ro -v "${OUT}:/out" alpine \
    tar czf "/out/mra-${STAMP}.tar.gz" -C /data/.snapshot research.db
  docker exec mra rm -rf /data/.snapshot
elif docker volume inspect mra_mra_data >/dev/null 2>&1; then
  # Not running, so nothing is writing: a plain volume copy is consistent.
  docker run --rm -v mra_mra_data:/data:ro -v "${OUT}:/out" alpine \
    tar czf "/out/mra-${STAMP}.tar.gz" -C /data .
fi

# Write-once and content-addressed, so copying it live is consistent.
if docker volume inspect mra_corpus >/dev/null 2>&1; then
  docker run --rm -v mra_corpus:/corpus:ro -v "${OUT}:/out" alpine \
    tar czf "/out/mra-corpus-${STAMP}.tar.gz" -C /corpus .
fi

ls -lh "$OUT"/mra-*"${STAMP}".tar.gz 2>/dev/null || true
