### `runtime-config.yaml`

```yaml
name: ca-orders-api-prod
identity:
  type: UserAssigned
properties:
  configuration:
    secrets:
      - name: appinsights-connection
        keyVaultUrl: https://kv-devpolaris-prod.vault.azure.net/secrets/appinsights-orders
        identity: /subscriptions/sub-prod/resourceGroups/rg-devpolaris-prod/providers/Microsoft.ManagedIdentity/userAssignedIdentities/mi-orders-api-prod
  template:
    containers:
      - name: orders-api
        env:
          - name: LOG_LEVEL
            value: info
          - name: APPLICATIONINSIGHTS_CONNECTION_STRING
            secretRef: appinsights-connection
```
