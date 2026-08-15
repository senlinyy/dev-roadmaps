### `order-events.schema.json`

```json
[
  { "name": "event_id", "type": "STRING", "mode": "REQUIRED" },
  { "name": "order_id", "type": "STRING", "mode": "REQUIRED" },
  { "name": "event_type", "type": "STRING", "mode": "REQUIRED" },
  { "name": "occurred_at", "type": "TIMESTAMP", "mode": "REQUIRED" },
  { "name": "amount", "type": "NUMERIC", "mode": "NULLABLE" },
  { "name": "attributes", "type": "JSON", "mode": "NULLABLE" }
]
```
