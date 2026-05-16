```bash
az monitor log-analytics workspace show --workspace-name law-devpolaris-prod --resource-group rg-devpolaris-observability-prod
az monitor diagnostic-settings list --resource /subscriptions/sub-devpolaris-training/resourceGroups/rg-devpolaris-app-prod/providers/Microsoft.App/containerApps/ca-devpolaris-orders-prod
az monitor diagnostic-settings list --resource /subscriptions/sub-devpolaris-training/resourceGroups/rg-devpolaris-network-prod/providers/Microsoft.Network/applicationGateways/agw-devpolaris-prod
```

These commands gather current Azure observability evidence for the named resources. The useful part is the fields they expose, not the exact JSON layout.
