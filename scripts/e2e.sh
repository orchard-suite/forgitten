#!/bin/bash
# Proves the CLI and the hub speak the same contract: publishes the real CLI,
# starts a real hub and a stand-in for Entra, and walks a device through
# join, report, removal, rejoin, and leave.
set -euo pipefail

cd "$(dirname "$0")/.."
WORK=$(mktemp -d)
ENTRA_PORT=${ENTRA_PORT:-18099} SESSION_PORT=${SESSION_PORT:-18080} DEVICE_PORT=${DEVICE_PORT:-18081}
TENANT=11111111-1111-1111-1111-111111111111
CLIENT=22222222-2222-2222-2222-222222222222
AUTHORITY=http://127.0.0.1:$ENTRA_PORT
PIDS=()

cleanup() {
    for pid in ${PIDS[@]+"${PIDS[@]}"}; do kill "$pid" 2>/dev/null || true; done
    wait 2>/dev/null || true
    rm -rf "$WORK"
}
trap cleanup EXIT

fail() { echo "FAIL: $1" >&2; echo "--- hub log" >&2; cat "$WORK/hub.log" >&2; exit 1; }
expect() { [[ "$2" == *"$3"* ]] || fail "$1: expected '$3' in: $2"; }
fleet() { curl -fsS "http://127.0.0.1:$SESSION_PORT/api/fleet" | node -e "const f=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log($1)"; }

case "$(uname -s)-$(uname -m)" in
    Darwin-arm64) RID=osx-arm64 ;;
    Darwin-x86_64) RID=osx-x64 ;;
    Linux-aarch64) RID=linux-arm64 ;;
    *) RID=linux-x64 ;;
esac
dotnet publish cli/Forgitten/Forgitten.csproj -c Release -r "$RID" --self-contained true -p:PublishSingleFile=true -o "$WORK/bin" >/dev/null
CLI="$WORK/bin/forgitten"

# Something to find: one clean clone and one with a change nobody committed.
export GIT_CONFIG_GLOBAL=/dev/null GIT_AUTHOR_NAME=Test GIT_AUTHOR_EMAIL=user@example.com GIT_COMMITTER_NAME=Test GIT_COMMITTER_EMAIL=user@example.com
git init -q --bare "$WORK/remote.git"
for name in clean dirty; do
    git clone -q "$WORK/remote.git" "$WORK/src/$name" 2>/dev/null
done
(cd "$WORK/src/clean" && git checkout -q -b main && echo hello > README.md && git add . && git commit -q -m first && git push -q -u origin main)
(cd "$WORK/src/dirty" && git pull -q origin main && git checkout -q main 2>/dev/null; echo wip > wip.txt)

# Something already listening would answer in place of this hub and fail the run for the wrong reason.
for port in $ENTRA_PORT $SESSION_PORT $DEVICE_PORT; do
    if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
        echo "FAIL: port $port is in use. Set ENTRA_PORT, SESSION_PORT, and DEVICE_PORT to free ports." >&2
        exit 1
    fi
done

FAKE_ENTRA_PORT=$ENTRA_PORT node scripts/fake-entra.ts >"$WORK/entra.log" 2>&1 &
PIDS+=($!)
AUTH_MODE=none PORT=$SESSION_PORT INGEST_PORT=$DEVICE_PORT DATA_DIR="$WORK/data" \
    ENTRA_AUTHORITY=$AUTHORITY ENTRA_TENANT_ID=$TENANT ENTRA_CLIENT_ID=$CLIENT \
    node --no-warnings=ExperimentalWarning src/server/main.ts >"$WORK/hub.log" 2>&1 &
PIDS+=($!)
up=
for _ in $(seq 100); do
    curl -fsS "http://127.0.0.1:$DEVICE_PORT/healthz" >/dev/null 2>&1 && curl -fsS "http://127.0.0.1:$SESSION_PORT/healthz" >/dev/null 2>&1 && up=1 && break
    sleep 0.1
done
[[ -n "$up" ]] || fail "the hub did not come up"
for pid in "${PIDS[@]}"; do kill -0 "$pid" 2>/dev/null || fail "the hub or the Entra stand-in exited at start"; done

export FORGITTEN_CONFIG_DIR="$WORK/config"
JOIN=("$CLI" fleet join "http://127.0.0.1:$DEVICE_PORT" --authority "$AUTHORITY" --tenant "$TENANT" --client "$CLIENT" --no-agent)

out=$("${JOIN[@]}" --path "$WORK/src" --name "e2e box" 2>&1) || fail "join: $out"
expect "join" "$out" 'Joined'
expect "join reports at once" "$out" 'reported 2 repos'
expect "device shown" "$(fleet 'f.devices.map(d => [d.name, d.level, d.counts.red, d.counts.green].join(" ")).join()')" 'e2e box red 1 1'
expect "the dirty repo is the red one" "$(fleet 'f.devices[0].repos.filter(r => r.level === "red").map(r => r.signals[0].text).join()')" '1 uncommitted file on main'

out=$("$CLI" fleet report 2>&1) || fail "report with a refreshed sign-in: $out"
expect "report" "$out" 'reported 2 repos'
[[ "$(stat -c %a "$WORK/config/credentials.json" 2>/dev/null || stat -f %Lp "$WORK/config/credentials.json")" == 600 ]] || fail "the stored sign-in is readable by others"

mkdir -p "$WORK/more" && git init -q "$WORK/more/extra" && echo wip > "$WORK/more/extra/wip.txt"
out=$("$CLI" fleet paths add "$WORK/more" 2>&1) || fail "paths add: $out"
expect "paths add reports at once" "$out" 'reported 3 repos'
expect "paths list" "$("$CLI" fleet paths list)" "$WORK/more"
out=$("$CLI" fleet paths remove "$WORK/more" 2>&1) || fail "paths remove: $out"
expect "paths remove reports at once" "$out" 'reported 2 repos'
out=$("$CLI" fleet paths remove "$WORK/src" 2>&1) && fail "removing the last directory was allowed"
expect "last directory stays" "$out" 'At least one directory must stay'

code=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "http://127.0.0.1:$DEVICE_PORT/ingest/v1/devices/x/report" -H 'content-type: application/json' -d '{}')
[[ "$code" == 401 ]] || fail "a report without a token got $code"

id=$(fleet 'f.devices[0].id')
curl -fsS -X DELETE "http://127.0.0.1:$SESSION_PORT/api/devices/$id" >/dev/null
out=$("$CLI" fleet report 2>&1) && fail "a removed device still reported"
expect "removed device is told so" "$out" 'no longer in the fleet'

out=$("${JOIN[@]}" 2>&1) || fail "rejoin: $out"
expect "rejoin keeps its directories" "$out" 'reported 2 repos'
expect "rejoined under a new id" "$(fleet 'f.devices.length')" '1'

out=$("$CLI" fleet leave 2>&1) || fail "leave: $out"
expect "left" "$(fleet 'f.devices.length')" '0'
[[ ! -e "$WORK/config/fleet.json" && ! -e "$WORK/config/credentials.json" ]] || fail "leave left the sign-in on disk"

echo "e2e passed"
