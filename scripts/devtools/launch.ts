#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";
import pc from "picocolors";
import { resolvePythonExe } from "../lib/pyenv";
import { DEFAULT_PYTHON_HEALTH_TIMEOUT_MS, resolvePositiveTimeoutMs } from "../lib/launchReadiness";

config();

// scripts/devtools/launch.ts
//
//   bun run launch [--searxng] [--crawl4ai] [--qwen3tts] [--chatterbox] [--irodoritts] [--voxcpm2] [--fishs2] [--cosyvoice3] [--moss]
//
//   Starts requested local servers, waits for them to be ready, then
//   launches the bot in watch mode (equivalent to `bun run dev`).
//
//   Docker-backed servers are started via docker inspect/start/run and polled until
//   their healthcheck reports "healthy". Python servers are spawned directly
//   from their pre-built venv and polled through their JSON health endpoint.
//
//   Press Ctrl+C to stop everything.

const ROOT = process.cwd();

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")).map((a) => a.slice(2)));

if (flags.has("help") || flags.has("h")) {
  console.log(`
${pc.bold("bun run launch")} — start local servers + TomoriBot in watch mode

${pc.bold("Usage:")}
  bun run launch [options]

${pc.bold("Options:")}
  --searxng     Start the SearXNG metasearch Docker container (port 8080 by default)
  --crawl4ai    Start the Crawl4AI browser-render Docker container (port 11235 by default)
  --qwen3tts    Start the Qwen3-TTS Python server (requires venv setup)
  --chatterbox  Start the Chatterbox TTS Python server (requires venv setup)
  --irodoritts  Start the IrodoriTTS Python server (requires venv setup)
  --voxcpm2     Start the VoxCPM2 Python server (requires venv setup)
  --fishs2      Start the Fish Audio S2 Pro Python server (requires venv + model setup)
  --cosyvoice3  Start the CosyVoice 3 Python server (requires venv setup)
  --moss        Start the MOSS-TTS Python server (requires venv setup and prefetch)
  --whisperx    Start the WhisperX transcription Python server (requires venv setup)
  --help        Show this message

${pc.bold("Examples:")}
  bun run launch
  bun run launch --searxng --crawl4ai
  bun run launch --qwen3tts --searxng
  bun run launch --voxcpm2
  bun run launch --fishs2
  bun run launch --cosyvoice3
`);
  process.exit(0);
}

interface DockerLocalServer {
  kind: "docker";
  /** docker container name */
  containerName: string;
  /** image used when creating a container */
  image: string;
  /** args passed after "docker run" when creating a fresh container */
  runArgs: string[];
  /**
   * Environment for the `docker run` process. Secrets go here and runArgs names them with a bare
   * `-e NAME`, because argv is readable by every local user through the process list.
   */
  runEnv?: Record<string, string>;
  /** milliseconds to wait for healthcheck before aborting (default 120s) */
  healthTimeoutMs?: number;
  /**
   * HTTP URL to probe as a fallback when the container has no Docker healthcheck
   * (e.g. an existing container created before --health-cmd was added to runArgs).
   * Polled every 2s; a 2xx response is treated as healthy.
   */
  httpHealthUrl?: string;
}

interface PythonLocalServer {
  kind: "python";
  displayName: string;
  /** path to the .venv directory, relative to ROOT */
  venvRelPath: string;
  /** path to the server script, relative to ROOT */
  scriptRelPath: string;
  /** extra args passed to the script */
  scriptArgs?: string[];
  /** JSON health endpoint used to distinguish loading from ready. */
  healthUrl: string;
  /** Status values that mean the server can accept requests. */
  readyStatuses?: readonly string[];
}

type LocalServerDef = DockerLocalServer | PythonLocalServer;

// Pinned so its egress policy and token requirement match the self-hosting guide.
const CRAWL4AI_IMAGE = "unclecode/crawl4ai:0.9.4";

