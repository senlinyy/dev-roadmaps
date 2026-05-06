One way to inspect the container app is:

```bash
az containerapp show --name ca-devpolaris-orders-api-prod --resource-group rg-devpolaris-orders-prod
az containerapp revision list --name ca-devpolaris-orders-api-prod --resource-group rg-devpolaris-orders-prod
az containerapp ingress show --name ca-devpolaris-orders-api-prod --resource-group rg-devpolaris-orders-prod
az containerapp secret list --name ca-devpolaris-orders-api-prod --resource-group rg-devpolaris-orders-prod
```
