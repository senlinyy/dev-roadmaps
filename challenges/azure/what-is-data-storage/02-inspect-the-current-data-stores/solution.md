```bash
az storage account show --name stdevpolarisordersprod --resource-group rg-devpolaris-storage-prod
az sql db show --server sql-devpolaris-orders-prod --name sqldb-devpolaris-orders-prod --resource-group rg-devpolaris-data-prod
az cosmosdb show --name cosmos-devpolaris-orders-prod --resource-group rg-devpolaris-data-prod
az disk show --name disk-orders-legacy-data-01 --resource-group rg-devpolaris-data-prod
```

These commands gather the current Azure evidence for the resources named in the prompt. A real team would paste the important fields into the release or incident record.
