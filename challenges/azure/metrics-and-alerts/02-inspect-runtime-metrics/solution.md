```bash
az monitor metrics list --resource /subscriptions/sub-devpolaris-training/resourceGroups/rg-devpolaris-app-prod/providers/Microsoft.App/containerApps/ca-devpolaris-orders-prod --metric Requests,FailedRequests,RequestDuration,Replicas
```

These commands gather current Azure observability evidence for the named resources. The useful part is the fields they expose, not the exact JSON layout.
