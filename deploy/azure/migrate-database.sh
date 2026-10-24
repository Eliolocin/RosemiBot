#!/usr/bin/env bash
# Idempotent schema + migration application for an EXISTING production database.
#
# Runs on every deploy (unlike bootstrap-database.sh, which manages the runtime role
# and grants and is gated behind an explicit bootstrap request). This restores the
# pre-hardening guarantee that idempotent schema.sql + the tracked migration runner
# always apply on deploy — the runtime bot role has no DDL privilege, so this
# privileged container (migration/admin credentials) is the only path that can create
# tables or apply NNN_*.sql migrations against production.
#
# New tables it creates inherit the runtime + Grafana grants automatically via the
# ALTER DEFAULT PRIVILEGES rules that bootstrap-database.sh installs for the admin role,
# so this script deliberately does NOT touch roles or grants.
set -euo pipefail

: "${migrationSecretsB64:?migrationSecretsB64 is required}"
: "${dockerHubUsername:?dockerHubUsername is required}"
: "${dockerHubTokenB64:?dockerHubTokenB64 is required}"
: "${tomoribotImage:?tomoribotImage is required}"
allowMigrationDowntime="${allowMigrationDowntime:-false}"
supporterBillingEnabled="${supporterBillingEnabled:-false}"
if [[ "$supporterBillingEnabled" != true && "$supporterBillingEnabled" != false ]]; then
  echo "supporterBillingEnabled must be true or false." >&2
  exit 1
fi
schema_args=()
if [ "$supporterBillingEnabled" = true ]; then
  schema_args+=(--supporter-billing)
fi
if [[ "$allowMigrationDowntime" != true && "$allowMigrationDowntime" != false ]]; then
  echo "allowMigrationDowntime must be true or false." >&2
  exit 1
fi

# 1. The image must be an immutable digest reference (matches bootstrap-database.sh).
if [[ ! "$tomoribotImage" =~ @sha256:[0-9a-f]{64}$ ]]; then
  echo "TomoriBot image must be an immutable sha256 image reference." >&2
  exit 1
fi

umask 077
stage_dir=$(mktemp -d /var/lib/waagent/tomoribot-db-migrate.XXXXXX)
docker_authenticated=false
cleanup() {
  rm -rf "$stage_dir"
  if [ "$docker_authenticated" = true ]; then
    docker logout docker.io >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

command -v jq >/dev/null 2>&1 || {
  echo "jq is required; install it during VM provisioning." >&2
  exit 1
}

# 2. Stage the migration (admin) DB credentials the container mounts read-only.
printf '%s' "$migrationSecretsB64" | base64 --decode >"$stage_dir/migration-secrets.json"
printf '%s' "$dockerHubTokenB64" | base64 --decode >"$stage_dir/dockerhub-token"
chown root:1001 "$stage_dir/migration-secrets.json"
chmod 0440 "$stage_dir/migration-secrets.json"

# 3. Validate the secret shape before handing it to the container.
jq -e '
  type == "object" and
  (.POSTGRES_USER | type == "string" and length > 0) and
  (.POSTGRES_PASSWORD | type == "string" and length > 0) and
  (.POSTGRES_HOST | type == "string" and length > 0) and
  (.POSTGRES_PORT | type == "number" or type == "string") and
  (.POSTGRES_DB | type == "string" and length > 0)
' "$stage_dir/migration-secrets.json" >/dev/null

# 4. Pull the pinned image, authenticating only for the pull.
docker login --username "$dockerHubUsername" --password-stdin docker.io \
  <"$stage_dir/dockerhub-token" >/dev/null
docker_authenticated=true
rm -f "$stage_dir/dockerhub-token"
docker pull "$tomoribotImage" >/dev/null
docker logout docker.io >/dev/null
docker_authenticated=false

# A destructive migration may remove fields the old process still uses. Compose
# stop waits for exit and prevents its unless-stopped policy from restarting it.
if [ "$allowMigrationDowntime" = true ]; then
  if [ ! -f /etc/tomoribot/docker-compose.yml ]; then
    echo "Cannot stop TomoriBot: the installed Compose file is missing." >&2
    exit 1
  fi
  paused_timers=/etc/tomoribot/.migration-paused-timers
  touch "$paused_timers"
  for timer in tomoribot-watchdog.timer tomoribot-restart.timer; do
    if systemctl is-active --quiet "$timer"; then
      systemctl stop "$timer"
      if ! grep -Fxq "$timer" "$paused_timers"; then
        printf '%s\n' "$timer" >>"$paused_timers"
      fi
    fi
    service="${timer%.timer}.service"
    if systemctl is-active --quiet "$service"; then
      systemctl stop "$service"
    fi
  done
  env "TOMORIBOT_IMAGE=$tomoribotImage" \
    docker compose -f /etc/tomoribot/docker-compose.yml stop -t 30 tomoribot
  if [ -n "$(docker ps -q --filter label=com.docker.compose.service=tomoribot)" ]; then
    echo "TomoriBot is still running; refusing to migrate." >&2
    exit 1
  fi
  echo "TomoriBot stopped for migration downtime."
fi

# 5. Apply schema.sql + pending migrations via the same initializeCli the bot boot
#    path uses locally. Idempotent: existing objects are IF NOT EXISTS, applied
#    migrations are tracked in schema_migrations and skipped.
docker run --rm \
  --user 1001:1001 \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=128m,uid=1001,gid=1001 \
  -e RUN_ENV=production \
  -e SECRET_FILE=/run/secrets/tomoribot.json \
  -v "$stage_dir/migration-secrets.json:/run/secrets/tomoribot.json:ro" \
  "$tomoribotImage" bun run src/db/initializeCli.ts "${schema_args[@]}"

echo "TomoriBot database migration completed."
echo "TOMORIBOT_DATABASE_MIGRATION_SUCCEEDED"
