#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
# Force the host's local daemon; never inherit a remote Docker context/host.
docker(){ command docker --host unix:///var/run/docker.sock "$@"; }
# Fully disposable synthetic services. Both images pinned by verified publisher digest.
PG_IMAGE='postgres:17.11@sha256:b8faeff7712663c2773a190181e1246e37e364b887611c04658c28b44e2408fe'
REST_IMAGE='postgrest/postgrest:v16.5@sha256:1347d7552b88f17832912c06afbf7c43209af6eeeb60834b04aae12c9bd9d5cc'
SUFFIX="${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"
NET="inkscan-qa-$SUFFIX"; PG="inkscan-pg-$SUFFIX"; REST="inkscan-rest-$SUFFIX"
cleanup(){ docker rm -f "$REST" "$PG" >/dev/null 2>&1 || true; docker network rm "$NET" >/dev/null 2>&1 || true; }
trap cleanup EXIT
# Download only official public images; test containers have no external network.
docker pull "$PG_IMAGE"
docker pull "$REST_IMAGE"
docker network create --internal --label "inkscan.qa.disposable=$SUFFIX" "$NET"
docker run --rm -d --name "$PG" --network "$NET" -e POSTGRES_PASSWORD=synthetic-ci-only "$PG_IMAGE"
ready=false
for i in {1..40}; do if docker exec "$PG" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then ready=true; break; fi; sleep 1; done
$ready || { docker logs "$PG"; exit 1; }
docker exec -i "$PG" psql -U postgres -v ON_ERROR_STOP=1 < setup.sql
docker run --rm -d --name "$REST" --network "$NET" --read-only --cap-drop ALL --security-opt no-new-privileges \
 --label "inkscan.qa.disposable=$SUFFIX" \
 -e PGRST_DB_URI="postgres://qa_authenticator:synthetic-local-only@$PG:5432/postgres" \
 -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=qa_anon \
 -e PGRST_JWT_SECRET=inkscan-synthetic-ci-jwt-secret-not-for-production "$REST_IMAGE"
# Publishing a host port is unnecessary: the host can reach an internal bridge's
# container IP. Validate Docker identity/isolation before making any HTTP request.
BASE="$(node get-local-endpoint.cjs)"
ready=false
for i in {1..40}; do if curl --noproxy '*' --proto '=http' --silent --show-error --max-time 2 "$BASE/" >/dev/null; then ready=true; break; fi; sleep 1; done
$ready || { docker logs "$REST"; curl --noproxy '*' --proto '=http' --verbose --max-time 3 "$BASE/" || true; exit 1; }
node verify.cjs
