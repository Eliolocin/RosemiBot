---
title: "Production Tuning and Operations"
sidebar:
  hidden: true
---

Detailed operational rationale, container sizing, and incident tuning for Tier 7 configuration
variables. These settings govern dedicated 24/7 production hosts, virtual private servers (VPS),
and cloud provider environments (such as Azure VM and AWS EC2).

## Container Sizing and Swap Dynamics

Production Compose files (such as `deploy/azure/docker-compose.yml`) apply strict cgroup resource
constraints to prevent out-of-memory kernel kills.

### Memory and Swap Bounds

- `TOMORIBOT_MEMORY_LIMIT_MB`: Hard memory limit assigned to the bot container cgroup.
- `TOMORIBOT_MEMORY_SWAP_LIMIT_MB`: Combined memory plus swap ceiling.

If swap limit is omitted, Docker assigns double the memory limit by default. On a host backed by
compressed swap devices (e.g. zram) or swapfiles, an unrestricted allowance can saturate system swap
and prevent the cgroup from swapping further. Size `TOMORIBOT_MEMORY_SWAP_LIMIT_MB` above the host
swap device capacity so unevicted memory overflows safely to disk.

### SearXNG Python Worker Footprint

`SEARXNG_BLOCKING_THREADS` controls concurrent upstream engine queries in the SearXNG container.

SearXNG uses a Python worker architecture where deallocated objects return to internal arenas
instead of the host operating system. Peak concurrency establishes a resident memory floor that
persists for the entire life of the container. On swap-backed hosts, this memory stays occupied in
swap. Furthermore, RSS-based respawn guards fail to detect this degradation because swapped-out
workers report an artificially low RSS. Keeping `SEARXNG_BLOCKING_THREADS=1` caps worker resident
memory on constrained hosts.

## In-Process Memory Guard

The bot runs an internal memory monitor to safeguard against memory exhaustion before the container
cgroup kills the process.

- `CONTAINER_MEMORY_LIMIT_MB`: The explicit memory ceiling against which internal warning and
  critical percentage thresholds are calculated. On Azure, this is injected from
  `TOMORIBOT_MEMORY_LIMIT_MB`. In custom deployments, set this manually to match the container
  allocation.
- `MEMORY_WARNING_THRESHOLD` (default: 0.75): Triggers proactive memory logging.
- `MEMORY_CRITICAL_THRESHOLD` (default: 0.85): Enters emergency cooling mode, suspending heavy
  media tasks and initiating cache purging.
- `EMERGENCY_CACHE_CLEAR_INCLUDE_STM` (default: false): Short-term memory (STM) is preserved
  during emergency clearing to avoid user-visible conversation amnesia. Enable only if heap
  exhaustion persists despite volatile Discord cache eviction.
- `EMERGENCY_CACHE_CLEAR_DISCORD_VOLATILE` (default: true): Evicts ephemeral Discord.js client
  caches (messages, user references, presence, and voice states).

## Native Image Processing (libvips / sharp)

Image manipulation uses libvips via the `sharp` library.

- `SHARP_CONCURRENCY`: Number of concurrent image processing pipelines.
- `SHARP_CACHE_MEMORY_MB`, `SHARP_CACHE_ITEMS`, `SHARP_CACHE_FILES`: Operation and descriptor cache caps.

Libvips allocates native memory outside the V8/Bun JavaScript heap. This memory does not appear in
JavaScript heap counters but directly consumes container cgroup memory. Each concurrent pipeline
holds fully uncompressed bitmap buffers. On memory-constrained hosts (e.g. 512 MB to 1 GB RAM), keep
`SHARP_CONCURRENCY=1` to prevent sudden native memory spikes.

## Managed PostgreSQL Connection Pooling

Production database connections require lifecycle management to withstand cloud network gateways
and runtime quirks.

### Silent Gateway TCP Reaping

Managed database services (such as Azure Database for PostgreSQL Flexible Server on public endpoints)
silently terminate idle TCP connections at their network gateway after roughly 4 minutes without
emitting a TCP RST packet.

If a connection in the application pool is reaped silently, the next query dispatched to that socket
hangs until the application query timeout elapses (often 3 minutes), stalling user turns. Setting
`POSTGRES_IDLE_TIMEOUT_SECONDS=180` forces the application pool to retire and recycle connections
safely below the 240-second gateway threshold.

### Pool Retiral Handling and Jitter

Bun's database client can retire timed-out connections without draining active in-flight queries
(`oven-sh/bun#30646`). To handle these transient disconnections gracefully:

- `POSTGRES_TRANSIENT_RETRY_ATTEMPTS=3`: Queries wrapped in `withTransientDbRetry` are re-issued. A
  single retry was found insufficient in production because connection closures often occur in
  cascading cohorts, causing a second attempt to strike the same retirement wave. Three attempts
  provide reliable recovery.
- `POSTGRES_TRANSIENT_RETRY_DELAY_MS=100`: When a pooled cohort expires simultaneously, multiple
  in-flight requests fail within the same millisecond. A randomized jitter delay (uniform between
  0 and 100 ms) prevents a thundering herd on the newly created replacement sockets.
- `POOL_EVENT_EPISODE_QUIET_MS=60000`: Consolidates consecutive socket retiral events into a
  single incident log entry to prevent log spam.

