```bash
az disk show --name disk-orders-legacy-data-01 --resource-group rg-devpolaris-data-prod
az storage share-rm show --storage-account stdevpolarisordersprod --name legacy-orders-share --resource-group rg-devpolaris-storage-prod
az storage account show --name stdevpolarisordersprod --resource-group rg-devpolaris-storage-prod
```

These commands gather the current Azure evidence for the resources named in the prompt. A real team would paste the important fields into the release or incident record.
