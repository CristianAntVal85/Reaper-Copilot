import { Component, computed, input } from "@angular/core";
import type { ReplayAssets } from "@reaper-copilot/core";

type SpectrumData = ReplayAssets["spectrum"];

const W = 800;
const H = 300;
const PAD = { left: 48, right: 12, top: 12, bottom: 28 };
const F_MIN = 20;
const F_MAX = 20000;
const TICKS = [
  { hz: 100, label: "100 Hz" },
  { hz: 1000, label: "1 kHz" },
  { hz: 10000, label: "10 kHz" },
];

@Component({
  selector: "app-spectrum",
  template: `
    <figure class="spectrum">
      <svg
        role="img"
        aria-label="Spectrum before and after, 20 Hz to 20 kHz, logarithmic frequency axis"
        [attr.viewBox]="'0 0 ' + w + ' ' + h"
        preserveAspectRatio="none"
      >
        <title>Spectrum before and after</title>
        @for (t of yTicks(); track t.db) {
          <line class="grid" [attr.x1]="left" [attr.x2]="w - right" [attr.y1]="t.y" [attr.y2]="t.y" />
          <text class="tick" [attr.x]="left - 6" [attr.y]="t.y + 4" text-anchor="end">{{ t.db }} dB</text>
        }
        @for (t of xTicks; track t.hz) {
          <line class="grid" [attr.x1]="xOf(t.hz)" [attr.x2]="xOf(t.hz)" [attr.y1]="top" [attr.y2]="h - bottom" />
          <text class="tick" [attr.x]="xOf(t.hz)" [attr.y]="h - 8" text-anchor="middle">{{ t.label }}</text>
        }
        <polyline class="series before" [attr.points]="beforePoints()" fill="none" />
        <polyline class="series after" [attr.points]="afterPoints()" fill="none" />
      </svg>
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
  protected readonly left = PAD.left;
  protected readonly right = PAD.right;
  protected readonly top = PAD.top;
  protected readonly bottom = PAD.bottom;
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
    return PAD.left + r * (W - PAD.left - PAD.right);
  }

  private yOf(db: number): number {
    const { hi, lo } = this.range();
    const r = (Math.min(Math.max(db, lo), hi) - lo) / (hi - lo);
    return PAD.top + (1 - r) * (H - PAD.top - PAD.bottom);
  }

  protected readonly yTicks = computed(() => {
    const { hi, lo } = this.range();
    const out: { db: number; y: number }[] = [];
    for (let db = hi; db >= lo; db -= 20) out.push({ db, y: this.yOf(db) });
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
