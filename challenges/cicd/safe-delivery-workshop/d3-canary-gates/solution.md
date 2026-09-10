## Reference solution

This is a reviewable implementation for the stated fixture, not an execution-verified production deployment. Substitute environment-specific identifiers consistently before any live use. Keep unchanged fixture files alongside the files below.

### scripts/gate.py

```python
import json
import sys
import math
from datetime import datetime

def evaluate(data):
    if data.get("NextToken"):
        return "insufficient-data"
    rows = {row["Id"]: row for row in data.get("MetricDataResults", [])}
    values = {}
    window = None
    for release in ("baseline", "candidate"):
        for metric in ("requests", "success", "latency"):
            key = release + "_" + metric
            row = rows.get(key, {})
            samples = row.get("Values", [])
            timestamps = row.get("Timestamps", [])
            if row.get("StatusCode") != "Complete" or len(samples) < 5 or len(samples) != len(timestamps):
                return "insufficient-data"
            try:
                times = sorted(datetime.fromisoformat(t.replace('Z', '+00:00')).timestamp() for t in timestamps)
            except (ValueError, TypeError):
                return 'insufficient-data'
            if len(set(times)) != len(times) or any(b - a != 60 for a, b in zip(times, times[1:])):
                return 'insufficient-data'
            if window is None:
                window = times
            elif times != window:
                return 'insufficient-data'
            if any(not isinstance(x, (int, float)) or not math.isfinite(x) or x < 0 for x in samples):
                return "insufficient-data"
            values[key] = sum(samples) if metric != "latency" else max(samples)
        if values[release + "_requests"] < 100:
            return "insufficient-data"
        if values[release + "_success"] > values[release + "_requests"]:
            return "insufficient-data"
    baseline = values["baseline_success"] / values["baseline_requests"]
    candidate = values["candidate_success"] / values["candidate_requests"]
    if candidate < 0.99 or candidate < baseline - 0.01:
        return "degraded"
    if values["candidate_latency"] > max(300, values["baseline_latency"] * 1.2):
        return "degraded"
    return "healthy"

if __name__ == "__main__":
    with open(sys.argv[1]) as source:
        outcome = evaluate(json.load(source))
    print(outcome)
    sys.exit(0 if outcome == "healthy" else 1)
```

### cloudwatch/queries.json

```json
[
  {
    "Id": "baseline_requests",
    "MetricStat": {
      "Metric": {
        "Namespace": "Orders",
        "MetricName": "RequestCount",
        "Dimensions": [
          {
            "Name": "Release",
            "Value": "baseline"
          }
        ]
      },
      "Period": 60,
      "Stat": "Sum"
    },
    "ReturnData": true
  },
  {
    "Id": "baseline_success",
    "MetricStat": {
      "Metric": {
        "Namespace": "Orders",
        "MetricName": "OrderSuccess",
        "Dimensions": [
          {
            "Name": "Release",
            "Value": "baseline"
          }
        ]
      },
      "Period": 60,
      "Stat": "Sum"
    },
    "ReturnData": true
  },
  {
    "Id": "baseline_latency",
    "MetricStat": {
      "Metric": {
        "Namespace": "Orders",
        "MetricName": "Latency",
        "Dimensions": [
          {
            "Name": "Release",
            "Value": "baseline"
          }
        ]
      },
      "Period": 60,
      "Stat": "p95"
    },
    "ReturnData": true
  },
  {
    "Id": "candidate_requests",
    "MetricStat": {
      "Metric": {
        "Namespace": "Orders",
        "MetricName": "RequestCount",
        "Dimensions": [
          {
            "Name": "Release",
            "Value": "candidate"
          }
        ]
      },
      "Period": 60,
      "Stat": "Sum"
    },
    "ReturnData": true
  },
  {
    "Id": "candidate_success",
    "MetricStat": {
      "Metric": {
        "Namespace": "Orders",
        "MetricName": "OrderSuccess",
        "Dimensions": [
          {
            "Name": "Release",
            "Value": "candidate"
          }
        ]
      },
      "Period": 60,
      "Stat": "Sum"
    },
    "ReturnData": true
  },
  {
    "Id": "candidate_latency",
    "MetricStat": {
      "Metric": {
        "Namespace": "Orders",
        "MetricName": "Latency",
        "Dimensions": [
          {
            "Name": "Release",
            "Value": "candidate"
          }
        ]
      },
      "Period": 60,
      "Stat": "p95"
    },
    "ReturnData": true
  }
]
```

