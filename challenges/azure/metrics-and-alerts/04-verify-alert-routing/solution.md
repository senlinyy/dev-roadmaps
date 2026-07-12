```bash
az monitor metrics alert show --name alert-orders-api-failure-rate --resource-group rg-devpolaris-observability-prod
az monitor action-group show --name ag-orders-oncall --resource-group rg-devpolaris-observability-prod
az monitor metrics list --resource /subscriptions/sub-devpolaris-training/resourceGroups/rg-devpolaris-app-prod/providers/Microsoft.App/containerApps/ca-devpolaris-orders-prod --metric FailedRequests
```