/** Registry of all supported --flag → local server definitions. */
const LOCAL_SERVERS: Record<string, LocalServerDef> = {
  searxng: {
    kind: "docker",
    containerName: "searxng",
    image: "tomoribot-searxng:latest",
    httpHealthUrl: "http://localhost:8080/healthz",
    runArgs: [
      "-d",
      "--name",
      "searxng",
      "-p",
      "8080:8080",
      "--tmpfs",
      "/etc/searxng",
      "-e",
      "SEARXNG_SECRET",
      "--health-cmd",
      "wget -q --spider http://localhost:8080/healthz || exit 1",
      "--health-interval",
      "10s",
      "--health-timeout",
      "3s",
      "--health-retries",
      "5",
      "--health-start-period",
      "15s",
      "tomoribot-searxng:latest",
    ],
  },

  crawl4ai: {
    kind: "docker",
    containerName: "crawl4ai",
    image: CRAWL4AI_IMAGE,
    runEnv: process.env.CRAWL4AI_TOKEN ? { CRAWL4AI_API_TOKEN: process.env.CRAWL4AI_TOKEN } : undefined,
    // Crawl4AI has a longer first-run startup (model download), give it 3 min.
    healthTimeoutMs: 180_000,
    httpHealthUrl: "http://localhost:11235/health",
    runArgs: [
      "-d",
      "--name",
      "crawl4ai",
      "-p",
      "127.0.0.1:11235:11235",
      "--shm-size=3g",
      ...(process.env.CRAWL4AI_TOKEN ? ["-e", "CRAWL4AI_API_TOKEN"] : []),
      "--health-cmd",
      "python -c \"import urllib.request; urllib.request.urlopen('http://localhost:11235/health', timeout=3).read()\"",
      "--health-interval",
      "10s",
      "--health-timeout",
      "5s",
      "--health-retries",
      "12",
      "--health-start-period",
      "45s",
      CRAWL4AI_IMAGE,
    ],
  },

  qwen3tts: {
    kind: "python",
    displayName: "Qwen3-TTS",
    venvRelPath: "servers/tts/qwen3tts/.venv",
    scriptRelPath: "servers/tts/qwen3tts/server.py",
    healthUrl: `http://127.0.0.1:${process.env.QWEN3TTS_PORT ?? (process.env.TOMORI_TTS_MODE === "voice-design" ? "8014" : "8012")}/health`,
    readyStatuses: ["ok", "idle"],
  },

  chatterbox: {
    kind: "python",
    displayName: "Chatterbox TTS",
    venvRelPath: "servers/tts/chatterbox/.venv",
    scriptRelPath: "servers/tts/chatterbox/server.py",
    healthUrl: `http://127.0.0.1:${process.env.CHATTERBOX_PORT ?? "8011"}/health`,
  },

  irodoritts: {
    kind: "python",
    displayName: "IrodoriTTS",
    venvRelPath: "servers/tts/irodoritts/.venv",
    scriptRelPath: "servers/tts/irodoritts/server.py",
    healthUrl: `http://127.0.0.1:${process.env.IRODORI_TTS_PORT ?? "8013"}/health`,
  },

  voxcpm2: {
    kind: "python",
    displayName: "VoxCPM2",
    venvRelPath: "servers/tts/voxcpm2/.venv",
    scriptRelPath: "servers/tts/voxcpm2/server.py",
    healthUrl: `http://127.0.0.1:${process.env.VOXCPM2_PORT ?? "8016"}/health`,
  },

  fishs2: {
    kind: "python",
    displayName: "Fish S2 Pro",
    venvRelPath: "servers/tts/fishs2/.venv",
    scriptRelPath: "servers/tts/fishs2/server.py",
    healthUrl: `http://127.0.0.1:${process.env.FISH_S2_PORT ?? "8015"}/health`,
  },

  cosyvoice3: {
    kind: "python",
    displayName: "CosyVoice 3",
    venvRelPath: "servers/tts/cosyvoice3/.venv",
    scriptRelPath: "servers/tts/cosyvoice3/server.py",
    healthUrl: `http://127.0.0.1:${process.env.COSYVOICE3_PORT ?? "8017"}/health`,
  },

  moss: {
    kind: "python",
    displayName: "MOSS-TTS",
    venvRelPath: "servers/tts/moss/.venv",
    scriptRelPath: "servers/tts/moss/server.py",
    healthUrl: `http://127.0.0.1:${process.env.MOSS_TTS_PORT ?? "8018"}/health`,
    // With MOSS_TTS_WARM_MODE=none the server reports "idle" until the first request loads a model.
    readyStatuses: ["ok", "idle"],
  },

  whisperx: {
    kind: "python",
    displayName: "WhisperX",
    venvRelPath: "servers/stt/.venv",
    scriptRelPath: "servers/stt/whisperx_server.py",
    healthUrl: `http://127.0.0.1:${process.env.TOMORI_STT_PORT ?? process.env.TOMORI_TRANSCRIPTION_PORT ?? "8021"}/health`,
  },
};

/**
 * Checks whether a named Docker container exists (regardless of state).
 * Returns the container's current state ("running", "exited", etc.) or null
 * if the container does not exist.
 */
