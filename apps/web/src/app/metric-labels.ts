import type { CriterionResult, FeatureMetric, TaskTarget } from "@reaper-copilot/core";

export const METRIC_LABELS: Record<FeatureMetric, string> = {
  "file.durationSec": "Duration (s)",
  "tempo.bpm": "Tempo (BPM)",
  "loudness.integratedLufs": "Integrated loudness (LUFS)",
  "loudness.peakDb": "Peak level (dB)",
  "bands.sub": "Sub band (dB)",
  "bands.bass": "Bass band (dB)",
  "bands.lowMid": "Low-mid band (dB)",
  "bands.mid": "Mid band (dB)",
  "bands.highMid": "High-mid band (dB)",
  "bands.high": "High band (dB)",
  "dynamics.crestFactorDb": "Crest factor (dB)",
};

export function basisLabel(basis: CriterionResult["basis"]): string {
  return basis === "delta" ? "change vs source" : "absolute";
}

/** 3 decimals for the duration, 2 for everything else. */
export function formatValue(metric: FeatureMetric, value: number | null): string {
  if (value === null) return "—";
  return value.toFixed(metric === "file.durationSec" ? 3 : 2);
}

export function formatRange(metric: FeatureMetric, min: number | null, max: number | null): string {
  return `${formatValue(metric, min)}..${formatValue(metric, max)}`;
}

export function formatTarget(target: TaskTarget): string {
  const parts: string[] = [];
  if (target.bpm !== undefined) parts.push(`${target.bpm} BPM`);
  if (target.bars !== undefined) {
    parts.push(`${target.bars} ${target.bars === 1 ? "bar" : "bars"} (${target.beatsPerBar ?? 4}/4)`);
  }
  return parts.length === 0 ? "—" : parts.join(" · ");
}
