```bash
az containerapp identity show --name ca-orders-api-prod --resource-group rg-devpolaris-orders-prod
az role assignment list --assignee mi-orders-api-prod
az keyvault secret show --vault-name kv-devpolaris-prod --name orders-sql-connection
```

The evidence shows the caller identity, the permission path, and the secret metadata separately. That separation is the main habit from the identity and security mental model.
