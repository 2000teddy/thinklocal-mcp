import pino from 'pino';

export function createLogger(level: string, name?: string): pino.Logger {
  return pino({
    level,
    name: name ?? 'thinklocal',
    transport:
      process.env['NODE_ENV'] !== 'production'
        ? { target: 'pino/file', options: { destination: 1 } }
        : undefined,
  });
}
