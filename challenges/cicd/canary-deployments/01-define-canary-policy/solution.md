```yaml
canary:
  first_slice_percent: 1
  watch_window_minutes: 10
  metrics_by_release: true
  stop_rules:
    - stop if canary 5xx rate is higher than stable
    - stop if checkout success drops below stable
    - stop if canary p95 latency is much worse than stable
    - stop if logs show a new error pattern
promotion:
  keep_previous_task_set: true
```

The policy makes the first production move small and observable. Splitting metrics by release keeps the stable traffic from hiding a bad canary.

