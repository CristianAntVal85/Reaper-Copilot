import type { Routes } from "@angular/router";
import { RunListPage } from "./run-list-page";
import { RunPage } from "./run-page";

export const routes: Routes = [
  { path: "", component: RunListPage },
  { path: "runs/:taskId", component: RunPage },
  { path: "**", redirectTo: "" },
];
