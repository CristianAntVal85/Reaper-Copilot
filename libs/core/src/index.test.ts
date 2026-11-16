import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION } from "./index.ts";

describe("core", () => {
  it("exposes the schema version", () => {
    expect(SCHEMA_VERSION).toBe(2);
  });
});
