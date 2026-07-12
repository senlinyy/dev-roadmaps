```bash
az storage account show --name stdevpolarisordersprod --resource-group rg-devpolaris-storage-prod
az storage container show --account-name stdevpolarisordersprod --name receipts
az storage blob list --account-name stdevpolarisordersprod --container-name receipts
```
