### `orders-api.containerapp.yaml`

```yaml
name: orders-api
resourceGroup: rg-orders-prod
location: uksouth
identity:
  type: SystemAssigned
properties:
  managedEnvironmentId: /subscriptions/sub-prod/resourceGroups/rg-orders-prod/providers/Microsoft.App/managedEnvironments/orders-prod
  configuration:
    activeRevisionsMode: Multiple
    ingress:
      external: true
      targetPort: 3000
    secrets:
      - name: payments-token
        keyVaultUrl: https://kv-orders-prod.vault.azure.net/secrets/payments-token
        identity: system
  template:
    containers:
      - name: orders-api
        image: ghcr.io/devpolaris/orders-api:2026.08.1
        env:
          - name: PAYMENTS_API_TOKEN
            secretRef: payments-token
        resources:
          cpu: 0.5
          memory: 1Gi
    scale:
      minReplicas: 2
      maxReplicas: 10
```
