import type { ApplicationConfig } from "@angular/core";
import { provideRouter, withComponentInputBinding, withHashLocation } from "@angular/router";
import { routes } from "./app.routes";

// Angular 22 is zoneless by default: no zone.js and no extra provider needed.
export const appConfig: ApplicationConfig = {
  providers: [provideRouter(routes, withHashLocation(), withComponentInputBinding())],
};
