export type LogLevel = "debug" | "info" | "warn" | "error";

const PREFIX = "[jobgraph-agent]";

export function createLogger(scope: string) {
  function log(level: LogLevel, message: string, meta?: Record<string, unknown>) {
    const line = `${PREFIX} [${scope}] ${message}`;
    const payload = meta && Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
    const full = `${line}${payload}`;
    if (level === "error") console.error(full);
    else if (level === "warn") console.warn(full);
    else console.log(full);
  }
  return {
    debug: (m: string, meta?: Record<string, unknown>) => log("debug", m, meta),
    info: (m: string, meta?: Record<string, unknown>) => log("info", m, meta),
    warn: (m: string, meta?: Record<string, unknown>) => log("warn", m, meta),
    error: (m: string, meta?: Record<string, unknown>) => log("error", m, meta),
  };
}
