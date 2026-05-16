```bash
az containerapp identity show --name ca-orders-api-prod --resource-group rg-devpolaris-orders-prod
az identity show --name mi-orders-api-prod --resource-group rg-devpolaris-orders-prod
```

The output connects the running app to the managed identity and shows the principal ID that Azure RBAC evaluates.
