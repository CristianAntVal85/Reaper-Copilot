import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  CopilotError,
  REPLAY_SCHEMA_VERSION,
  REPLAY_TITLE_MAX,
  ReplayIndexSchema,
  ReplayRunSchema,
  type AnalyzerPort,
  type AssetPath,
  type AudioFeatures,
  type ReplayIndex,
  type ReplayRun,
  type ReplayStep,
  type StoragePort,
  type ToolCallTrace,
} from "@reaper-copilot/core";
import { analyzeWithCache, resolveAssetPath, type ToolContext } from "@reaper-copilot/tools";

export interface ExportReplayRunOptions {
  readonly storage: StoragePort;
  readonly analyzer: AnalyzerPort;
  readonly workspaceRoot: string;
  /** Directory that holds `index.json` and one folder per run (`apps/web/public/runs`). */
  readonly outDir: string;
  readonly taskId: string;
  /** Defaults to the task request (cut to the title limit). */
  readonly title?: string | undefined;
  readonly log: (message: string) => void;
}

export interface ExportedFile {
  /** Relative to `outDir`. */
  readonly path: string;
  readonly bytes: number;
}

export interface ExportReplayRunResult {
  readonly files: readonly ExportedFile[];
  readonly totalBytes: number;
}

function toStep(trace: ToolCallTrace): ReplayStep {
  const { step, sessionId, tool, startedAt, durationMs, ok, errorCode, args, result } = trace;
  return { step, sessionId, tool, startedAt, durationMs, ok, errorCode, args, result };
}

function compareTraces(a: ToolCallTrace, b: ToolCallTrace): number {
  const byTime = Date.parse(a.startedAt) - Date.parse(b.startedAt);
  return byTime !== 0 ? byTime : a.step - b.step;
}

/** Replaces any absolute workspace path inside a JSON value with its workspace-relative form. */
function scrubPaths<T>(value: T, root: string): T {
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return v.split(prefix).join("");
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === "object") {
      return Object.fromEntries(Object.entries(v).map(([k, item]) => [k, walk(item)]));
    }
    return v;
  };
  return walk(value) as T;
}

