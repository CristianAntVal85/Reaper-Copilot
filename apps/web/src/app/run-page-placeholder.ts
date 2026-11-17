import { Component, input } from "@angular/core";
import { RouterLink } from "@angular/router";

// Replaced by the real run page in T5.
@Component({
  selector: "app-run-page-placeholder",
  imports: [RouterLink],
  template: `
    <p><a routerLink="/">Back to runs</a></p>
    <h1>Run {{ taskId() }}</h1>
    <p>Run details are coming soon.</p>
  `,
})
export class RunPagePlaceholder {
  readonly taskId = input.required<string>();
}
