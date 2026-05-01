```yaml
verification:
  window:
    start: 2026-04-30T21:00:00Z
    end: 2026-04-30T21:15:00Z
  metrics:
    - name: 5xx rate
      target: below 0.2%
      observed: 0.03%
    - name: checkout success
      target: above 99.0%
      observed: 99.5%
    - name: p95 latency
      target: below 250 ms
      observed: 190 ms
    - name: payment provider errors
      target: no increase
      observed: no increase
    - name: new error pattern
      target: none
      observed: none
final_state:
  production_task_definition: orders-api:42
  traffic_percent: 100
  verified_by: Maya
  verified_at: 2026-04-30T21:15:00Z
```

This is the difference between "looks good" and release evidence. The final state tells the next engineer exactly what production is running.

