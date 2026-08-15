### `logger.js`

```javascript
const levels = new Set(["info", "warn", "error"]);

export function createLogRecord(input, now = () => new Date().toISOString()) {
  if (!levels.has(input.level)) throw new Error("invalid level");
  if (typeof input.requestId !== "string" || input.requestId.length === 0) throw new Error("requestId is required");
  if (typeof input.route !== "string" || input.route.length === 0) throw new Error("route is required");
  const record = {
    timestamp: now(),
    level: input.level,
    service: "orders-api",
    environment: input.environment,
    requestId: input.requestId,
    route: input.route,
    outcome: input.outcome,
    durationMs: input.durationMs
  };
  if (typeof input.errorName === "string" && input.errorName.length > 0) record.errorName = input.errorName;
  return record;
}
```
