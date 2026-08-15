### `orders-dashboard.json`

```json
{
  "widgets": [
    {
      "type": "metric",
      "x": 0,
      "y": 0,
      "width": 12,
      "height": 6,
      "properties": {
        "title": "Orders API traffic, errors, and latency",
        "region": "eu-west-2",
        "period": 60,
        "metrics": [
          ["AWS/ApplicationELB", "RequestCount", "LoadBalancer", "app/orders-api/1234", { "stat": "Sum" }],
          ["AWS/ApplicationELB", "HTTPCode_Target_5XX_Count", "LoadBalancer", "app/orders-api/1234", { "stat": "Sum" }],
          ["AWS/ApplicationELB", "TargetResponseTime", "LoadBalancer", "app/orders-api/1234", { "stat": "p95" }]
        ]
      }
    }
  ]
}
```
