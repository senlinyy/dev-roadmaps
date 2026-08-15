### `slot-settings.json`

```json
[
  { "name": "APP_ENV", "value": "staging", "slotSetting": true },
  { "name": "PAYMENTS_API_URL", "value": "https://payments.internal", "slotSetting": false },
  {
    "name": "DB_PASSWORD",
    "value": "@Microsoft.KeyVault(SecretUri=https://kv-orders-prod.vault.azure.net/secrets/db-password)",
    "slotSetting": true
  }
]
```
