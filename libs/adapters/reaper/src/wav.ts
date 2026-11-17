import { open } from "node:fs/promises";

/** Duration in seconds from a PCM WAV header (RIFF `fmt ` and `data` chunks), or null if unreadable. */
export function wavDurationFromHeader(head: Buffer, fileSize: number): number | null {
  if (head.length < 12 || head.toString("latin1", 0, 4) !== "RIFF" || head.toString("latin1", 8, 12) !== "WAVE") {
    return null;
  }
  let byteRate = 0;
  let offset = 12;
  while (offset + 8 <= head.length) {
    const id = head.toString("latin1", offset, offset + 4);
    const size = head.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      if (body + 12 > head.length) return null;
      byteRate = head.readUInt32LE(body + 8);
    } else if (id === "data") {
      if (byteRate <= 0) return null;
      // A streamed WAV may carry 0 or 0xFFFFFFFF as the size: trust the file size then.
      const available = Math.max(0, fileSize - body);
      const bytes = size === 0 || size === 0xffffffff || size > available ? available : size;
      return bytes / byteRate;
    }
    offset = body + size + (size % 2);
  }
  return null;
}

export async function readWavDuration(file: string): Promise<number | null> {
  let handle;
  try {
    handle = await open(file, "r");
    const { size } = await handle.stat();
    const head = Buffer.alloc(Math.min(size, 65536));
    const { bytesRead } = await handle.read(head, 0, head.length, 0);
    const duration = wavDurationFromHeader(head.subarray(0, bytesRead), size);
    return duration !== null && duration > 0 ? duration : null;
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
}
