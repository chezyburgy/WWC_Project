import pino from 'pino';

export function createLogger(serviceName = process.env.SERVICE_NAME || 'app') {
  return pino({
    name: serviceName,
    level: process.env.LOG_LEVEL || 'info',
    transport: process.env.NODE_ENV === 'production' ? undefined : { target: 'pino-pretty' },
  });
}
