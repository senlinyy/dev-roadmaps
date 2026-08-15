### `orders-5xx-alert.json`

```json
{
  "displayName": "orders-api sustained 5xx",
  "enabled": true,
  "combiner": "OR",
  "conditions": [
    {
      "displayName": "More than 25 errors in five minutes",
      "conditionThreshold": {
        "filter": "metric.type=\"run.googleapis.com/request_count\" AND resource.labels.service_name=\"orders-api\" AND resource.labels.project_id=\"devpolaris-prod\" AND metric.labels.response_code_class=\"5xx\"",
        "comparison": "COMPARISON_GT",
        "thresholdValue": 25,
        "duration": "300s",
        "aggregations": [
          {
            "alignmentPeriod": "300s",
            "perSeriesAligner": "ALIGN_SUM"
          }
        ]
      }
    }
  ],
  "notificationChannels": [
    "projects/devpolaris-prod/notificationChannels/oncall-primary"
  ]
}
```
