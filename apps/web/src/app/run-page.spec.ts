import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RunPage } from "./run-page";
import { sampleRun, SAMPLE_TASK_ID } from "./run-fixture";

async function render(body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body)));
  vi.stubGlobal("fetch", fetchMock);
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  const fixture = TestBed.createComponent(RunPage);
  fixture.componentRef.setInput("taskId", SAMPLE_TASK_ID);
  await fixture.whenStable();
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement, fetchMock };
}

describe("RunPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows header, both attempts, the last one selected, and its measured values", async () => {
    const { el, fetchMock } = await render(sampleRun());
    const url = (fetchMock.mock.calls[0] as unknown[])[0] as URL;
    expect(url.pathname.endsWith(`runs/${SAMPLE_TASK_ID}/run.json`)).toBe(true);
    expect(el.textContent).toContain("170 BPM · 4 bars (4/4)");
    expect(el.querySelector(".result-badge")?.textContent).toContain("Pass");
    const buttons = [...el.querySelectorAll(".attempt-selector button")];
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(["Attempt 1", "Attempt 2"]);
    expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "true"]);
    const table = el.querySelector("table.criteria") as HTMLElement;
    expect(table.textContent).toContain("170.10");
    expect(table.textContent).toContain("6.25");
    expect(table.textContent).toContain("Tempo (BPM)");
    expect(table.textContent).toContain("change vs source");
    expect(table.textContent).toContain("-35.00 → -28.75");
    expect(table.textContent).toContain("3.00..—");
    expect(table.textContent).toContain("derived");
    expect(table.textContent).not.toContain("150.25");
  });

  it("changes the table when another attempt is chosen", async () => {
    const { fixture, el } = await render(sampleRun());
    (el.querySelectorAll(".attempt-selector button")[0] as HTMLButtonElement).click();
    fixture.detectChanges();
    const table = el.querySelector("table.criteria") as HTMLElement;
    expect(table.textContent).toContain("150.25");
    expect(table.textContent).not.toContain("170.10");
    expect(table.textContent).toContain("fail");
    expect(fixture.componentInstance.attempt()?.attempt).toBe(1);
  });

  it("renders markup in request and args as literal text", async () => {
    const evil = "<script>alert(1)</script>";
    const { el } = await render(sampleRun({ request: evil }));
    expect(el.querySelector(".request")?.textContent).toBe(evil);
    const pres = [...el.querySelectorAll("pre")].map((p) => p.textContent);
    expect(pres.some((t) => t?.includes(evil))).toBe(true);
    expect(el.textContent).toContain(evil);
    expect(el.querySelector("script")).toBeNull();
  });

  it("shows an error and a link back when the run does not validate", async () => {
    const { el } = await render({ schemaVersion: 1, title: "bad" });
    expect(el.textContent).toContain("This run could not be loaded");
    expect(el.querySelector("a")?.getAttribute("href")).toBe("/");
  });

  it("shows the title, the original request with its label and a UTC date", async () => {
    const { el } = await render(sampleRun({ request: "Haz un loop a 170 BPM" }));
    expect(el.querySelector("h1")?.textContent).toBe(sampleRun().title);
    expect(el.querySelector(".request-label")?.textContent).toContain("Original request");
    const req = el.querySelector(".request") as HTMLElement;
    expect(req.textContent).toBe("Haz un loop a 170 BPM");
    expect(req.hasAttribute("lang")).toBe(false);
    expect(el.textContent).toContain("2026-11-02 10:15 UTC");
  });

  it("scrolls the table inside a labelled focusable region and explains the tags", async () => {
    const { el } = await render(sampleRun());
    const region = el.querySelector(".table-scroll") as HTMLElement;
    expect(region.getAttribute("role")).toBe("region");
    expect(region.getAttribute("tabindex")).toBe("0");
    expect(region.getAttribute("aria-label")).toContain("Criteria");
    expect(region.querySelector("table.criteria")).not.toBeNull();
    const notes = el.querySelector(".legend-notes")?.textContent ?? "";
    for (const word of ["derived", "change vs source", "unmeasured"]) expect(notes).toContain(word);
  });

  it("logs the cause when the run cannot be loaded", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await render({ schemaVersion: 1, title: "bad" });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
