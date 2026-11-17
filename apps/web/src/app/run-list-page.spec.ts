import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RunListPage } from "./run-list-page";

const index = {
  schemaVersion: 1,
  runs: [
    {
      taskId: "3f0a6f0e-5b0e-4d3c-9d55-0f6f1c2a7b11",
      title: "Brighten the vocal",
      createdAt: "2026-11-02T10:15:00.000Z",
      pass: true,
      attempts: 2,
    },
    {
      taskId: "9a1b2c3d-4e5f-4a6b-8c7d-1e2f3a4b5c6d",
      title: "Tame the kick",
      createdAt: "2026-11-01T09:00:00.000Z",
      pass: false,
      attempts: 1,
    },
  ],
};

async function render(body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body)));
  vi.stubGlobal("fetch", fetchMock);
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  const fixture = TestBed.createComponent(RunListPage);
  await fixture.whenStable();
  fixture.detectChanges();
  return { el: fixture.nativeElement as HTMLElement, fetchMock };
}

describe("RunListPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("lists the runs with title, result, attempts and a link to the run", async () => {
    const { el, fetchMock } = await render(index);
    const rows = el.querySelectorAll("a.run-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain("Brighten the vocal");
    expect(rows[0]?.textContent).toContain("pass");
    expect(rows[0]?.textContent).toContain("2 attempts");
    expect(rows[1]?.textContent).toContain("fail");
    expect(rows[1]?.textContent).toContain("1 attempt");
    expect(rows[0]?.getAttribute("href")).toBe(`/runs/${index.runs[0]?.taskId}`);
    const url = (fetchMock.mock.calls[0] as unknown[])[0] as URL;
    expect(url.pathname.endsWith("runs/index.json")).toBe(true);
  });

  it("shows 'No runs yet' for an empty index", async () => {
    const { el } = await render({ schemaVersion: 1, runs: [] });
    expect(el.textContent).toContain("No runs yet");
  });

  it("shows an error when the index does not validate", async () => {
    const { el } = await render({ schemaVersion: 1, runs: [{ title: "bad" }] });
    expect(el.textContent).toContain("Runs could not be loaded");
    expect(el.querySelectorAll("a.run-row")).toHaveLength(0);
  });
});
