### `orders-http5xx-alert.json`

```json
{
  "location": "global",
  "properties": {
    "description": "Page the orders team on sustained server errors",
    "severity": 1,
    "enabled": true,
    "scopes": [
      "/subscriptions/sub-prod/resourceGroups/rg-devpolaris-orders-prod/providers/Microsoft.Web/sites/app-devpolaris-orders-prod"
    ],
    "evaluationFrequency": "PT1M",
    "windowSize": "PT5M",
    "criteria": {
      "odata.type": "Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria",
      "allOf": [
        {
          "name": "http-5xx-total",
          "metricNamespace": "Microsoft.Web/sites",
          "metricName": "Http5xx",
          "dimensions": [],
          "operator": "GreaterThan",
          "threshold": 25,
          "timeAggregation": "Total",
          "criterionType": "StaticThresholdCriterion"
        }
      ]
    },
    "actions": [
      {
        "actionGroupId": "/subscriptions/sub-prod/resourceGroups/rg-devpolaris-observability-prod/providers/Microsoft.Insights/actionGroups/ag-devpolaris-orders-oncall"
      }
    ]
  }
}
```
