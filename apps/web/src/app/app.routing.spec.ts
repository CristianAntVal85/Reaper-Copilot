import { TestBed } from "@angular/core/testing";
import { RouterTestingHarness } from "@angular/router/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appConfig } from "./app.config";
import { sampleRun, SAMPLE_TASK_ID } from "./run-fixture";

describe("routing", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("binds :taskId to the run page input with the real app config so the run loads", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(sampleRun())));
    vi.stubGlobal("fetch", fetchMock);
    TestBed.configureTestingModule({ providers: appConfig.providers });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(`/runs/${SAMPLE_TASK_ID}`);
    const el = () => harness.routeNativeElement as HTMLElement;
    await vi.waitFor(() => {
      harness.detectChanges();
      expect(el().querySelector("h1")?.textContent).toBe(sampleRun().title);
    });
    expect(el().textContent).not.toContain("could not be loaded");
    const url = (fetchMock.mock.calls[0] as unknown[])[0] as URL;
    expect(url.pathname.endsWith(`runs/${SAMPLE_TASK_ID}/run.json`)).toBe(true);
  });

  it("reloads when only the taskId changes, and shows the error for an unknown run", async () => {
    const OTHER_ID = "11111111-2222-4333-8444-555555555555";
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const path = String(input);
      if (path.includes(SAMPLE_TASK_ID)) return new Response(JSON.stringify(sampleRun()));
      if (path.includes(OTHER_ID)) {
        return new Response(JSON.stringify(sampleRun({ taskId: OTHER_ID, title: "Other run" })));
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
    TestBed.configureTestingModule({ providers: appConfig.providers });
    const harness = await RouterTestingHarness.create();
    const text = () => (harness.routeNativeElement as HTMLElement).textContent ?? "";
    const h1 = () => (harness.routeNativeElement as HTMLElement).querySelector("h1")?.textContent;
    const until = (check: () => void) =>
      vi.waitFor(() => {
        harness.detectChanges();
        check();
      });

    await harness.navigateByUrl(`/runs/${SAMPLE_TASK_ID}`);
    await until(() => expect(h1()).toBe(sampleRun().title));

    await harness.navigateByUrl(`/runs/${OTHER_ID}`);
    await until(() => expect(h1()).toBe("Other run"));

    await harness.navigateByUrl("/runs/00000000-0000-4000-8000-000000000000");
    await until(() => expect(text()).toContain("could not be loaded"));
  });
});
