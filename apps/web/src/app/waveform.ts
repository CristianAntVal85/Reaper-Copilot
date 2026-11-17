import { Component, computed, input, output } from "@angular/core";
import type { ReplayAssets } from "@reaper-copilot/core";

const WIDTH = 800;
const HEIGHT = 100;
let nextId = 0;

@Component({
  selector: "app-waveform",
  template: `
    <svg
      class="waveform"
      role="slider"
      aria-orientation="horizontal"
      tabindex="0"
      [attr.aria-label]="label()"
      aria-valuemin="0"
      [attr.aria-valuemax]="duration()"
      [attr.aria-valuenow]="clampedTime()"
      [attr.aria-valuetext]="clampedTime().toFixed(1) + ' s of ' + duration().toFixed(1) + ' s'"
      [attr.viewBox]="'0 0 ' + width + ' ' + height"
      preserveAspectRatio="none"
      (click)="onClick($event)"
      (keydown)="onKey($event)"
    >
      <defs>
        <clipPath [attr.id]="clipId">
          <rect x="0" y="0" [attr.width]="playheadX()" [attr.height]="height" />
        </clipPath>
      </defs>
      <polygon class="wave" [attr.points]="points()" />
      <polygon class="wave played" [attr.points]="points()" [attr.clip-path]="'url(#' + clipId + ')'" />
      <line class="playhead" [attr.x1]="playheadX()" [attr.x2]="playheadX()" y1="0" [attr.y2]="height" />
    </svg>
  `,
})
export class Waveform {
  readonly assets = input.required<ReplayAssets>();
  readonly currentTime = input(0);
  readonly label = input("Waveform");
  readonly seek = output<number>();

  protected readonly clipId = `wave-played-${nextId++}`;
  protected readonly width = WIDTH;
  protected readonly height = HEIGHT;

  protected readonly duration = computed(() => this.assets().durationSec);
  protected readonly clampedTime = computed(() =>
    Math.min(Math.max(this.currentTime(), 0), this.duration()),
  );
  protected readonly playheadX = computed(() =>
    this.duration() > 0 ? (this.clampedTime() / this.duration()) * WIDTH : 0,
  );

  protected readonly points = computed(() => {
    const { min, max } = this.assets().waveform;
    const n = max.length;
    const x = (i: number) => ((i / Math.max(n - 1, 1)) * WIDTH).toFixed(2);
    const y = (v: number) => ((1 - Math.min(Math.max(v, -1), 1)) * (HEIGHT / 2)).toFixed(2);
    const top = max.map((v, i) => `${x(i)},${y(v)}`);
    const bottom = min.map((v, i) => `${x(i)},${y(v)}`).reverse();
    return [...top, ...bottom].join(" ");
  });

  protected onClick(event: MouseEvent): void {
    const rect = (event.currentTarget as Element).getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
    this.seek.emit(ratio * this.duration());
  }

  protected onKey(event: KeyboardEvent): void {
    const d = this.duration();
    const step = d < 50 ? d * 0.05 : 5;
    let target: number;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") target = this.clampedTime() + step;
    else if (event.key === "ArrowLeft" || event.key === "ArrowDown") target = this.clampedTime() - step;
    else if (event.key === "Home") target = 0;
    else if (event.key === "End") target = d;
    else return;
    event.preventDefault();
    this.seek.emit(Math.min(Math.max(target, 0), d));
  }
}