### ecs/update.json

```json
{
  "cluster": "orders",
  "service": "orders",
  "deploymentController": {
    "type": "ECS"
  },
  "deploymentConfiguration": {
    "strategy": "CANARY",
    "canaryConfiguration": {
      "canaryPercent": 10,
      "canaryBakeTime": 10
    },
    "bakeTimeInMinutes": 15,
    "alarms": {
      "alarmNames": [
        "orders-release-errors"
      ],
      "enable": true,
      "rollback": true
    },
    "lifecycleHooks": [
      {
        "targetType": "PAUSE",
        "lifecycleStages": [
          "PRE_PRODUCTION_TRAFFIC_SHIFT"
        ],
        "timeoutConfiguration": {
          "timeoutInMinutes": 30,
          "action": "ROLLBACK"
        }
      }
    ]
  },
  "loadBalancers": [
    {
      "targetGroupArn": "arn:aws:elasticloadbalancing:eu-west-1:222222222222:targetgroup/orders-blue/1111111111111111",
      "containerName": "orders",
      "containerPort": 3000,
      "advancedConfiguration": {
        "alternateTargetGroupArn": "arn:aws:elasticloadbalancing:eu-west-1:222222222222:targetgroup/orders-green/2222222222222222",
        "productionListenerRule": "arn:aws:elasticloadbalancing:eu-west-1:222222222222:listener-rule/app/orders/1111111111111111/2222222222222222/3333333333333333",
        "testListenerRule": "arn:aws:elasticloadbalancing:eu-west-1:222222222222:listener-rule/app/orders/1111111111111111/4444444444444444/5555555555555555",
        "roleArn": "arn:aws:iam::222222222222:role/orders-elb-management"
      }
    }
  ]
}
```

## Why this works

Canary safety depends on measuring a meaningful cohort over enough time. Compare candidate and baseline over the same complete minutes; a sparse sample is inability to decide, not success. Business success and latency can reveal regressions hidden by HTTP status. Native ECS canary pauses recur before traffic shifts, so the operator must distinguish initial exposure from the final shift and bind the decision to the active deployment.

## Verification and expected evidence

Query cloudwatch get-metric-data with the supplied queries and explicit start/end times covering complete minutes after the 10% shift; replace cohort labels with actual release IDs. Run `python3 scripts/gate.py metrics.json`. The recurring pause happens before each shift: authorize the first shift after preflight, and authorize the full shift only with healthy canary evidence via ContinueServiceDeployment for that deployment's hook ID. Never auto-continue a nonzero gate. Replay a lowered success count, too few requests and missing minutes. Replay the three supplied evidence JSON files with the gate: healthy exits 0, degraded and insufficient exit 1. They are historical authored fixtures; only newly queried release-scoped data can authorize a live shift.

## Self-review

- [ ] Healthy, degraded and insufficient-data outcomes are distinguishable.
- [ ] The gate compares the same bounded observation window for the two release cohorts.
- [ ] An unhealthy or incomplete result never authorizes full traffic.

Equivalent implementations are welcome when they preserve these outcomes and failure boundaries. Do not widen permissions or suppress failures to match a green result.

## References

- [Official reference 1](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deploy-canary-service.html)
- [Official reference 2](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/pause-lifecycle-hooks.html)
- [Official reference 3](https://docs.aws.amazon.com/AmazonCloudWatch/latest/APIReference/API_GetMetricData.html)
