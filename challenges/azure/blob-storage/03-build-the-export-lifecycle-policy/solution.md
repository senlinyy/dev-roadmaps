### `lifecycle-policy.json`

```json
{
  "rules": [
    {
      "enabled": true,
      "name": "orders-export-retention",
      "type": "Lifecycle",
      "definition": {
        "actions": {
          "baseBlob": {
            "tierToCool": { "daysAfterModificationGreaterThan": 30 },
            "tierToArchive": { "daysAfterModificationGreaterThan": 90 },
            "delete": { "daysAfterModificationGreaterThan": 365 }
          }
        },
        "filters": {
          "blobTypes": ["blockBlob"],
          "prefixMatch": ["exports/daily/"]
        }
      }
    }
  ]
}
```
