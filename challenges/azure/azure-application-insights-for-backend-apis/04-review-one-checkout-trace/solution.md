```bash
az monitor app-insights query --app appi-devpolaris-orders-prod --analytics-query "requests | where operation_Id == 'checkout-5001'"
az monitor app-insights query --app appi-devpolaris-orders-prod --analytics-query "dependencies | where operation_Id == 'checkout-5001'"
az monitor app-insights query --app appi-devpolaris-orders-prod --analytics-query "exceptions | where operation_Id == 'checkout-5001'"
az monitor app-insights query --app appi-devpolaris-orders-prod --analytics-query "traces | where operation_Id == 'checkout-5001'"
```

These commands gather current Azure observability evidence for the named resources. The useful part is the fields they expose, not the exact JSON layout.
