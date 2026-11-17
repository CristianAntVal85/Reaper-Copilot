import { Injectable } from "@angular/core";
import { ReplayIndexSchema, type ReplayIndex } from "@reaper-copilot/core";

@Injectable({ providedIn: "root" })
export class RunsService {
  /** Loads runs/index.json relative to the document base and validates it with the shared schema. */
  async loadIndex(): Promise<ReplayIndex> {
    const url = new URL("runs/index.json", document.baseURI);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to load ${url.pathname}: HTTP ${response.status}`);
    return ReplayIndexSchema.parse(await response.json());
  }
}
