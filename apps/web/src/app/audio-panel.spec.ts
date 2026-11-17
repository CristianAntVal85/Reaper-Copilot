import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunPage } from "./run-page";
import { sampleRun, SAMPLE_TASK_ID } from "./run-fixture";

async function render() {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(sampleRun()))));
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  const fixture = TestBed.createComponent(RunPage);
  fixture.componentRef.setInput("taskId", SAMPLE_TASK_ID);
  await fixture.whenStable();
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

describe("audio panel", () => {
  // jsdom does not implement media playback.
  beforeEach(() => void vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("draws the waveform from the 800 min/max pairs", async () => {
    const { el } = await render();
    const svg = el.querySelector("svg.waveform") as SVGElement;
    expect(svg.getAttribute("preserveAspectRatio")).toBe("none");
    const points = el.querySelector("svg.waveform polygon")?.getAttribute("points") ?? "";
    expect(points.split(" ")).toHaveLength(1600);
  });

  it("moves the playhead on timeupdate", async () => {
    const { fixture, el } = await render();
    const audio = el.querySelectorAll("audio")[1] as HTMLAudioElement;
    const head = () => el.querySelectorAll("svg.waveform")[1]?.querySelector(".playhead") as Element;
    expect(head().getAttribute("x1")).toBe("0");
    audio.currentTime = 2.8235;
    audio.dispatchEvent(new Event("timeupdate"));
    fixture.detectChanges();
    expect(Number(head().getAttribute("x1"))).toBeCloseTo(400, 0);
    const slider = el.querySelectorAll("svg.waveform")[1]!;
    expect(Number(slider.getAttribute("aria-valuenow"))).toBeCloseTo(2.8235, 3);
  });

  it("seeks the audio when the waveform is clicked", async () => {
    const { fixture, el } = await render();
    const audio = el.querySelectorAll("audio")[0] as HTMLAudioElement;
    const svg = el.querySelectorAll("svg.waveform")[0] as SVGElement;
    svg.getBoundingClientRect = () => ({ left: 100, width: 400 }) as DOMRect;
    svg.dispatchEvent(new MouseEvent("click", { clientX: 300, bubbles: true }));
    fixture.detectChanges();
    expect(audio.currentTime).toBeCloseTo(5.647 / 2, 3);
  });

  it("seeks with the keyboard by 5 percent on short tracks", async () => {
    const { fixture, el } = await render();
    const audio = el.querySelectorAll("audio")[0] as HTMLAudioElement;
    const svg = el.querySelectorAll("svg.waveform")[0] as SVGElement;
    svg.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    fixture.detectChanges();
    expect(audio.currentTime).toBeCloseTo(5.647 * 0.05, 3);
  });

  it("draws two spectrum series of 96 points", async () => {
    const { el } = await render();
    const lines = el.querySelectorAll("svg[role=img] polyline.series");
    expect(lines).toHaveLength(2);
    for (const l of lines) expect(l.getAttribute("points")!.split(" ")).toHaveLength(96);
    expect(el.querySelector("svg[role=img]")?.getAttribute("aria-label")).toContain("Spectrum");
  });

  it("labels both players and shows the attempt in After", async () => {
    const { el } = await render();
    const audios = [...el.querySelectorAll("audio")];
    expect(audios).toHaveLength(2);
    for (const a of audios) {
      const id = a.getAttribute("aria-labelledby")!;
      expect(el.querySelector(`#${id}`)?.textContent?.trim()).toBeTruthy();
      expect(a.getAttribute("preload")).toBe("metadata");
    }
    expect(el.querySelector("#audio-before-label")?.textContent).toContain("Before (source)");
    expect(el.querySelector("#audio-after-label")?.textContent).toContain("After (attempt 2)");
  });

  it("changes the After src when another attempt is chosen", async () => {
    const { fixture, el } = await render();
    const after = () => el.querySelectorAll("audio")[1]?.getAttribute("src");
    expect(after()).toBe(`runs/${SAMPLE_TASK_ID}/render-2.mp3`);
    (el.querySelectorAll(".attempt-selector button")[0] as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(after()).toBe(`runs/${SAMPLE_TASK_ID}/render-1.mp3`);
    expect(el.querySelectorAll("audio")[0]?.getAttribute("src")).toBe(`runs/${SAMPLE_TASK_ID}/source.mp3`);
  });

  it("pauses the other player when one starts", async () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const { el } = await render();
    const [before, after] = [...el.querySelectorAll("audio")] as HTMLAudioElement[];
    const calls = () => pause.mock.contexts.slice();
    before!.dispatchEvent(new Event("play"));
    expect(calls()).toEqual([after]);
    after!.dispatchEvent(new Event("play"));
    expect(calls()).toEqual([after, before]);
  });

  it("pauses After and rewinds it when another attempt is chosen", async () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const { fixture, el } = await render();
    const after = el.querySelectorAll("audio")[1] as HTMLAudioElement;
    const head = () => el.querySelectorAll("svg.waveform")[1]?.querySelector(".playhead") as Element;
    after.currentTime = 2;
    after.dispatchEvent(new Event("timeupdate"));
    fixture.detectChanges();
    expect(Number(head().getAttribute("x1"))).toBeGreaterThan(0);
    pause.mockClear();
    (el.querySelectorAll(".attempt-selector button")[0] as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(pause.mock.contexts).toContain(after);
    expect(after.currentTime).toBe(0);
    expect(head().getAttribute("x1")).toBe("0");
  });

  it("marks the played part of the waveform and the slider orientation", async () => {
    const { fixture, el } = await render();
    const svg = el.querySelectorAll("svg.waveform")[1]!;
    expect(svg.getAttribute("aria-orientation")).toBe("horizontal");
    const audio = el.querySelectorAll("audio")[1] as HTMLAudioElement;
    audio.currentTime = 2.8235;
    audio.dispatchEvent(new Event("timeupdate"));
    fixture.detectChanges();
    const played = svg.querySelector("polygon.played")!;
    const clipId = /url\(#(.+)\)/.exec(played.getAttribute("clip-path") ?? "")?.[1];
    const rect = svg.querySelector(`clipPath[id="${clipId}"] rect`)!;
    expect(Number(rect.getAttribute("width"))).toBeCloseTo(400, 0);
  });

  it("labels the spectrum axes in HTML and marks 20 Hz and 20 kHz", async () => {
    const { el } = await render();
    const text = el.querySelector("figure.spectrum")!.textContent ?? "";
    expect(text).toContain("Frequency (Hz");
    expect(text).toContain("Level (dB, relative to full scale)");
    const ticks = [...el.querySelectorAll(".x-labels .axis-tick")].map((t) => t.textContent?.trim());
    expect(ticks).toEqual(["20 Hz", "100", "1k", "10k", "20k"]);
    expect(el.querySelector("svg[role=img] text")).toBeNull();
  });
});
