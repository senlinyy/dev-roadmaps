```bash
az storage blob list --account-name stdevpolarisordersprod --container-name exports --prefix exports/daily/2026/05/
az storage account blob-service-properties show --account-name stdevpolarisordersprod --resource-group rg-devpolaris-storage-prod
az storage account management-policy show --account-name stdevpolarisordersprod --resource-group rg-devpolaris-storage-prod
```

These commands gather the current Azure evidence for the resources named in the prompt. A real team would paste the important fields into the release or incident record.
