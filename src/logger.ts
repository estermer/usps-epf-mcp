type LogLevel = "silent" | "info" | "debug";

interface LogRecord {
  ts: string;
  level: "info" | "debug";
  event: string;
  [key: string]: unknown;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  silent: 0,
  info: 1,
  debug: 2,
};

function currentLevel(): LogLevel {
  const raw = process.env.EPF_LOG_LEVEL ?? "info";
  if (raw === "silent" || raw === "info" || raw === "debug") return raw;
  return "info";
}

function emit(level: "info" | "debug", event: string, fields: Record<string, unknown>): void {
  if (LEVEL_ORDER[currentLevel()] < LEVEL_ORDER[level]) return;
  const record: LogRecord = {
    ts: new Date().toISOString(),
    level,
    event,
    ...fields,
  };
  process.stderr.write(JSON.stringify(record) + "\n");
}

export const logger = {
  info: (event: string, fields: Record<string, unknown> = {}) =>
    emit("info", event, fields),
  debug: (event: string, fields: Record<string, unknown> = {}) =>
    emit("debug", event, fields),
};
