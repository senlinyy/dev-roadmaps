```bash
az network private-endpoint show --resource-group rg-devpolaris-data-prod --name pe-orders-sql
az network private-dns record-set a show --resource-group rg-devpolaris-network-prod --zone-name privatelink.database.windows.net --name devpolaris-orders-sql
```
