Use RBAC evidence for the managed identity that reads the vault.

---

The useful evidence should show `mi-orders-api-prod`, `Key Vault Secrets User`, and the vault scope.

---

This checks access to secret metadata and values through Azure RBAC. It should not expose the secret value.
