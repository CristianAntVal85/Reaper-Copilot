import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asAssetPath,
  AudioFeaturesSchema,
  CopilotError,
  ReplayAssetsSchema,
} from "@reaper-copilot/core";
import { DEFAULT_PYTHON_PATH, PythonAnalyzer } from "./python-analyzer.ts";

// Real Python, real librosa. Run with `pnpm test:contract` (part of check:full).
const SAMPLE_RATE = 44_100;

/** 16-bit PCM stereo WAV with a short decaying 1 kHz click on every beat. */
function clickTrackWav(bpm: number, seconds: number): Buffer {
  const frames = SAMPLE_RATE * seconds;
  const samples = new Int16Array(frames * 2);
  const beatFrames = (SAMPLE_RATE * 60) / bpm;
  const clickLength = 600;
  for (let beat = 0; beat * beatFrames < frames; beat++) {
    const start = Math.round(beat * beatFrames);
    for (let i = 0; i < clickLength && start + i < frames; i++) {
      const value = Math.round(
        0.8 * 32767 * Math.exp(-i / 120) * Math.sin((2 * Math.PI * 1000 * i) / SAMPLE_RATE),
      );
      samples[(start + i) * 2] = value;
      samples[(start + i) * 2 + 1] = value;
    }
  }
  const data = Buffer.from(samples.buffer);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(2, 22); // channels
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 4, 28); // byte rate
  header.writeUInt16LE(4, 32); // block align
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

let dir: string;
let wavPath: string;

beforeAll(async () => {
  if (!existsSync(DEFAULT_PYTHON_PATH)) {
    throw new Error(
      `Python environment missing at ${DEFAULT_PYTHON_PATH}: run pnpm py:setup first`,
    );
  }
  dir = await mkdtemp(join(tmpdir(), "analysis-py-contract-"));
  wavPath = join(dir, "clicks 150.wav"); // a space on purpose
  await writeFile(wavPath, clickTrackWav(150, 10));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("PythonAnalyzer with the real analysis package", () => {
  const analyzer = new PythonAnalyzer({ timeoutMs: 150_000 });

  it("analyzes a generated WAV and the result passes the contract", async () => {
    const features = await analyzer.analyze(asAssetPath(wavPath), {
      targetBpm: 150,
    });
    expect(AudioFeaturesSchema.safeParse(features).success).toBe(true);
    expect(features.file.sampleRate).toBe(SAMPLE_RATE);
    expect(features.file.channels).toBe(2);
    expect(features.file.durationSec).toBeCloseTo(10, 1);
    expect(features.tempo.bpm).toBeCloseTo(150, 0);
    expect(features.tempo.target?.matches).toBe(true);
  });

  it("returns tempo.target as null without a target", async () => {
    const features = await analyzer.analyze(asAssetPath(wavPath));
    expect(features.schemaVersion).toBe(2);
    expect(features.tempo.target).toBeNull();
  });

  it("reports file_not_found for a missing file", async () => {
    const error = await analyzer.analyze(asAssetPath(join(dir, "missing.wav"))).catch((e) => e);
    expect(error).toBeInstanceOf(CopilotError);
    expect(error.code).toBe("file_not_found");
  });

  it("reports unsupported_format for a file that is not audio", async () => {
    const textPath = join(dir, "notes.wav");
    await writeFile(textPath, "this is not audio");
    const error = await analyzer.analyze(asAssetPath(textPath)).catch((e) => e);
    expect(error).toBeInstanceOf(CopilotError);
    expect(error.code).toBe("unsupported_format");
  });

  it("builds replay assets from a generated WAV: valid output and an mp3 on disk", async () => {
    const output = join(dir, "replay out.mp3");
    const assets = await analyzer.replayAssets(asAssetPath(wavPath), output);
    expect(ReplayAssetsSchema.safeParse(assets).success).toBe(true);
    expect(assets.durationSec).toBeCloseTo(10, 1);
    expect(existsSync(output)).toBe(true);
  });

  it("refuses to overwrite an existing output", async () => {
    const output = join(dir, "existing.mp3");
    await writeFile(output, "keep");
    const error = await analyzer.replayAssets(asAssetPath(wavPath), output).catch((e) => e);
    expect(error).toBeInstanceOf(CopilotError);
    expect(error.code).toBe("analysis_failed");
    expect(await readFile(output, "utf8")).toBe("keep");
  });
});
