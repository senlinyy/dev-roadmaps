```bash
az role assignment list --assignee mi-orders-api-prod
```

The managed identity is the caller, and the Key Vault role assignment is the permission that lets it read the secret.
