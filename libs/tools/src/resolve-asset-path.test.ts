import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveAssetPath } from "./resolve-asset-path.ts";

let base: string;
let ws: string;
let realWs: string;

beforeAll(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), "rca-tools-")));
  ws = path.join(base, "ws");
  await mkdir(path.join(ws, "sub"), { recursive: true });
  await mkdir(path.join(ws, "folder.wav"));
  await mkdir(path.join(base, "ws-evil"));
  await writeFile(path.join(ws, "song.wav"), "x");
  await writeFile(path.join(ws, "sub", "loop.FLAC"), "x");
  await writeFile(path.join(ws, "notes.txt"), "x");
  await writeFile(path.join(base, "secret.wav"), "x");
  await writeFile(path.join(base, "ws-evil", "evil.wav"), "x");
  await symlink(path.join(base, "secret.wav"), path.join(ws, "escape.wav"));
  await symlink(path.join(base, "ws-evil"), path.join(ws, "escape-dir"));
  await symlink(path.join(ws, "song.wav"), path.join(ws, "alias.wav"));
  await symlink(path.join(ws, "notes.txt"), path.join(ws, "disguised.wav"));
  await symlink(path.join(ws, "missing.wav"), path.join(ws, "dangling.wav"));
  await symlink(ws, path.join(base, "ws-link"));
  realWs = await realpath(ws);
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

const rejects = (input: string, code: string, root = () => ws) =>
  expect(resolveAssetPath(root(), input)).rejects.toMatchObject({ name: "CopilotError", code });

describe("resolveAssetPath", () => {
  it("accepts a relative path", async () => {
    expect(await resolveAssetPath(ws, "song.wav")).toBe(path.join(realWs, "song.wav"));
  });

  it("accepts an absolute path inside the workspace", async () => {
    expect(await resolveAssetPath(ws, path.join(ws, "sub", "loop.FLAC"))).toBe(
      path.join(realWs, "sub", "loop.FLAC"),
    );
  });

  it("accepts any extension case and a path that goes up and back down", async () => {
    expect(await resolveAssetPath(ws, "sub/../sub/loop.FLAC")).toBe(
      path.join(realWs, "sub", "loop.FLAC"),
    );
  });

  it("resolves a symlink that stays inside the workspace", async () => {
    expect(await resolveAssetPath(ws, "alias.wav")).toBe(path.join(realWs, "song.wav"));
  });

  it("works when the workspace root itself is reached through a symlink", async () => {
    const link = path.join(base, "ws-link");
    expect(await resolveAssetPath(link, "song.wav")).toBe(path.join(realWs, "song.wav"));
    expect(await resolveAssetPath(link, path.join(link, "song.wav"))).toBe(
      path.join(realWs, "song.wav"),
    );
    expect(await resolveAssetPath(link, path.join(realWs, "song.wav"))).toBe(
      path.join(realWs, "song.wav"),
    );
  });

  it("rejects ../ traversal", async () => {
    await rejects("../secret.wav", "path_outside_workspace");
    await rejects("../../etc/passwd", "path_outside_workspace");
    await rejects("sub/../../secret.wav", "path_outside_workspace");
  });

  it("rejects an absolute path outside the workspace", async () => {
    await rejects(path.join(base, "secret.wav"), "path_outside_workspace");
    await rejects("/etc/passwd", "path_outside_workspace");
  });

  it("rejects a sibling directory that shares the workspace name as prefix", async () => {
    await rejects(path.join(base, "ws-evil", "evil.wav"), "path_outside_workspace");
    await rejects("../ws-evil/evil.wav", "path_outside_workspace");
  });

  it("rejects a symlink that leaves the workspace", async () => {
    await rejects("escape.wav", "path_outside_workspace");
    await rejects("escape-dir/evil.wav", "path_outside_workspace");
  });

  it("rejects a missing file, a dangling symlink and a file below a regular file", async () => {
    await rejects("missing.wav", "file_not_found");
    await rejects("dangling.wav", "file_not_found");
    await rejects("song.wav/x.wav", "file_not_found");
  });

  it("does not reveal whether a missing file outside the workspace exists", async () => {
    await rejects("../nope/missing.wav", "path_outside_workspace");
  });

  it("rejects a directory, even one named like audio", async () => {
    await rejects("sub", "unsupported_format");
    await rejects("folder.wav", "unsupported_format");
    await rejects(".", "unsupported_format");
  });

  it("rejects an unsupported extension, judged on the resolved file", async () => {
    await rejects("notes.txt", "unsupported_format");
    await rejects("disguised.wav", "unsupported_format");
  });

  it("rejects empty paths and null bytes", async () => {
    await rejects("", "path_outside_workspace");
    await rejects("song.wav\0.txt", "path_outside_workspace");
  });

  it("reports a missing workspace as file_not_found", async () => {
    await rejects("song.wav", "file_not_found", () => path.join(base, "no-such-workspace"));
  });
});
