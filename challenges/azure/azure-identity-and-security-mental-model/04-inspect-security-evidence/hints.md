Start with the runtime caller, then check the permission, then check the secret metadata.

---

The app identity evidence should name `ca-orders-api-prod` and `mi-orders-api-prod`.

---

For the permission evidence, look for assignments for `mi-orders-api-prod` or its principal ID. For the secret evidence, inspect `orders-sql-connection` in `kv-devpolaris-prod`.
