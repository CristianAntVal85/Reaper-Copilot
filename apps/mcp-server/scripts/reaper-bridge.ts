// Usage: pnpm reaper:bridge
// Loads reaper/bridge/bridge.lua into the Reaper that is already open (`reaper.exe -nonewinst`).
// Launching a running script that way STOPS it, so if the bridge answers we send `quit` first and
// wait until its heartbeat is gone; then we launch it, wait for the heartbeat and ping.
// Environment: COPILOT_REAPER_EXE, COPILOT_REAPER_IPC, COPILOT_REAPER_PATH_STYLE, WSL_DISTRO_NAME.
import { spawn } from "node:child_process";
import { access, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ReaperDaw } from "@reaper-copilot/adapter-reaper";
import { readConfig } from "../src/config.ts";

const DEFAULT_EXE = "/mnt/c/Program Files/REAPER (x64)/reaper.exe";
const WAIT_MS = 15_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const fail = (message: string): never => {
  console.error(`reaper:bridge: ${message}`);
  process.exit(1);
};

const env = process.env;
const config = readConfig(env);
const exe = env["COPILOT_REAPER_EXE"]?.trim() || DEFAULT_EXE;
const bridgeFile = path.resolve(fileURLToPath(new URL("../../../reaper/bridge/bridge.lua", import.meta.url)));
const distro = env["WSL_DISTRO_NAME"];

let scriptArg = bridgeFile;
if (config.reaperPathStyle === "unc") {
  if (!distro) fail("COPILOT_REAPER_PATH_STYLE=unc needs WSL_DISTRO_NAME");
  scriptArg = `\\\\wsl.localhost\\${distro}${bridgeFile.replaceAll("/", "\\")}`;
}

try {
  await access(exe);
} catch {
  fail(`reaper.exe not found at ${exe} (set COPILOT_REAPER_EXE)`);
}

const heartbeat = path.join(config.reaperIpcDir, "heartbeat.json");
const heartbeatExists = (): Promise<boolean> =>
  stat(heartbeat).then(
    () => true,
    () => false,
  );
async function waitFor(condition: () => Promise<boolean>, wanted: boolean): Promise<boolean> {
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    if ((await condition()) === wanted) return true;
    await sleep(100);
  }
  return false;
}

const daw = new ReaperDaw({
  ipcDir: config.reaperIpcDir,
  pathStyle: config.reaperPathStyle,
  ...(distro === undefined ? {} : { distro }),
  timeoutMs: 1_500,
});

// If the bridge is running, stop it first: -nonewinst on a running script toggles it off.
const running = await daw.ping().then(
  () => true,
  () => false,
);
if (running) {
  console.log("the bridge is running: asking it to quit");
  await daw.quit().catch(() => undefined);
  if (!(await waitFor(heartbeatExists, false))) fail("the bridge did not stop (heartbeat still present)");
}

console.log(`loading ${scriptArg}`);
const child = spawn(exe, ["-nonewinst", scriptArg], { stdio: "ignore", detached: true });
child.on("error", (error) => fail(`cannot start reaper.exe: ${error.message}`));
child.unref();

// A heartbeat left by the stopped bridge can take a few seconds to clear; the bridge waits for it.
let reaperVersion: string | undefined;
const answers = async (): Promise<boolean> => {
  try {
    reaperVersion = (await daw.ping()).reaperVersion;
    return true;
  } catch {
    return false;
  }
};
if (!(await waitFor(answers, true))) fail("the bridge does not answer: is Reaper open?");
console.log(`bridge ready (Reaper ${reaperVersion ?? "?"}), ipc: ${config.reaperIpcDir}`);
process.exit(0);
