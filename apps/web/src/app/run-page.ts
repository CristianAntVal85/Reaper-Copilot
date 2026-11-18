import { DatePipe, DecimalPipe } from "@angular/common";
import { Component, computed, effect, inject, input, signal, untracked } from "@angular/core";
import { RouterLink } from "@angular/router";
import type { ReplayRun } from "@reaper-copilot/core";
import { AudioPanel } from "./audio-panel";
import { basisLabel, formatRange, formatTarget, formatValue, METRIC_LABELS } from "./metric-labels";
import { RunsService } from "./runs.service";

const DATE_FORMAT = "yyyy-MM-dd HH:mm 'UTC'";

type RunState = { kind: "loading" } | { kind: "error" } | { kind: "ready"; run: ReplayRun };

@Component({
  selector: "app-run-page",
  imports: [RouterLink, DatePipe, DecimalPipe, AudioPanel],
  template: `
    @switch (state().kind) {
      @case ("loading") {
        <p class="message">Loading run...</p>
      }
      @case ("error") {
        <p class="message error" role="alert">This run could not be loaded</p>
        <p><a routerLink="/">Back to runs</a></p>
      }
    }
    @if (run(); as r) {
      <p><a routerLink="/">Back to runs</a></p>
      <header class="run-header">
        <h1>{{ r.title }}</h1>
        <div class="original-request">
          <p class="request-label" id="request-label">
            Original request <span class="run-meta">(as typed by the user)</span>
          </p>
          <p class="request" aria-labelledby="request-label" title="as typed by the user">{{ r.request }}</p>
        </div>
        <dl class="run-facts">
          <dt>Target</dt>
          <dd>{{ targetText() }}</dd>
          <dt>Date</dt>
          <dd>{{ r.createdAt | date: DATE_FORMAT : "UTC" }}</dd>
          <dt>Final result</dt>
          <dd>
            <span class="badge result-badge" [class.pass]="lastPass()" [class.fail]="!lastPass()">{{
              lastPass() ? "Pass" : "Fail"
            }}</span>
          </dd>
          <dt>Attempts</dt>
          <dd>{{ r.verifications.length }}</dd>
        </dl>
      </header>

      @if (attempt(); as a) {
        <app-audio-panel [run]="r" [attempt]="a" />
      }

      <section aria-labelledby="criteria-heading">
        <h2 id="criteria-heading">Criteria</h2>
        <div class="attempt-selector" role="group" aria-label="Attempt">
          @for (v of r.verifications; track v.attempt; let i = $index) {
            <button
              type="button"
              [attr.aria-pressed]="selectedIndex() === i"
              [class.selected]="selectedIndex() === i"
              (click)="selectAttempt(i)"
            >
              Attempt {{ v.attempt }}
            </button>
          }
        </div>
        @if (attempt(); as a) {
          <div class="table-scroll" role="region" tabindex="0" [attr.aria-label]="'Criteria table, attempt ' + a.attempt">
          <table class="criteria">
            <caption class="sr-only">
              Criteria for attempt {{ a.attempt }}
            </caption>
            <thead>
              <tr>
                <th scope="col">Criterion</th>
                <th scope="col">Metric</th>
                <th scope="col">Basis</th>
                <th scope="col">Measured</th>
                <th scope="col">Source → render</th>
                <th scope="col">Range</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              @for (c of a.results; track c.id) {
                <tr>
                  <th scope="row">
                    {{ c.id }}
                    @if (c.derived) {
                      <span class="tag">derived</span>
                    }
                  </th>
                  <td>{{ metricLabel(c.metric) }}</td>
                  <td>{{ basisText(c.basis) }}</td>
                  <td class="num">{{ value(c.metric, c.measured) }}</td>
                  <td class="num">
                    @if (c.basis === "delta") {
                      {{ value(c.metric, c.sourceValue) }} → {{ value(c.metric, c.renderValue) }}
                    } @else {
                      —
                    }
                  </td>
                  <td class="num">{{ range(c.metric, c.min, c.max) }}</td>
                  <td>
                    <span [class]="'status ' + c.status">{{ c.status }}</span>
                  </td>
                </tr>
              }
            </tbody>
          </table>
          </div>
          <ul class="legend-notes">
            <li><strong>derived</strong>: a criterion added automatically from the target.</li>
            <li><strong>change vs source</strong>: the render value minus the source value.</li>
            <li>
              <strong>unmeasured</strong>: the tempo could not be measured with enough confidence, so it does
              not count as a failure.
            </li>
          </ul>
        }
      </section>

      <section aria-labelledby="steps-heading">
        <h2 id="steps-heading">Steps</h2>
        <ol class="steps">
          @for (s of r.steps; track s.step) {
            <li>
              <details>
                <summary>
                  <span class="step-n">#{{ s.step }}</span>
                  <span class="step-tool">{{ s.tool }}</span>
                  <span class="step-status" [class.fail]="!s.ok">{{
                    s.ok ? "ok" : s.errorCode
                  }}</span>
                  <span class="run-meta">{{ s.durationMs | number: "1.0-0" }} ms</span>
                  <span class="run-meta">{{ s.startedAt | date: "HH:mm:ss 'UTC'" : "UTC" }}</span>
                </summary>
                <h3>Arguments</h3>
                <pre>{{ json(s.args) }}</pre>
                <h3>Result</h3>
                <pre>{{ json(s.result) }}</pre>
              </details>
            </li>
          }
        </ol>
      </section>
    }
  `,
})
export class RunPage {
  protected readonly DATE_FORMAT = DATE_FORMAT;

  readonly taskId = input.required<string>();

  private readonly runs = inject(RunsService);
  private readonly state = signal<RunState>({ kind: "loading" });
  private readonly selection = signal<number | null>(null);

  readonly run = computed(() => {
    const s = this.state();
    return s.kind === "ready" ? s.run : null;
  });

  /** Index into `run.verifications` of the chosen attempt; the last one until the user picks. */
  readonly selectedIndex = computed(() => {
    const r = this.run();
    if (r === null) return -1;
    return this.selection() ?? r.verifications.length - 1;
  });

  /** The chosen verification (attempt); T6 reads its `render` for the audio panel. */
  readonly attempt = computed(() => this.run()?.verifications[this.selectedIndex()] ?? null);

  readonly lastPass = computed(() => this.run()?.verifications.at(-1)?.pass ?? false);
  readonly targetText = computed(() => {
    const r = this.run();
    return r === null ? "—" : formatTarget(r.target);
  });

  protected readonly metricLabel = (m: keyof typeof METRIC_LABELS) => METRIC_LABELS[m];
  protected readonly basisText = basisLabel;
  protected readonly value = formatValue;
  protected readonly range = formatRange;
  protected json(x: unknown): string {
    return JSON.stringify(x, null, 2);
  }

  private loadSeq = 0;

  constructor() {
    // Reload whenever the route's taskId changes: the router reuses this component when only
    // the hash changes (another run pasted in the same tab, back/forward).
    effect(() => {
      const taskId = this.taskId();
      untracked(() => void this.load(taskId));
    });
  }

  selectAttempt(index: number): void {
    this.selection.set(index);
  }

  private async load(taskId: string): Promise<void> {
    const seq = ++this.loadSeq;
    this.state.set({ kind: "loading" });
    this.selection.set(null);
    try {
      const run = await this.runs.loadRun(taskId);
      if (seq === this.loadSeq) this.state.set({ kind: "ready", run });
    } catch (error) {
      if (seq !== this.loadSeq) return; // a newer navigation owns the page
      console.error("Failed to load run", error);
      this.state.set({ kind: "error" });
    }
  }
}
