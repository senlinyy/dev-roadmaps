```bash
az sql db show --server sql-devpolaris-orders-prod --name sqldb-devpolaris-orders-prod --resource-group rg-devpolaris-data-prod
az sql db ltr-policy show --server sql-devpolaris-orders-prod --database sqldb-devpolaris-orders-prod --resource-group rg-devpolaris-data-prod
az storage account blob-service-properties show --account-name stdevpolarisordersprod --resource-group rg-devpolaris-storage-prod
az storage account management-policy show --account-name stdevpolarisordersprod --resource-group rg-devpolaris-storage-prod
az cosmosdb sql container show --account-name cosmos-devpolaris-orders-prod --database-name orders-events --name job-status --resource-group rg-devpolaris-data-prod
az storage share-rm show --storage-account stdevpolarisordersprod --name legacy-orders-share --resource-group rg-devpolaris-storage-prod
```

These commands gather the current Azure evidence for the resources named in the prompt. A real team would paste the important fields into the release or incident record.
