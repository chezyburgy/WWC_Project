import client from 'prom-client';

export const register = new client.Registry();
client.collectDefaultMetrics({ register });

export const eventsProcessed = new client.Counter({
  name: 'events_processed_total',
  help: 'Total number of events processed',
  labelNames: ['service', 'eventType', 'status'] as const,
});
register.registerMetric(eventsProcessed);

export const processingDuration = new client.Histogram({
  name: 'event_processing_duration_seconds',
  help: 'Histogram of event processing durations',
  labelNames: ['service', 'eventType'] as const,
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
});
register.registerMetric(processingDuration);

export function metricsMiddleware() {
  return async (_req: any, res: any) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  };
}
