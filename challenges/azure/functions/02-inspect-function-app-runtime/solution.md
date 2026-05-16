One way to inspect the function app is:

```bash
az functionapp show --name func-devpolaris-orders-jobs-prod --resource-group rg-devpolaris-orders-prod
az functionapp config appsettings list --name func-devpolaris-orders-jobs-prod --resource-group rg-devpolaris-orders-prod
az functionapp function list --function-app-name func-devpolaris-orders-jobs-prod --resource-group rg-devpolaris-orders-prod
```
