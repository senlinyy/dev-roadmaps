```yaml
runbook:
  service: devpolaris-orders-api
  release_id: rel-2026-04-30-184
  pre_checks:
    - artifact digest exists
    - staging runs same digest
    - production is healthy
    - production rollback target exists
    - required env vars exist
  owners:
    release_lead: Maya
    app_engineer: Theo
    platform_engineer: Iris
  stop_rules:
    - stop and revert if canary 5xx rate is higher than stable
    - stop and revert if checkout success drops below 98.5 percent
    - pause if p95 latency is twice stable
    - pause if logs show a new unclassified error pattern
  rollback_target:
    task_definition: orders-api:41
    image_digest: sha256:6447f5a96a80a87f19f6a6549e6dc03f63a2b8124c9d1c2f4a71f5b95ab9a621
```

The runbook makes the safe path repeatable. It says what to check, who owns decisions, when to stop, and where production can safely return.

