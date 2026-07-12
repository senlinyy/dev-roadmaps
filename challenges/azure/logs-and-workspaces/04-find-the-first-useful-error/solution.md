```bash
az monitor log-analytics query --workspace law-devpolaris-prod --analytics-query "ContainerAppConsoleLogs_CL | where OperationId == 'checkout-5001'"
az monitor log-analytics query --workspace law-devpolaris-prod --analytics-query "AzureDiagnostics | where OperationId == 'checkout-5001'"
```
