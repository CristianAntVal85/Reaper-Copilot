import { Component, computed, input } from "@angular/core";
import type { ReplayAssets } from "@reaper-copilot/core";

type SpectrumData = ReplayAssets["spectrum"];

const W = 800;
const H = 300;
const PAD = { x: 4, y: 6 };
const F_MIN = 20;
const F_MAX = 20000;
// Axis text lives in HTML, outside the scaled SVG, so it stays at a readable size on small screens.
const TICKS = [
  { hz: 20, label: "20 Hz", edge: "first" },
  { hz: 100, label: "100", edge: "" },
  { hz: 1000, label: "1k", edge: "" },
  { hz: 10000, label: "10k", edge: "optional" },
  { hz: 20000, label: "20k", edge: "last" },
];

@Component({
  selector: "app-spectrum",
  template: `
    <figure class="spectrum">
      <p class="axis-title">Level (dB, relative to full scale)</p>
      <div class="spectrum-plot">
        <div class="y-labels" aria-hidden="true">
          @for (t of yTicks(); track t.db) {
            <span class="axis-tick" [style.top.%]="t.pct">{{ t.db }}</span>
          }
        </div>
        <svg
          role="img"
          aria-label="Spectrum before and after, 20 Hz to 20 kHz, logarithmic frequency axis"
          [attr.viewBox]="'0 0 ' + w + ' ' + h"
          preserveAspectRatio="none"
        >
          <title>Spectrum before and after</title>
          @for (t of yTicks(); track t.db) {
            <line class="grid" [attr.x1]="0" [attr.x2]="w" [attr.y1]="t.y" [attr.y2]="t.y" />
          }
          @for (t of xTicks; track t.hz) {
            <line class="grid" [attr.x1]="xOf(t.hz)" [attr.x2]="xOf(t.hz)" y1="0" [attr.y2]="h" />
          }
          <polyline class="series before" [attr.points]="beforePoints()" fill="none" />
          <polyline class="series after" [attr.points]="afterPoints()" fill="none" />
        </svg>
        <div class="x-labels" aria-hidden="true">
          @for (t of xTicks; track t.hz) {
            <span [class]="'axis-tick ' + t.edge" [style.left.%]="(xOf(t.hz) / w) * 100">{{
              t.label
            }}</span>
          }
        </div>
      </div>
      <p class="axis-title centered">Frequency (Hz, logarithmic)</p>
      <figcaption class="legend">
        <span class="legend-item"
          ><svg width="28" height="8" aria-hidden="true"><line class="series before" x1="0" x2="28" y1="4" y2="4" /></svg>
          Before</span
        >
        <span class="legend-item"
          ><svg width="28" height="8" aria-hidden="true"><line class="series after" x1="0" x2="28" y1="4" y2="4" /></svg>
          After</span
        >
      </figcaption>
    </figure>
  `,
})
export class Spectrum {
  readonly before = input.required<SpectrumData>();
  readonly after = input.required<SpectrumData>();

  protected readonly w = W;
  protected readonly h = H;
  protected readonly xTicks = TICKS;

  /** Y range from the data: rounded-up max down to a floor 60 dB below, never under -120. */
  private readonly range = computed(() => {
    const peak = Math.max(...this.before().db, ...this.after().db);
    const hi = Math.ceil(peak / 10) * 10;
    const lo = Math.max(hi - 60, -120);
    return { hi, lo: lo < hi ? lo : hi - 10 };
  });

  protected xOf(hz: number): number {
    const r = Math.log(hz / F_MIN) / Math.log(F_MAX / F_MIN);
    return PAD.x + r * (W - 2 * PAD.x);
  }

  private yOf(db: number): number {
    const { hi, lo } = this.range();
    const r = (Math.min(Math.max(db, lo), hi) - lo) / (hi - lo);
    return PAD.y + (1 - r) * (H - 2 * PAD.y);
  }

  protected readonly yTicks = computed(() => {
    const { hi, lo } = this.range();
    const out: { db: number; y: number; pct: number }[] = [];
    for (let db = hi; db >= lo; db -= 20) {
      const y = this.yOf(db);
      out.push({ db, y, pct: (y / H) * 100 });
    }
    return out;
  });

  private toPoints(s: SpectrumData): string {
    return s.freqHz
      .map((f, i) => `${this.xOf(f).toFixed(2)},${this.yOf(s.db[i] ?? -120).toFixed(2)}`)
      .join(" ");
  }

  protected readonly beforePoints = computed(() => this.toPoints(this.before()));
  protected readonly afterPoints = computed(() => this.toPoints(this.after()));
}
