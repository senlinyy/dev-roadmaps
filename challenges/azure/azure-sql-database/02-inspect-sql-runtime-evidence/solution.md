```bash
az sql server show --name sql-devpolaris-orders-prod --resource-group rg-devpolaris-data-prod
az sql db show --server sql-devpolaris-orders-prod --name sqldb-devpolaris-orders-prod --resource-group rg-devpolaris-data-prod
az sql server firewall-rule list --server sql-devpolaris-orders-prod --resource-group rg-devpolaris-data-prod
```

These commands gather the current Azure evidence for the resources named in the prompt. A real team would paste the important fields into the release or incident record.
