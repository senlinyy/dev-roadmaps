```bash
az monitor log-analytics workspace show --workspace-name law-devpolaris-prod --resource-group rg-devpolaris-observability-prod
az monitor app-insights component show --app appi-devpolaris-orders-prod --resource-group rg-devpolaris-observability-prod
az monitor metrics list --resource /subscriptions/sub-devpolaris-training/resourceGroups/rg-devpolaris-app-prod/providers/Microsoft.App/containerApps/ca-devpolaris-orders-prod --metric Requests,FailedRequests
```

These commands gather current Azure observability evidence for the named resources. The useful part is the fields they expose, not the exact JSON layout.
