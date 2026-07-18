```yaml
canary:
  first_slice_percent: 1
  watch_window_minutes: 10
  metrics_by_release: true
  stop_rules:
    - signal: 5xx_rate
      comparison: canary_above_stable
      action: stop
    - signal: checkout_success
      comparison: canary_below_stable
      action: stop
    - signal: p95_latency
      comparison: canary_above_stable
      action: stop
    - signal: new_error_pattern
      comparison: present_in_canary_only
      action: stop
promotion:
  keep_previous_task_set: true
```

The rules encode the signal, comparison, and action separately, so automation can evaluate the policy without parsing prose. Comparing canary with stable also controls for unrelated service-wide movement during the watch window.
