Run one possible evidence pass:

```bash
az network dns record-set cname show --resource-group rg-devpolaris-dns-prod --zone-name devpolaris.com --name orders
az network dns record-set txt show --resource-group rg-devpolaris-dns-prod --zone-name devpolaris.com --name asuid.orders
```

The CNAME shows where browsers will go. The TXT record proves the domain ownership record expected by the Azure entry point.
