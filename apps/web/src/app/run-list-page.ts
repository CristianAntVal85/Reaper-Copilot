import { DatePipe } from "@angular/common";
import { Component, inject, signal } from "@angular/core";
import { RouterLink } from "@angular/router";
import type { ReplayIndexEntry } from "@reaper-copilot/core";
import { RunsService } from "./runs.service";

type ListState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; runs: readonly ReplayIndexEntry[] };

@Component({
  selector: "app-run-list-page",
  imports: [RouterLink, DatePipe],
  template: `
    <h1>Runs</h1>
    @switch (state().kind) {
      @case ("loading") {
        <p class="message">Loading runs...</p>
      }
      @case ("error") {
        <p class="message error" role="alert">Runs could not be loaded</p>
      }
    }
    @if (readyRuns(); as runs) {
      @if (runs.length === 0) {
        <p class="message">No runs yet</p>
      } @else {
        <ul class="run-list">
          @for (run of runs; track run.taskId) {
            <li>
              <a class="run-row" [routerLink]="['/runs', run.taskId]">
                <span class="run-title">{{ run.title }}</span>
                <span class="run-meta">{{ run.createdAt | date: "medium" }}</span>
                <span class="badge" [class.pass]="run.pass" [class.fail]="!run.pass">{{
                  run.pass ? "pass" : "fail"
                }}</span>
                <span class="run-meta"
                  >{{ run.attempts }} {{ run.attempts === 1 ? "attempt" : "attempts" }}</span
                >
              </a>
            </li>
          }
        </ul>
      }
    }
  `,
})
export class RunListPage {
  private readonly runsService = inject(RunsService);
  protected readonly state = signal<ListState>({ kind: "loading" });

  protected readonly readyRuns = () => {
    const s = this.state();
    return s.kind === "ready" ? s.runs : null;
  };

  constructor() {
    this.runsService.loadIndex().then(
      (index) => this.state.set({ kind: "ready", runs: index.runs }),
      () => this.state.set({ kind: "error" }),
    );
  }
}
