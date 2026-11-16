import { describe, expect, it } from "vitest";
import { wavDurationFromHeader } from "./wav.ts";

function header(options: { sampleRate: number; dataBytes: number; extra?: Buffer; dataSize?: number }): Buffer {
  const fmt = Buffer.alloc(24);
  fmt.write("fmt ", 0);
  fmt.writeUInt32LE(16, 4);
  fmt.writeUInt16LE(1, 8);
  fmt.writeUInt16LE(1, 10);
  fmt.writeUInt32LE(options.sampleRate, 12);
  fmt.writeUInt32LE(options.sampleRate * 2, 16);
  fmt.writeUInt16LE(2, 20);
  fmt.writeUInt16LE(16, 22);
  const data = Buffer.alloc(8);
  data.write("data", 0);
  data.writeUInt32LE(options.dataSize ?? options.dataBytes, 4);
  const riff = Buffer.alloc(12);
  riff.write("RIFF", 0);
  riff.write("WAVE", 8);
  return Buffer.concat([riff, fmt, options.extra ?? Buffer.alloc(0), data]);
}

describe("wavDurationFromHeader", () => {
  it("reads the duration from the data chunk", () => {
    const head = header({ sampleRate: 8000, dataBytes: 16000 });
    expect(wavDurationFromHeader(head, head.length + 16000)).toBeCloseTo(1, 9);
  });

  it("skips extra chunks (odd sizes are padded)", () => {
    const list = Buffer.alloc(8 + 4);
    list.write("LIST", 0);
    list.writeUInt32LE(3, 4);
    const head = header({ sampleRate: 8000, dataBytes: 8000, extra: list });
    expect(wavDurationFromHeader(head, head.length + 8000)).toBeCloseTo(0.5, 9);
  });

  it("uses the file size when the data size is a streaming placeholder", () => {
    const head = header({ sampleRate: 8000, dataBytes: 0, dataSize: 0xffffffff });
    expect(wavDurationFromHeader(head, head.length + 4000)).toBeCloseTo(0.25, 9);
  });

  it("returns null for something that is not a WAV", () => {
    expect(wavDurationFromHeader(Buffer.from("not a wav file at all"), 21)).toBeNull();
    expect(wavDurationFromHeader(Buffer.alloc(4), 4)).toBeNull();
  });
});
