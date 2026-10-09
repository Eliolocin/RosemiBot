#!/usr/bin/env bash
set -euo pipefail

: "${runtimeSecretsB64:?runtimeSecretsB64 is required}"
: "${vertexConfigB64:?vertexConfigB64 is required}"
: "${composeConfigB64:?composeConfigB64 is required}"
: "${dockerHubUsername:?dockerHubUsername is required}"
: "${dockerHubTokenB64:?dockerHubTokenB64 is required}"
: "${tomoribotImage:?tomoribotImage is required}"
: "${searxngImage:?searxngImage is required}"
# Optional, and doubles as the SearXNG on/off switch: the container refuses to start without a
# secret, so gating the profile on the same value makes "configured" and "running" one state
# instead of two that can disagree. Absent means the bot keeps using Brave -> DDG -> Felo.
searxngSecretB64="${searxngSecretB64:-}"

require_digest() {
  local image_ref=$1
  local label=$2

  if [[ ! "$image_ref" =~ @sha256:[0-9a-f]{64}$ ]]; then
    echo "$label must be an immutable sha256 image reference." >&2
    exit 1
  fi
}

umask 077
install -d -o root -g root -m 0700 /etc/tomoribot
stage_dir=$(mktemp -d /etc/tomoribot/.deploy.XXXXXX)
docker_authenticated=false
cleanup() {
  rm -rf "$stage_dir"
  if [ "$docker_authenticated" = true ]; then
    docker logout docker.io >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

timeout 600s cloud-init status --wait >/dev/null
command -v jq >/dev/null 2>&1 || {
  echo "jq is required; install it during VM provisioning." >&2
  exit 1
}

require_digest "$tomoribotImage" "TomoriBot image"
require_digest "$searxngImage" "SearXNG image"

printf '%s' "$runtimeSecretsB64" | base64 --decode >"$stage_dir/runtime-secrets.json"
printf '%s' "$vertexConfigB64" | base64 --decode >"$stage_dir/google-vertex-wif.json"
printf '%s' "$composeConfigB64" | base64 --decode >"$stage_dir/docker-compose.yml"
printf '%s' "$dockerHubTokenB64" | base64 --decode >"$stage_dir/dockerhub-token"

jq -e '
  type == "object" and
  (.POSTGRES_USER | type == "string" and length > 0) and
  (.POSTGRES_PASSWORD | type == "string" and length > 0) and
  (.POSTGRES_HOST | type == "string" and length > 0) and
  (.POSTGRES_PORT | type == "number" or type == "string") and
  (.POSTGRES_DB | type == "string" and length > 0)
' "$stage_dir/runtime-secrets.json" >/dev/null
jq -e 'type == "object"' "$stage_dir/google-vertex-wif.json" >/dev/null

runtime_user=$(jq -r '.POSTGRES_USER' "$stage_dir/runtime-secrets.json")
postgres_host=$(jq -r '.POSTGRES_HOST' "$stage_dir/runtime-secrets.json")
if [[ ! "$runtime_user" =~ ^[a-z_][a-z0-9_]{0,62}$ ]]; then
  echo "Runtime database role name is invalid." >&2
  exit 1
fi
case "$runtime_user" in
  tomoriadmin | azure_pg_admin | postgres)
    echo "The runtime secret bundle contains a PostgreSQL administrator identity." >&2
    exit 1
    ;;
esac

if [[ ! "$postgres_host" =~ \.postgres\.database\.azure\.com$ ]]; then
  echo "PostgreSQL host must be the Azure Flexible Server public FQDN." >&2
  exit 1
fi

install -d -o 1001 -g 1001 -m 0750 \
  /var/log/tomoribot \
  /var/lib/tomoribot/backups \
  /var/lib/tomoribot/data
install -d -o 1001 -g 1001 -m 0700 /var/lib/tomoribot/diagnostics
install -m 0640 -o root -g 1001 \
  "$stage_dir/runtime-secrets.json" /etc/tomoribot/.secrets.json.new
