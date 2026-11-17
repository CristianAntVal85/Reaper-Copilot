import type { Routes } from "@angular/router";
import { RunListPage } from "./run-list-page";
import { RunPagePlaceholder } from "./run-page-placeholder";

export const routes: Routes = [
  { path: "", component: RunListPage },
  { path: "runs/:taskId", component: RunPagePlaceholder },
  { path: "**", redirectTo: "" },
];
