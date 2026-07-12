```bash
az monitor app-insights component show --app appi-devpolaris-orders-prod --resource-group rg-devpolaris-observability-prod
az monitor app-insights query --app appi-devpolaris-orders-prod --analytics-query "requests | take 5"
az monitor app-insights query --app appi-devpolaris-orders-prod --analytics-query "dependencies | take 5"
```
