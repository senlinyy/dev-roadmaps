Run one possible evidence pass:

```bash
az network nsg rule list --resource-group rg-devpolaris-network-prod --nsg-name nsg-orders-api --output table
```

The rule list shows the first matching allow rule and the later deny rule that prevents direct Internet access.
