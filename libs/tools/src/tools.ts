import { analyzeAudio } from "./analyze-audio.ts";
import { applyFxChain } from "./apply-fx-chain.ts";
import { compareAudio } from "./compare-audio.ts";
import { getJobStatus } from "./get-job-status.ts";
import { getProjectState } from "./get-project-state.ts";
import { importAudio } from "./import-audio.ts";
import { listPresets } from "./list-presets.ts";
import { renderSelection } from "./render-selection.ts";
import { setTempo } from "./set-tempo.ts";
import { sliceLoop } from "./slice-loop.ts";
import { startTask } from "./start-task.ts";
import { timeStretch } from "./time-stretch.ts";
import type { AnyToolDefinition } from "./tool-definition.ts";
import { undoLast } from "./undo-last.ts";
import { verifyTask } from "./verify-task.ts";

/** Every tool the copilot defines; transports register this list through a registry. */
export const ALL_TOOLS: readonly AnyToolDefinition[] = [
  analyzeAudio,
  compareAudio,
  getProjectState,
  listPresets,
  getJobStatus,
  importAudio,
  setTempo,
  sliceLoop,
  timeStretch,
  applyFxChain,
  renderSelection,
  undoLast,
  startTask,
  verifyTask,
];
