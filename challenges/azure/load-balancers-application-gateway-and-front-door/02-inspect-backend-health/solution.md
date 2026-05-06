Run one possible evidence pass:

```bash
az network application-gateway show-backend-health --resource-group rg-devpolaris-network-prod --name agw-orders-prod
```

Backend health tells you whether the entry point has usable API copies behind it. One copy is healthy and one is failing the health probe.
