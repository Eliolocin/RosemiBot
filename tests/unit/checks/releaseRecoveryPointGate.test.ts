import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const workflowPath = path.join(import.meta.dir, "..", "..", "..", ".github", "workflows", "deploy-azure.yml");
const deployScriptPath = path.join(import.meta.dir, "..", "..", "..", "deploy", "azure", "run-command-deploy.sh");

function recoveryPointStep(workflow: string): string {
  workflow = workflow.replaceAll("\r\n", "\n");
  const start = workflow.indexOf("      - name: Validate recovery point or create PostgreSQL backup");
  const runStart = workflow.indexOf("        run: |\n", start);
  const end = workflow.indexOf("      - name: Setup Terraform", runStart);
  if (start < 0 || runStart < 0 || end < 0) throw new Error("Recovery point step was not found");
  return workflow
    .slice(runStart + "        run: |\n".length, end)
    .split("\n")
    .map((line) => line.replace(/^ {10}/, ""))
    .join("\n")
    .replaceAll(/\$\{\{ github\.run_id \}\}/g, "123")
    .replaceAll(/\$\{\{ github\.run_attempt \}\}/g, "1");
}

const gitPath = Bun.which("git");
const bash =
  process.platform === "win32" && gitPath ? path.resolve(path.dirname(gitPath), "..", "bin", "bash.exe") : "bash";
const bashFile = (filePath: string) =>
  process.platform === "win32"
    ? filePath.replace(/^([A-Za-z]):/, (_, drive: string) => `/${drive.toLowerCase()}`).replaceAll("\\", "/")
    : filePath;

test.skipIf(process.platform === "win32" && !existsSync(bash))(
  "Burstable recovery point requires a usable restore window",
  async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "tomoribot-recovery-point-"));
    try {
      const workflow = await readFile(workflowPath, "utf8");
      const scriptPath = path.join(directory, "checkpoint.sh");
      const fixturePath = path.join(directory, "server.json");
      const summaryPath = path.join(directory, "summary.md");
      await writeFile(scriptPath, recoveryPointStep(workflow));

      const run = async (server: {
        state: string;
        backup: { backupRetentionDays: number; earliestRestoreDate: string };
      }) => {
        await writeFile(fixturePath, JSON.stringify({ sku: { tier: "Burstable" }, ...server }));
        await writeFile(summaryPath, "");
        const proc = Bun.spawn([bash, "-c", 'az() { cat "$CHECKPOINT_FIXTURE"; }; source "$CHECKPOINT_SCRIPT"'], {
          env: {
            ...process.env,
            CHECKPOINT_FIXTURE: bashFile(fixturePath),
            CHECKPOINT_SCRIPT: bashFile(scriptPath),
            GITHUB_STEP_SUMMARY: bashFile(summaryPath),
          },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ]);
        return { exitCode, output: `${stdout}\n${stderr}`, summary: await readFile(summaryPath, "utf8") };
      };

      const yesterday = new Date(Date.now() - 86_400_000).toISOString();
      const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
      const valid = await run({ state: "Ready", backup: { backupRetentionDays: 7, earliestRestoreDate: yesterday } });
      expect(valid.exitCode).toBe(0);
      expect(valid.summary).toContain(
        "az postgres flexible-server restore --resource-group tomoribot-rg --name tomoribot-pitr-123-1",
      );
      expect(valid.summary).toContain("--restore-time '");

      const stopped = await run({
        state: "Stopped",
        backup: { backupRetentionDays: 7, earliestRestoreDate: yesterday },
      });
      expect(stopped.exitCode).toBe(1);
      expect(stopped.summary).toBe("");

      const expired = await run({ state: "Ready", backup: { backupRetentionDays: 7, earliestRestoreDate: tomorrow } });
      expect(expired.exitCode).toBe(1);
      expect(expired.output).toContain("earliest restore point is later");

      const disabled = await run({
        state: "Ready",
        backup: { backupRetentionDays: 0, earliestRestoreDate: yesterday },
      });
      expect(disabled.exitCode).toBe(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test.skipIf(process.platform === "win32" && !existsSync(bash))(
  "deploy verification fails on repository and post-start errors without printing records",
  async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "tomoribot-deploy-verify-"));
    try {
      const deployScript = await readFile(deployScriptPath, "utf8");
      const start = deployScript.indexOf("# Exercise the repository queries");
      const end = deployScript.indexOf("assert_file() {", start);
      if (start < 0 || end < 0) throw new Error("Deploy verification block was not found");
      const checkPath = path.join(directory, "verify.sh");
      await writeFile(checkPath, deployScript.slice(start, end).replaceAll("\r\n", "\n"));

      const run = async (mode: string) => {
        const wrapper = `
          set -euo pipefail
          container_id=test-container
          stage_dir="$CHECK_TEMP"
          started_at=$(date -u -d '2 minutes ago' +%Y-%m-%dT%H:%M:%S.%NZ)
          verification_since="$started_at"
          restart_count=0
          docker() {
            case "$1" in
              exec)
                if [[ "$*" == *error_logs* ]]; then
                  if [ "$CHECK_MODE" = db_error ]; then echo 1; else echo 0; fi
                elif [ "$CHECK_MODE" = user_error ]; then
                  echo 'SMOKE_FAILED:user_repository'
                  return 1
                elif [ "$CHECK_MODE" = endpoint_error ]; then
                  echo 'SMOKE_FAILED:custom_endpoint_repository'
                  return 1
                else
                  echo SMOKE_OK
                fi
                ;;
              inspect)
                case "$3" in
                  *State.Running*) echo true ;;
                  *State.StartedAt*) echo "$started_at" ;;
                  *RestartCount*) echo 0 ;;
                esac
                ;;
              logs)
                if [ "$CHECK_MODE" = container_error ]; then echo '{"level":50,"msg":"private user data"}'; fi
                ;;
            esac
          }
          curl() { return 0; }
          source "$CHECK_SCRIPT"
        `;
        const proc = Bun.spawn([bash, "-c", wrapper], {
          env: {
            ...process.env,
            CHECK_TEMP: bashFile(directory),
            CHECK_SCRIPT: bashFile(checkPath),
            CHECK_MODE: mode,
          },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ]);
        return { exitCode, output: `${stdout}\n${stderr}` };
      };

      expect((await run("clean")).exitCode).toBe(0);
      const user = await run("user_error");
      expect(user.exitCode).toBe(1);
      expect(user.output).toContain("UserRepository smoke check failed.");
      const endpoint = await run("endpoint_error");
      expect(endpoint.exitCode).toBe(1);
      expect(endpoint.output).toContain("Custom endpoint repository smoke check failed.");
      const database = await run("db_error");
      expect(database.exitCode).toBe(1);
      expect(database.output).toContain("Post-start error log check failed");
      const container = await run("container_error");
      expect(container.exitCode).toBe(1);
      expect(container.output).toContain("New container emitted 1 error log(s).");
      expect(container.output).not.toContain("private user data");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
