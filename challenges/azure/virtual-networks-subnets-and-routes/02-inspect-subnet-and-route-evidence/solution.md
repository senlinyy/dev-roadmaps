Run one possible evidence pass:

```bash
az network vnet subnet show --resource-group rg-devpolaris-network-prod --vnet-name vnet-devpolaris-prod --name snet-orders-api
az network route-table route list --resource-group rg-devpolaris-network-prod --route-table-name rt-orders-private --output table
```

The subnet output shows the placement and attached route table. The route list shows where matching traffic goes next.
