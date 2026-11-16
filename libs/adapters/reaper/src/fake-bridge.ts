import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

type FakeBridgeReply =
  | { ok: true; result: unknown }
  | { ok: false; error: { code: string; message?: string } }
  | "silence";

/** May be async: like the real bridge, it serves nothing else until the handler settles. */
export type FakeBridgeHandler = (method: string, params: unknown) => FakeBridgeReply | Promise<FakeBridgeReply>;

/** Stand-in for `bridge.lua` in tests: same files, same protocol, handler in Node. */
export class FakeBridge {
  readonly seen: string[] = [];
  state: "idle" | "rendering" = "idle";
  private timer: NodeJS.Timeout | undefined;
  private busy = false;

  private readonly ipcDir: string;
  private readonly handler: FakeBridgeHandler;

  constructor(ipcDir: string, handler: FakeBridgeHandler) {
    this.ipcDir = ipcDir;
    this.handler = handler;
  }

  async start(options: { heartbeat?: boolean } = {}): Promise<void> {
    await mkdir(path.join(this.ipcDir, "inbox"), { recursive: true });
    await mkdir(path.join(this.ipcDir, "outbox"), { recursive: true });
    if (options.heartbeat !== false) await this.beat();
    let ticks = 0;
    this.timer = setInterval(() => {
      if (options.heartbeat !== false && ++ticks % 10 === 0) void this.beat();
      void this.poll();
    }, 10);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async beat(): Promise<void> {
    await writeFile(
      path.join(this.ipcDir, "heartbeat.json"),
      JSON.stringify({ state: this.state, instance: "fake", time: Math.floor(Date.now() / 1000) }),
    );
  }

  private async poll(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const inbox = path.join(this.ipcDir, "inbox");
      for (const name of await readdir(inbox)) {
        if (!name.endsWith(".json")) continue;
        const file = path.join(inbox, name);
        const raw = await readFile(file, "utf8").catch(() => null);
        await rm(file, { force: true });
        if (raw === null) continue;
        const request = JSON.parse(raw) as { id: string; method: string; params: unknown };
        this.seen.push(request.method);
        const reply = await this.handler(request.method, request.params);
        if (reply === "silence") continue;
        const out = path.join(this.ipcDir, "outbox", `${request.id}.json`);
        await writeFile(`${out}.tmp`, JSON.stringify({ id: request.id, ...reply }));
        await rename(`${out}.tmp`, out);
      }
    } finally {
      this.busy = false;
    }
  }
}
