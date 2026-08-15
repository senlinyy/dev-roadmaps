### `access-workbook.yaml`

```yaml
environment: production
humans:
  group: support-prod-readers
  access: read-only
  reviewCadence: quarterly
workloads:
  orders-api:
    identityType: system-assigned-managed-identity
    role: Key Vault Secrets User
    scope: kv-orders-prod
pipelines:
  azure-devops-prod:
    authentication: workload-identity-federation
    clientSecret: absent
```
