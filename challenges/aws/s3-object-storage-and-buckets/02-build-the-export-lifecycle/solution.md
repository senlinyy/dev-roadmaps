### `lifecycle-configuration.json`

```json
{
  "Rules": [
    {
      "ID": "ReceiptRetention",
      "Status": "Enabled",
      "Filter": { "Prefix": "receipts/" },
      "Transitions": [
        { "Days": 30, "StorageClass": "STANDARD_IA" }
      ],
      "Expiration": { "Days": 365 },
      "NoncurrentVersionTransitions": [
        { "NoncurrentDays": 30, "StorageClass": "STANDARD_IA" }
      ],
      "NoncurrentVersionExpiration": { "NoncurrentDays": 90 },
      "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 7 }
    }
  ]
}
```
