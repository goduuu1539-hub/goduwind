type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const levels: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const envLevel = (process.env.LOG_LEVEL as LogLevel) || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');
let currentLevel: LogLevel = (['debug', 'info', 'warn', 'error'] as LogLevel[]).includes(
  envLevel as LogLevel,
)
  ? (envLevel as LogLevel)
  : 'debug';

function format(message: any, meta?: Record<string, any>) {
  const ts = new Date().toISOString();
  if (meta && Object.keys(meta).length) {
    return `[${ts}] ${message} ${JSON.stringify(meta)}\n`;
  }
  return `[${ts}] ${message}\n`;
}

export const logger = {
  setLevel(level: LogLevel) {
    if (level in levels) currentLevel = level;
  },
  debug(message: any, meta?: Record<string, any>) {
    if (levels[currentLevel] <= levels.debug) process.stdout.write(format(message, meta));
  },
  info(message: any, meta?: Record<string, any>) {
    if (levels[currentLevel] <= levels.info) process.stdout.write(format(message, meta));
  },
  warn(message: any, meta?: Record<string, any>) {
    if (levels[currentLevel] <= levels.warn) process.stderr.write(format(message, meta));
  },
  error(message: any, meta?: Record<string, any>) {
    if (levels[currentLevel] <= levels.error) process.stderr.write(format(message, meta));
  },
};

export type { LogLevel };
