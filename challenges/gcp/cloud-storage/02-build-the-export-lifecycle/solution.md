### `lifecycle.json`

```json
{
  "lifecycle": {
    "rule": [
      {
        "action": {
          "type": "SetStorageClass",
          "storageClass": "NEARLINE"
        },
        "condition": {
          "age": 30,
          "matchesPrefix": ["exports/daily/"],
          "isLive": true
        }
      },
      {
        "action": {
          "type": "Delete"
        },
        "condition": {
          "age": 365,
          "matchesPrefix": ["exports/daily/"],
          "isLive": true
        }
      }
    ]
  }
}
```
