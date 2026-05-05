```bash
az role assignment create --assignee mi-orders-api-prod --role "Storage Blob Data Contributor" --scope /subscriptions/sub-devpolaris-training/resourceGroups/rg-devpolaris-orders-prod/providers/Microsoft.Storage/storageAccounts/stdevpolarisexports
```

The assignment gives the app the storage data-plane permission it needs at the storage account scope, not at the whole subscription.
