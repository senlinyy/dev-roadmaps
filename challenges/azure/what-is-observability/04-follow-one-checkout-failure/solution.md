```bash
az monitor app-insights query --app appi-devpolaris-orders-prod --analytics-query "requests | where operation_Id == 'checkout-5001'"
az monitor app-insights query --app appi-devpolaris-orders-prod --analytics-query "dependencies | where operation_Id == 'checkout-5001'"
az monitor app-insights query --app appi-devpolaris-orders-prod --analytics-query "exceptions | where operation_Id == 'checkout-5001'"
az monitor log-analytics query --workspace law-devpolaris-prod --analytics-query "ContainerAppConsoleLogs_CL | where OperationId == 'checkout-5001'"
```
