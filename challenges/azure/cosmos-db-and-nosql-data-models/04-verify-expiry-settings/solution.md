```bash
az cosmosdb sql container show --account-name cosmos-devpolaris-orders-prod --database-name orders-events --name idempotency-keys --resource-group rg-devpolaris-data-prod
az cosmosdb sql container show --account-name cosmos-devpolaris-orders-prod --database-name orders-events --name job-status --resource-group rg-devpolaris-data-prod
```

These commands gather the current Azure evidence for the resources named in the prompt. A real team would paste the important fields into the release or incident record.