## Host Pressure Detector (PSI and Swap-In)

The host pressure detector continuously monitors Linux Pressure Stall Information (PSI) and
swap activity to identify host-level memory and I/O starvation.

### Analytical Model and Calibration

The default thresholds were calibrated by replaying 67,967 production telemetry samples through
the replay harness (`bun run scripts/devtools/replayPressureDetector.ts <observer.log> --verbose`):

- `PRESSURE_ELEVATED_IO_FULL=15`: PSI `io full avg60` indicating moderate contention.
- `PRESSURE_CRITICAL_IO_FULL=30`: Severe contention indicating degraded host performance.
- `PRESSURE_RECOVERY_IO_FULL=5`: Lower recovery threshold creating hysteresis so boundary
  fluctuations do not flip states back and forth.
- `PRESSURE_MIN_SWAP_IN_PER_S=1`: Distinguishes active thrashing from inert swap. High total swap
  allocation with zero swap-in represents cold pages evicted long ago, which is harmless. Active
  swap-in confirms the kernel is thrashing.

### Duty Cycle Measurement

Host pressure spikes constantly cross threshold lines but rarely remain above them continuously
without brief drops. A strict continuous duration rule fails to trigger during chronic host
degradation. Instead, `PRESSURE_MIN_DUTY_CYCLE=0.95` requires the pressure condition to hold for
95% of the sliding window (`PRESSURE_ELEVATED_DWELL_MS=3600000` for 1 hour, or
`PRESSURE_CRITICAL_DWELL_MS=1800000` for 30 minutes).

`PRESSURE_STARTUP_GRACE_MS=900000` suppresses alerts during the initial 15-minute warmup phase.
`PRESSURE_DETECTOR_ARMED=false` keeps the detector in advisory monitoring mode; automated recycling
is reserved for an external host watchdog.

## Observability Sinks and Log Management

### Error Log Database Circuit Breaker

When the PostgreSQL instance itself experiences an outage or connectivity failure, every concurrent
request handler emits an error. Attempting to write each failure into the `error_logs` table creates
an insert cascade that exhausts the failing pool further.

`ERROR_DB_LOGGING_BREAKER_THRESHOLD=5` trips the circuit breaker after 5 consecutive database logging
failures. The breaker remains open for `ERROR_DB_LOGGING_BREAKER_COOLDOWN_MS=60000` (1 minute),
routing errors exclusively to stdout and the local JSON file.

### Write-Path Retention Pruning

Production deployments avoid `pg_cron` dependencies. Table maintenance (`METRIC_SAMPLE_PRUNE_INTERVAL_MS`
and `ERROR_LOG_PRUNE_INTERVAL_MS`) piggybacks onto normal metric and error write paths, throttled to
run at most once every 6 hours.

### On-Demand Heap Profiling

Heap snapshots can contain master secrets, decrypted credentials, Discord and database tokens, and private conversation data. Leave `HEAP_SNAPSHOT_DIR` unset during routine operation. An unset value registers no `SIGUSR2` handler. Azure Compose also leaves `TOMORIBOT_HEAP_SNAPSHOT_DIR` empty by default.

For an authorized diagnostic session, create a directory outside general log shipping, owned by the bot user and accessible only to that user (directory `0700`, snapshot files `0600` on POSIX; a private ACL on Windows). Azure uses `/var/lib/tomoribot/diagnostics` mounted at `/app/diagnostics`; explicitly set `TOMORIBOT_HEAP_SNAPSHOT_DIR=/app/diagnostics` and recreate the container. The handler refuses a symlink, a non-directory, or a POSIX directory with other-user access or the wrong owner. It creates files exclusively with mode `0600`. Check Windows ACLs yourself before enabling it.

Send `SIGUSR2` only during the diagnostic session. Serialization needs roughly half the live heap as additional temporary memory, so capture during moderate memory use and restart afterward. Transfer a snapshot only through protected storage. Remove it from the host and any analysis copies when diagnosis finishes, unset the directory setting, and recreate or restart the process to remove the handler. There is no automatic snapshot retention policy.

After rollout, verify the running container has an empty `HEAP_SNAPSHOT_DIR` and no startup message indicating an armed handler. Inspect the effective Compose configuration and container environment without dumping unrelated secrets. A checkout change does not establish that a running deployment is safe.

Review existing snapshots under the old log mount, log-shipping destinations, and retained backup bundles for access and retention. Old bundles containing `config.env` remain secret-bearing. Restrict access while investigating. If evidence shows unauthorized access, rotate the exposed provider, webhook, Discord, database, and master secrets as applicable, retaining protected encryption versions for recoverable backups. This procedure does not authorize production deletion or rotation by itself.

### Streaming JSON Logs

- `TOMORI_LOG_FILE`: Mirrors log records with level >= 50 (error, metric, rateLimit, fatal) to an
  append-only JSONL file for consumption by host agents (e.g. Azure Monitor Agent).
- `LOG_MAX_STRING_LENGTH` (default: unset): Optional cap for oversized string fields. Unset by
  default so prompts, memories, and stack traces remain complete. Base64 data URIs are collapsed
  directly in log redaction regardless of this setting.
