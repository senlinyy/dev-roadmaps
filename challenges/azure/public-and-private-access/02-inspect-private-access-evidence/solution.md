Run one possible evidence pass:

```bash
az network private-endpoint show --resource-group rg-devpolaris-data-prod --name pe-orders-sql
az network private-dns record-set a show --resource-group rg-devpolaris-network-prod --zone-name privatelink.database.windows.net --name devpolaris-orders-sql
```

The private endpoint output shows the approved private connection. The private DNS output shows the name that should resolve to the private IP.
