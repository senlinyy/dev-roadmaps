Run one possible evidence pass:

```bash
az network vnet show --resource-group rg-devpolaris-network-prod --name vnet-devpolaris-prod
az network vnet subnet show --resource-group rg-devpolaris-network-prod --vnet-name vnet-devpolaris-prod --name snet-orders-api
az network private-endpoint show --resource-group rg-devpolaris-data-prod --name pe-orders-sql
az network private-dns record-set a show --resource-group rg-devpolaris-network-prod --zone-name privatelink.database.windows.net --name devpolaris-orders-sql
```

This gathers the path evidence before changing any rule. The subnet shows attached controls, and the private endpoint plus DNS record show the private SQL destination.
