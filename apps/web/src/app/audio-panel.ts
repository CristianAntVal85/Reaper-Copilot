import { Component, computed, effect, ElementRef, input, signal, untracked, viewChild } from "@angular/core";
import type { ReplayVerification } from "@reaper-copilot/core";
import type { ReplayRun } from "@reaper-copilot/core";
import { Spectrum } from "./spectrum";
import { Waveform } from "./waveform";

@Component({
  selector: "app-audio-panel",
  imports: [Waveform, Spectrum],
  template: `
    <section aria-labelledby="audio-heading" class="audio-panel">
      <h2 id="audio-heading">Audio</h2>
      <div class="audio-blocks">
        <div class="audio-block">
          <h3 id="audio-before-label">Before (source)</h3>
          <audio
            #before
            (play)="after.pause()"
            controls
            preload="metadata"
            aria-labelledby="audio-before-label"
            [src]="beforeSrc()"
            (timeupdate)="beforeTime.set(before.currentTime)"
          ></audio>
          <app-waveform
            label="Waveform of the source"
            [assets]="run().source.assets"
            [currentTime]="beforeTime()"
            (seek)="before.currentTime = $event; beforeTime.set($event)"
          />
        </div>
        <div class="audio-block">
          <h3 id="audio-after-label">After (attempt {{ attempt().attempt }})</h3>
          <audio
            #after
            (play)="before.pause()"
            controls
            preload="metadata"
            aria-labelledby="audio-after-label"
            [src]="afterSrc()"
            (timeupdate)="afterTime.set(after.currentTime)"
          ></audio>
          <app-waveform
            [label]="'Waveform of attempt ' + attempt().attempt"
            [assets]="attempt().render.assets"
            [currentTime]="afterTime()"
            (seek)="after.currentTime = $event; afterTime.set($event)"
          />
        </div>
      </div>
      <app-spectrum [before]="run().source.assets.spectrum" [after]="attempt().render.assets.spectrum" />
    </section>
  `,
})
export class AudioPanel {
  readonly run = input.required<ReplayRun>();
  readonly attempt = input.required<ReplayVerification>();

  private readonly afterEl = viewChild<ElementRef<HTMLAudioElement>>("after");
  private shownAttempt: number | null = null;

  constructor() {
    // A new attempt is a different render: stop "After" and start it from the beginning.
    effect(() => {
      const attempt = this.attempt().attempt;
      untracked(() => {
        const previous = this.shownAttempt;
        this.shownAttempt = attempt;
        if (previous === null || previous === attempt) return;
        const audio = this.afterEl()?.nativeElement;
        if (audio) {
          audio.pause();
          audio.currentTime = 0;
        }
        this.afterTime.set(0);
      });
    });
  }

  protected readonly beforeTime = signal(0);
  protected readonly afterTime = signal(0);

  protected readonly beforeSrc = computed(() => this.src(this.run().source.file));
  protected readonly afterSrc = computed(() => this.src(this.attempt().render.file));

  private src(file: string): string {
    return `runs/${this.run().taskId}/${file}`;
  }
}
