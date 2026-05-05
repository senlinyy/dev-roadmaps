```bash
az role assignment list --assignee mi-orders-api-prod
```

The role assignment proves the app identity has Key Vault secret access at the vault scope, without storing a password in the app.
