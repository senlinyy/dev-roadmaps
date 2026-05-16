One way to inspect the App Service runtime is:

```bash
az webapp show --name app-devpolaris-orders-api-prod --resource-group rg-devpolaris-orders-prod
az webapp config appsettings list --name app-devpolaris-orders-api-prod --resource-group rg-devpolaris-orders-prod
az webapp identity show --name app-devpolaris-orders-api-prod --resource-group rg-devpolaris-orders-prod
az webapp deployment slot list --name app-devpolaris-orders-api-prod --resource-group rg-devpolaris-orders-prod
```