async function getContainerState(name: string): Promise<string | null> {
  const proc = Bun.spawn(["docker", "inspect", "--format", "{{.State.Status}}", name], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  if (code !== 0) return null;
  return new Response(proc.stdout).text().then((t) => t.trim());
}

/**
 * Reads the Docker healthcheck status for a running container.
 * Returns "healthy", "unhealthy", "starting", or "" if no healthcheck is defined.
 */
async function getContainerHealth(name: string): Promise<string> {
  const proc = Bun.spawn(["docker", "inspect", "--format", "{{.State.Health.Status}}", name], {
    stdout: "pipe",
    stderr: "pipe",
  });
  await proc.exited;
  return new Response(proc.stdout).text().then((t) => t.trim());
}

/**
 * Polls until the container is ready, using Docker's healthcheck when available
 * and falling back to an HTTP probe when the container has no healthcheck defined
 * (e.g. an existing container created before --health-cmd was added to runArgs).
 * Throws on timeout or a Docker "unhealthy" status.
 */
async function waitForHealthy(def: DockerLocalServer, timeoutMs: number): Promise<void> {
  const { containerName, httpHealthUrl } = def;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const health = await getContainerHealth(containerName);

    if (health === "healthy") return;
    if (health === "unhealthy") throw new Error(`Container "${containerName}" reported unhealthy.`);

    // No Docker healthcheck on this container, so fall back to HTTP probe.
    if (health === "" && httpHealthUrl) {
      try {
        const res = await fetch(httpHealthUrl, { signal: AbortSignal.timeout(3_000) });
        if (res.ok) return;
      } catch {}
    }

    await Bun.sleep(2_000);
  }
  throw new Error(`Container "${containerName}" did not become healthy within ${timeoutMs / 1000}s.`);
}

type PythonHealthResult = { kind: "ready"; ready: boolean } | { kind: "exit"; code: number } | { kind: "retry" };

async function probeJsonHealth(url: string, readyStatuses: readonly string[]): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
    if (!response.ok) return false;
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object" || !("status" in payload)) return false;
    const status = payload.status;
    return typeof status === "string" && readyStatuses.includes(status);
  } catch {
    return false;
  }
}

async function waitForPythonReady(
  proc: ReturnType<typeof Bun.spawn>,
  def: PythonLocalServer,
  timeoutMs: number,
): Promise<void> {
  const readyStatuses = def.readyStatuses ?? ["ok"];
  const processExit = proc.exited.then((code): PythonHealthResult => ({ kind: "exit", code }));
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = await Promise.race<PythonHealthResult>([
      probeJsonHealth(def.healthUrl, readyStatuses).then((ready): PythonHealthResult => ({ kind: "ready", ready })),
      processExit,
      Bun.sleep(1_000).then((): PythonHealthResult => ({ kind: "retry" })),
    ]);

    if (result.kind === "exit") {
      throw new Error(`Process exited before readiness (exit ${result.code}).`);
    }
    if (result.kind === "ready" && result.ready) return;
  }

  throw new Error(`Server did not report a ready JSON status within ${timeoutMs / 1000}s.`);
}

/** Waits for the container's healthcheck to pass before returning. */
async function ensureDockerLocalServer(def: DockerLocalServer): Promise<void> {
  const { containerName, healthTimeoutMs = 120_000 } = def;
  const label = pc.cyan(`[${containerName}]`);

  const state = await getContainerState(containerName);

  if (containerName === "searxng" && state !== null) {
    const containerImage = Bun.spawnSync(["docker", "inspect", "-f", "{{.Image}}", containerName]);
    const builtImage = Bun.spawnSync(["docker", "image", "inspect", "-f", "{{.Id}}", def.image]);
    if (
      containerImage.exitCode !== 0 ||
      builtImage.exitCode !== 0 ||
      containerImage.stdout.toString().trim() !== builtImage.stdout.toString().trim()
    ) {
      throw new Error("The existing searxng container uses an older image. Stop and remove it, then run launch again.");
    }
  }

  if (state === null) {
    console.log(`${label} Container not found. Running docker run...`);
    const run = Bun.spawn(["docker", "run", ...def.runArgs], {
      env: { ...process.env, ...def.runEnv },
      stdout: "inherit",
      stderr: "inherit",
    });
    const code = await run.exited;
    if (code !== 0) throw new Error(`docker run for "${containerName}" failed (exit ${code}).`);
  } else if (state !== "running") {
    console.log(`${label} Resuming existing container...`);
    const start = Bun.spawn(["docker", "start", containerName], {
      stdout: "inherit",
      stderr: "inherit",
    });
    const code = await start.exited;
    if (code !== 0) throw new Error(`docker start for "${containerName}" failed (exit ${code}).`);
  } else {
    console.log(`${label} Already running.`);
  }

  console.log(`${label} Waiting for healthcheck...`);
  await waitForHealthy(def, healthTimeoutMs);
  console.log(`${label} ${pc.green("Healthy ✓")}`);
}

/**
 * Stops a spawned process together with its children. On Windows `proc.kill()` ends only the
 * top process, which would orphan a wrapper's nested runtime (Fish S2 starts its own API server).
 */
