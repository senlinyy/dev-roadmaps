One way to compare the resources is:

```bash
az webapp show --name app-devpolaris-orders-api-prod --resource-group rg-devpolaris-orders-prod
az containerapp show --name ca-devpolaris-orders-api-prod --resource-group rg-devpolaris-orders-prod
az containerapp revision list --name ca-devpolaris-orders-api-prod --resource-group rg-devpolaris-orders-prod
az functionapp function list --function-app-name func-devpolaris-orders-jobs-prod --resource-group rg-devpolaris-orders-prod
az vm show --name vm-devpolaris-orders-legacy-01 --resource-group rg-devpolaris-orders-prod
```