install -m 0640 -o root -g 1001 \
  "$stage_dir/google-vertex-wif.json" /etc/tomoribot/.google-vertex-wif.json.new
install -m 0644 -o root -g root \
  "$stage_dir/docker-compose.yml" /etc/tomoribot/.docker-compose.yml.new
mv -f /etc/tomoribot/.secrets.json.new /etc/tomoribot/secrets.json
mv -f /etc/tomoribot/.google-vertex-wif.json.new /etc/tomoribot/google-vertex-wif.json
mv -f /etc/tomoribot/.docker-compose.yml.new /etc/tomoribot/docker-compose.yml

docker login --username "$dockerHubUsername" --password-stdin docker.io \
  <"$stage_dir/dockerhub-token" >/dev/null
docker_authenticated=true
rm -f "$stage_dir/dockerhub-token"
docker pull "$tomoribotImage" >/dev/null
docker pull "$searxngImage" >/dev/null
docker logout docker.io >/dev/null
docker_authenticated=false

searxng_secret=""
compose_services=(tomoribot)
searxng_base_url=""
if [ -n "$searxngSecretB64" ]; then
  searxng_secret=$(printf '%s' "$searxngSecretB64" | base64 --decode)
  if [ ${#searxng_secret} -lt 32 ]; then
    echo "SEARXNG_SECRET must contain at least 32 characters." >&2
    exit 1
  fi
  compose_services+=(searxng)
  # Container-to-container over the compose network, so this never leaves the host.
  searxng_base_url="http://searxng:8080/"
fi

compose_env=(
  "TOMORIBOT_IMAGE=$tomoribotImage"
  "SEARXNG_IMAGE=$searxngImage"
  "SEARXNG_SECRET=$searxng_secret"
  "SEARXNG_BASE_URL=$searxng_base_url"
)

previous_container_id=$(docker ps -aq \
  --filter label=com.docker.compose.project=tomoribot-azure \
  --filter label=com.docker.compose.service=tomoribot | head -1)
previous_started_at=""
previous_restart_count=0
if [ -n "$previous_container_id" ]; then
  previous_started_at=$(docker inspect --format '{{.State.StartedAt}}' "$previous_container_id")
  previous_restart_count=$(docker inspect --format '{{.RestartCount}}' "$previous_container_id")
fi

env "${compose_env[@]}" \
  docker compose -f /etc/tomoribot/docker-compose.yml up \
    -d --pull never --remove-orphans "${compose_services[@]}" >/dev/null

container_id=$(env "${compose_env[@]}" \
  docker compose -f /etc/tomoribot/docker-compose.yml ps -q tomoribot)
if [ -z "$container_id" ]; then
  echo "TomoriBot container is missing after Compose startup." >&2
  exit 1
fi
if [ "$(docker inspect --format '{{.Image}}' "$container_id")" != \
     "$(docker image inspect --format '{{.Id}}' "$tomoribotImage")" ]; then
  echo "TomoriBot image digest check failed." >&2
  exit 1
fi
if [ "$(docker inspect --format '{{.Config.User}}' "$container_id")" != "1001:1001" ] || \
  [ "$(docker exec "$container_id" id -u)" != "1001" ] || \
  [ "$(docker exec "$container_id" id -g)" != "1001" ]; then
  echo "TomoriBot container UID/GID invariant failed." >&2
  exit 1
fi
started_at=$(docker inspect --format '{{.State.StartedAt}}' "$container_id")
restart_count=$(docker inspect --format '{{.RestartCount}}' "$container_id")
if { [ "$container_id" != "$previous_container_id" ] && [ "$restart_count" -ne 0 ]; } || \
  { [ "$container_id" = "$previous_container_id" ] && [ "$restart_count" -gt "$previous_restart_count" ]; }; then
  echo "TomoriBot restarted during initial deployment startup." >&2
  exit 1
fi
verification_since="$started_at"
if [ "$container_id" = "$previous_container_id" ] && [ "$started_at" = "$previous_started_at" ]; then
  verification_since=$(date -u +%Y-%m-%dT%H:%M:%S.%NZ)
fi

# Verify the public PostgreSQL path with the same production client and
# certificate/hostname validation used by the application. This query also
# proves the exact-address firewall rule and runtime credentials are valid.
if ! docker exec "$container_id" bun -e '
  const secrets = await Bun.file("/run/secrets/tomoribot.json").json();
  for (const key of ["POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_HOST", "POSTGRES_PORT", "POSTGRES_DB"]) {
    process.env[key] = String(secrets[key]);
  }
  process.env.RUN_ENV = "production";
  const { sql } = await import("./src/utils/db/client.ts");
  await sql`SELECT 1`;
  await sql.close();
' >"$stage_dir/db-connect.log" 2>&1; then
  echo "PostgreSQL public-FQDN TLS connectivity check failed." >&2
  exit 1
fi

for attempt in $(seq 1 20); do
  if curl -fsS http://localhost:8081/healthz >/dev/null; then
    break
  fi
  if [ "$attempt" -eq 20 ]; then
    echo "TomoriBot health check failed; inspect access-controlled Log Analytics logs." >&2
    exit 1
  fi
  sleep 30
done

# Exercise the repository queries that traverse the tables moved by migrations.
# Capture all process output locally so a repository error cannot print user data
# into the Run Command response.
if ! docker exec "$container_id" bun -e '
  const secrets = await Bun.file("/run/secrets/tomoribot.json").json();
  for (const key of ["POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_HOST", "POSTGRES_PORT", "POSTGRES_DB"]) {
    process.env[key] = String(secrets[key]);
  }
  process.env.RUN_ENV = "production";
  let check = "user_repository";
  try {
    const { sql } = await import("./src/utils/db/client.ts");
    const { userRepository } = await import("./src/utils/db/repositories/UserRepository.ts");
    const userRows = await sql`SELECT user_disc_id FROM users ORDER BY user_id LIMIT 1`;
    const user = await userRepository.loadByDiscordId(String(userRows[0]?.user_disc_id ?? "__deploy_probe_missing__"));
    if (userRows.length > 0 && !user) throw new Error("user repository returned no existing user");

    check = "custom_endpoint_repository";
    const { llmProviderRepo } = await import("./src/utils/db/repositories/LlmProviderRepository.ts");
    const serverRows = await sql`SELECT server_id FROM servers ORDER BY server_id LIMIT 1`;
    const result = await llmProviderRepo.loadCustomEndpointConnectionsForServerResult(Number(serverRows[0]?.server_id ?? -1));
    if (result.status !== "fresh") throw new Error("custom endpoint repository unavailable");
    await sql.close();
    console.log("SMOKE_OK");
  } catch {
    console.error(`SMOKE_FAILED:${check}`);
    process.exit(1);
  }
' >"$stage_dir/repository-smoke.log" 2>&1; then
  if grep -q 'SMOKE_FAILED:user_repository' "$stage_dir/repository-smoke.log"; then
    echo "UserRepository smoke check failed." >&2
  elif grep -q 'SMOKE_FAILED:custom_endpoint_repository' "$stage_dir/repository-smoke.log"; then
    echo "Custom endpoint repository smoke check failed." >&2
  else
    echo "Repository smoke process failed." >&2
  fi
  exit 1
fi
if grep -Eq '"level":(50|60)' "$stage_dir/repository-smoke.log"; then
  echo "Repository smoke emitted an error log." >&2
  exit 1
fi

# A healthy HTTP listener can coexist with a failed gateway or repository read.
# Use Docker's exact start timestamp for a newly started container. When Compose
# reuses a running container, inspect errors from this deploy's verification time.
verification_epoch=$(date -u -d "$verification_since" +%s)
remaining=$((45 - ($(date -u +%s) - verification_epoch)))
if [ "$remaining" -gt 0 ]; then sleep "$remaining"; fi
if [ "$(docker inspect --format '{{.State.Running}}' "$container_id")" != true ] || \
  [ "$(docker inspect --format '{{.State.StartedAt}}' "$container_id")" != "$started_at" ] || \
  [ "$(docker inspect --format '{{.RestartCount}}' "$container_id")" != "$restart_count" ] || \
  ! curl -fsS http://localhost:8081/healthz >/dev/null; then
  echo "TomoriBot restarted or lost health during deployment verification." >&2
  exit 1
fi

if ! error_count=$(docker exec "$container_id" bun -e '
  const secrets = await Bun.file("/run/secrets/tomoribot.json").json();
  for (const key of ["POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_HOST", "POSTGRES_PORT", "POSTGRES_DB"]) {
    process.env[key] = String(secrets[key]);
  }
  process.env.RUN_ENV = "production";
  const { sql } = await import("./src/utils/db/client.ts");
  const startedAt = process.argv[1];
  const rows = await sql`
    SELECT COUNT(*)::int AS error_count FROM error_logs
    WHERE created_at >= (${startedAt}::timestamptz AT TIME ZONE current_setting(${"TimeZone"}))
  `;
  console.log(rows[0].error_count);
  await sql.close();
' "$verification_since" 2>"$stage_dir/error-count.log"); then
  echo "Post-start error log query failed." >&2
  exit 1
fi
if [[ ! "$error_count" =~ ^[0-9]+$ ]]; then
  echo "Post-start error log check returned an invalid count." >&2
  exit 1
fi
if [ "$error_count" -gt 0 ]; then
  echo "Post-start error log check failed: $error_count error(s)." >&2
  exit 1
fi

if ! docker logs --since "$verification_since" "$container_id" >"$stage_dir/container-logs.jsonl" 2>&1; then
  echo "New container log check failed." >&2
  exit 1
fi
container_errors=$(jq -R -s '[split("\n")[] | fromjson? | objects | select(.level == 50 or .level == 60)] | length' "$stage_dir/container-logs.jsonl")
if [ "$container_errors" -gt 0 ]; then
  echo "New container emitted $container_errors error log(s)." >&2
  exit 1
fi
echo "TomoriBot verification passed: repositories, startup errors, and health."

assert_file() {
  local path=$1
  local expected_mode=$2
  local expected_owner=$3
  local expected_group=$4
  local actual

  actual=$(stat -c '%a:%u:%g' "$path")
  if [ "$actual" != "$expected_mode:$expected_owner:$expected_group" ]; then
    echo "Unexpected ownership or mode for $path: $actual" >&2
    exit 1
  fi
}

assert_file /etc/tomoribot/secrets.json 640 0 1001
assert_file /etc/tomoribot/google-vertex-wif.json 640 0 1001
assert_file /etc/tomoribot/docker-compose.yml 644 0 0

paused_timers=/etc/tomoribot/.migration-paused-timers
if [ -f "$paused_timers" ]; then
  while IFS= read -r timer; do
    case "$timer" in
      tomoribot-watchdog.timer | tomoribot-restart.timer)
        systemctl start "$timer"
        ;;
      *)
        echo "Unexpected paused timer: $timer" >&2
        exit 1
        ;;
    esac
  done <"$paused_timers"
  rm -f "$paused_timers"
fi

# After the health check so a failed deploy keeps the prior image for rollback. Never fatal: the
# deploy has already succeeded here, so reclaiming disk must not fail it.
docker image prune -f >/dev/null 2>&1 || echo "Image prune skipped; disk reclaim deferred." >&2

echo "TomoriBot deployment succeeded through Azure Run Command."
echo "TOMORIBOT_DEPLOYMENT_SUCCEEDED"
