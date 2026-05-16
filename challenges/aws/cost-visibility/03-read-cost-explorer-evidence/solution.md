```bash
aws ce get-cost-and-usage --time-period Start=2026-05-01,End=2026-06-01 --granularity MONTHLY --metrics UnblendedCost --group-by Type=TAG,Key=service
```

Cost Explorer is useful when it turns "AWS got expensive" into a smaller question: which owner, service, or tag moved?