async function writeAtomic(file: string, content: string): Promise<void> {
  const tmp = `${file}.tmp`;
  try {
    await writeFile(tmp, content);
    await rename(tmp, file);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}

/** Rebuilds `index.json` from the run.json of every run folder (folders starting with a dot are ignored). */
export async function regenerateReplayIndex(outDir: string): Promise<ReplayIndex> {
  const entries = await readdir(outDir, { withFileTypes: true });
  const runs: ReplayIndex["runs"][number][] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    let raw: string;
    try {
      raw = await readFile(path.join(outDir, entry.name, "run.json"), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    const parsed = ReplayRunSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      throw new CopilotError("invalid_analysis_output", `${entry.name}/run.json is not a valid replay run`);
    }
    const run = parsed.data;
    const last = run.verifications[run.verifications.length - 1];
    if (last === undefined) continue;
    runs.push({
      taskId: run.taskId,
      title: run.title,
      createdAt: run.createdAt,
      pass: last.pass,
      attempts: run.verifications.length,
    });
  }
  runs.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const index = ReplayIndexSchema.parse({ schemaVersion: REPLAY_SCHEMA_VERSION, runs });
  await writeAtomic(path.join(outDir, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
  return index;
}

/**
 * Exports one task as `<outDir>/<taskId>/` (`run.json`, `source.mp3`, `render-<attempt>.mp3`) and
 * regenerates `<outDir>/index.json`. Paths are validated before anything is written; the folder is
 * built beside the final one and swapped in, so a failure leaves any previous export untouched.
 */
export async function exportReplayRun(options: ExportReplayRunOptions): Promise<ExportReplayRunResult> {
  const { storage, analyzer, workspaceRoot, outDir, taskId, log } = options;

  const task = await storage.getTask(taskId);
  if (task === null) throw new CopilotError("task_not_found", `task not found: ${taskId}`);
  const verifications = await storage.listVerifications(taskId);
  if (verifications.length === 0) {
    throw new CopilotError("task_not_found", `task ${taskId} has no verifications to export`);
  }
  const steps = (await storage.listToolCalls({ taskId })).slice().sort(compareTraces).map(toStep);

  const sourcePath = await resolveAssetPath(workspaceRoot, task.source);
  const renderPaths: AssetPath[] = [];
  for (const verification of verifications) {
    renderPaths.push(await resolveAssetPath(workspaceRoot, verification.render.path));
  }

  const ctx: ToolContext = { workspaceRoot, analyzer, storage, log };
  const root = path.resolve(workspaceRoot);
  const finalDir = path.join(outDir, taskId);
  const tmpDir = path.join(outDir, `.${taskId}.tmp`);
  const oldDir = path.join(outDir, `.${taskId}.old`);

  await mkdir(outDir, { recursive: true });
  await rm(tmpDir, { recursive: true, force: true });
  await rm(oldDir, { recursive: true, force: true });
  await mkdir(tmpDir);

  let swapped = false;
  let hadPrevious = false;
  try {
    const exportAudio = async (
      input: AssetPath,
      file: string,
      targetBpm: number | undefined,
    ): Promise<{ file: string; features: AudioFeatures; assets: Awaited<ReturnType<AnalyzerPort["replayAssets"]>> }> => {
      const output = path.join(tmpDir, file);
      const assets = await analyzer.replayAssets(input, output);
      await stat(output).catch(() => {
        throw new CopilotError("analysis_failed", `the analyzer did not write ${file}`);
      });
      const { features } = await analyzeWithCache(ctx, input, targetBpm === undefined ? {} : { targetBpm });
      return { file, features, assets };
    };

    const source = await exportAudio(sourcePath, "source.mp3", undefined);
    const runVerifications = [];
    for (const [i, verification] of verifications.entries()) {
      const render = await exportAudio(
        renderPaths[i] as AssetPath,
        `render-${verification.attempt}.mp3`,
        task.target.bpm,
      );
      runVerifications.push({
        attempt: verification.attempt,
        verifiedAt: verification.verifiedAt,
        pass: verification.pass,
        results: verification.results,
        render,
      });
    }

    const title = (options.title ?? task.request.trim().slice(0, REPLAY_TITLE_MAX)).trim();
    const run: ReplayRun = ReplayRunSchema.parse(
      scrubPaths(
        {
          schemaVersion: REPLAY_SCHEMA_VERSION,
          taskId: task.taskId,
          title,
          request: task.request,
          createdAt: task.createdAt,
          target: task.target,
          criteria: task.criteria,
          source,
          verifications: runVerifications,
          steps,
        },
        root,
      ),
    );
    await writeFile(path.join(tmpDir, "run.json"), `${JSON.stringify(run, null, 2)}\n`);

    hadPrevious = await stat(finalDir).then(
      () => true,
      () => false,
    );
    if (hadPrevious) await rename(finalDir, oldDir);
    await rename(tmpDir, finalDir);
    swapped = true;
    await rm(oldDir, { recursive: true, force: true });
    await regenerateReplayIndex(outDir);
  } catch (error) {
    await rm(tmpDir, { recursive: true, force: true });
    if (!swapped && hadPrevious) await rename(oldDir, finalDir).catch(() => undefined);
    throw error;
  }

  const files: ExportedFile[] = [];
  for (const name of (await readdir(finalDir)).sort()) {
    files.push({ path: `${taskId}/${name}`, bytes: (await stat(path.join(finalDir, name))).size });
  }
  const indexBytes = (await stat(path.join(outDir, "index.json"))).size;
  files.push({ path: "index.json", bytes: indexBytes });
  return { files, totalBytes: files.reduce((sum, f) => sum + f.bytes, 0) };
}
