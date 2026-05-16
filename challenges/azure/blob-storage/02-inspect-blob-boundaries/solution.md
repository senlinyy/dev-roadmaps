```bash
az storage account show --name stdevpolarisordersprod --resource-group rg-devpolaris-storage-prod
az storage container show --account-name stdevpolarisordersprod --name receipts
az storage blob list --account-name stdevpolarisordersprod --container-name receipts
```

These commands gather the current Azure evidence for the resources named in the prompt. A real team would paste the important fields into the release or incident record.
