import { createLogger } from "./logger.js";

const log = createLogger("ApplyTelemetry");

export type FieldTelemetryPhase =
  | "detected"
  | "mapped"
  | "filled"
  | "select"
  | "radio"
  | "combobox"
  | "resume_upload"
  | "navigation"
  | "failure";

export interface FieldTelemetryEvent {
  phase: FieldTelemetryPhase;
  label?: string;
  selectorHint?: string;
  fieldKind?: string;
  profileKey?: string;
  value?: string;
  confidence?: number;
  reason?: string;
  failure?: string;
  iteration?: number;
}

/** Structured stdout lines for downstream logging / dashboards */
export function emitFieldTelemetry(event: FieldTelemetryEvent): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event });
  log.info(line);
  console.log(`[JG_APPLY_TELEMETRY] ${line}`);
}
