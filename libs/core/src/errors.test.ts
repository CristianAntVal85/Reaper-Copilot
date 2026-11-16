import { describe, expect, it } from "vitest";
import { asAssetPath, CopilotError, COPILOT_ERROR_CODES } from "./index.ts";

describe("CopilotError", () => {
  it("carries a code from the closed list and prefixes the message with it", () => {
    const cause = new Error("boom");
    const error = new CopilotError("file_not_found", "no such file", { cause });
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("file_not_found");
    expect(error.message).toBe("file_not_found: no such file");
    expect(error.cause).toBe(cause);
    expect(COPILOT_ERROR_CODES).toHaveLength(6);
  });
});

describe("AssetPath", () => {
  it("is a branded string", () => {
    expect(asAssetPath("/ws/a.wav")).toBe("/ws/a.wav");
  });
});
