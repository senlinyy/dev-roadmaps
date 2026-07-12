```bash
az cosmosdb show --name cosmos-devpolaris-orders-prod --resource-group rg-devpolaris-data-prod
az cosmosdb sql database show --account-name cosmos-devpolaris-orders-prod --name orders-events --resource-group rg-devpolaris-data-prod
az cosmosdb sql container show --account-name cosmos-devpolaris-orders-prod --database-name orders-events --name idempotency-keys --resource-group rg-devpolaris-data-prod
az cosmosdb sql container show --account-name cosmos-devpolaris-orders-prod --database-name orders-events --name job-status --resource-group rg-devpolaris-data-prod
```
