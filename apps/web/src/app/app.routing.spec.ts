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
    await harness.fixture.whenStable();
    harness.detectChanges();
    await harness.fixture.whenStable();
    harness.detectChanges();
    const el = harness.routeNativeElement as HTMLElement;
    expect(el.querySelector("h1")?.textContent).toBe(sampleRun().title);
    expect(el.textContent).not.toContain("could not be loaded");
    const url = (fetchMock.mock.calls[0] as unknown[])[0] as URL;
    expect(url.pathname.endsWith(`runs/${SAMPLE_TASK_ID}/run.json`)).toBe(true);
  });
});
