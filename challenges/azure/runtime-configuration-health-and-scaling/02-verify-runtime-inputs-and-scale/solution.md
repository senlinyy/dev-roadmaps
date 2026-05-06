One way to gather the runtime evidence is:

```bash
az webapp config appsettings list --name app-devpolaris-orders-api-prod --resource-group rg-devpolaris-orders-prod
az webapp identity show --name app-devpolaris-orders-api-prod --resource-group rg-devpolaris-orders-prod
az containerapp revision list --name ca-devpolaris-orders-api-prod --resource-group rg-devpolaris-orders-prod
az containerapp ingress show --name ca-devpolaris-orders-api-prod --resource-group rg-devpolaris-orders-prod
az containerapp secret list --name ca-devpolaris-orders-api-prod --resource-group rg-devpolaris-orders-prod
az containerapp show --name ca-devpolaris-orders-api-prod --resource-group rg-devpolaris-orders-prod
```