function terminateProcess(proc: ReturnType<typeof Bun.spawn>): void {
  try {
    if (process.platform === "win32" && proc.pid) {
      Bun.spawnSync(["taskkill", "/F", "/T", "/PID", String(proc.pid)], {
        stdout: "ignore",
        stderr: "ignore",
      });
    } else {
      proc.kill();
    }
  } catch {
    /* already exited */
  }
}

/**
 * Spawns a Python local server from its pre-built venv and waits for JSON readiness before
 * returning the handle.
 * Throws if the venv is missing (user must run setup first).
 */
async function startPythonLocalServer(def: PythonLocalServer, flagName: string): Promise<ReturnType<typeof Bun.spawn>> {
  const { displayName, venvRelPath, scriptRelPath, scriptArgs = [] } = def;
  const healthTimeoutMs = resolvePositiveTimeoutMs(
    process.env.TOMORI_TTS_STARTUP_TIMEOUT_MS,
    DEFAULT_PYTHON_HEALTH_TIMEOUT_MS,
  );
  const label = pc.magenta(`[${displayName}]`);

  const pythonExe = resolvePythonExe(venvRelPath);
  if (!existsSync(pythonExe)) {
    throw new Error(
      `${displayName} venv not found at "${join(ROOT, venvRelPath)}". ` +
        `Run the setup instructions in the docs before using --${flagName}.`,
    );
  }

  const scriptPath = join(ROOT, scriptRelPath);
  console.log(`${label} Starting...`);

  const proc = Bun.spawn([pythonExe, scriptPath, ...scriptArgs], {
    stdout: "inherit",
    stderr: "inherit",
    cwd: ROOT,
  });

  console.log(`${label} Waiting for JSON readiness (up to ${healthTimeoutMs / 1000}s)...`);
  try {
    await waitForPythonReady(proc, def, healthTimeoutMs);
  } catch (error) {
    terminateProcess(proc);
    throw new Error(`${displayName} did not become ready: ${error instanceof Error ? error.message : error}`);
  }
  console.log(`${label} ${pc.green("Ready ✓")}`);

  return proc;
}

async function main(): Promise<void> {
  const requested = [...flags].filter((f) => f in LOCAL_SERVERS);
  const unknown = [...flags].filter((f) => !(f in LOCAL_SERVERS) && f !== "help" && f !== "h");

  if (unknown.length > 0) {
    console.warn(pc.yellow(`Unknown flags: ${unknown.map((f) => `--${f}`).join(", ")} — ignoring.`));
  }

  const childProcesses: ReturnType<typeof Bun.spawn>[] = [];

  for (const flag of requested) {
    const def = LOCAL_SERVERS[flag];
    try {
      if (def.kind === "docker") {
        if (flag === "searxng") {
          const build = Bun.spawn(
            [
              "docker",
              "build",
              "-t",
              "tomoribot-searxng:latest",
              "-f",
              "servers/searxng/Dockerfile",
              "servers/searxng",
            ],
            { cwd: ROOT, stdout: "inherit", stderr: "inherit" },
          );
          if ((await build.exited) !== 0) throw new Error("SearXNG image build failed.");
        }
        // Without a token the pinned image binds only the container's loopback, so the bot could never connect.
        if (flag === "crawl4ai" && !process.env.CRAWL4AI_TOKEN) {
          throw new Error("Set CRAWL4AI_TOKEN in .env; Crawl4AI refuses outside connections without an API token.");
        }
        await ensureDockerLocalServer(def);
      } else {
        const proc = await startPythonLocalServer(def, flag);
        childProcesses.push(proc);
      }
    } catch (err) {
      console.error(pc.red(`Failed to start local server "${flag}": ${err instanceof Error ? err.message : err}`));
      for (const p of childProcesses) terminateProcess(p);
      process.exit(1);
    }
  }

  console.log(`\n${pc.bold(pc.blue("[TomoriBot]"))} Starting bot in watch mode...\n`);
  const bot = Bun.spawn(["bun", "--watch", "src/index.ts"], {
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
    cwd: ROOT,
  });
  childProcesses.push(bot);

  // Graceful shutdown because kill all managed processes on Ctrl+C.
  let isShuttingDown = false;
  const shutdown = () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`\n${pc.yellow("[launch] Shutting down...")}`);
    for (const p of childProcesses) {
      terminateProcess(p);
    }
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Wait for the bot to exit (its exit code becomes this process's exit code).
  const exitCode = await bot.exited;
  for (const p of childProcesses) {
    if (p !== bot) {
      terminateProcess(p);
    }
  }
  process.exit(exitCode);
}

main().catch((err) => {
  console.error(pc.red(`[launch] Fatal: ${err instanceof Error ? err.message : err}`));
  process.exit(1);
});
