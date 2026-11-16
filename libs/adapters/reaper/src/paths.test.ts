import { describe, expect, it } from "vitest";
import { fromDawPath, toDawPath } from "./paths.ts";

const unc = { style: "unc", distro: "Ubuntu-24.04" } as const;

describe("toDawPath", () => {
  it("maps a Linux path to a UNC path", () => {
    expect(toDawPath("/home/u/ws/a b.wav", unc)).toBe("\\\\wsl.localhost\\Ubuntu-24.04\\home\\u\\ws\\a b.wav");
  });
  it("rejects relative paths and paths with NUL", () => {
    expect(toDawPath("ws/a.wav", unc)).toBeNull();
    expect(toDawPath("/a\0b", unc)).toBeNull();
  });
  it("needs a distro for unc", () => {
    expect(toDawPath("/a.wav", { style: "unc" })).toBeNull();
  });
  it("leaves paths alone with identity", () => {
    expect(toDawPath("/home/u/a.wav", { style: "identity" })).toBe("/home/u/a.wav");
  });
});

describe("fromDawPath", () => {
  it("maps a UNC path back to Linux", () => {
    expect(fromDawPath("\\\\wsl.localhost\\Ubuntu-24.04\\home\\u\\a.wav", unc)).toBe("/home/u/a.wav");
  });
  it("ignores case in the prefix and distro, and accepts wsl$", () => {
    expect(fromDawPath("\\\\WSL.LOCALHOST\\ubuntu-24.04\\home\\a.wav", unc)).toBe("/home/a.wav");
    expect(fromDawPath("\\\\wsl$\\Ubuntu-24.04\\home\\a.wav", unc)).toBe("/home/a.wav");
  });
  it("accepts forward slashes from Reaper", () => {
    expect(fromDawPath("//wsl.localhost/Ubuntu-24.04/home/a.wav", unc)).toBe("/home/a.wav");
  });
  it("maps the distribution root", () => {
    expect(fromDawPath("\\\\wsl.localhost\\Ubuntu-24.04", unc)).toBe("/");
  });
  it("returns null for Windows drives, relative names and other distributions", () => {
    expect(fromDawPath("C:\\Users\\u\\a.wav", unc)).toBeNull();
    expect(fromDawPath("a.wav", unc)).toBeNull();
    expect(fromDawPath("\\\\wsl.localhost\\Debian\\home\\a.wav", unc)).toBeNull();
  });
  it("round-trips", () => {
    const linux = "/home/cristian-pc/proyectos/x y/audio.wav";
    expect(fromDawPath(toDawPath(linux, unc) ?? "", unc)).toBe(linux);
  });
  it("identity accepts absolute Linux paths only", () => {
    expect(fromDawPath("/home/a.wav", { style: "identity" })).toBe("/home/a.wav");
    expect(fromDawPath("a.wav", { style: "identity" })).toBeNull();
  });
});
