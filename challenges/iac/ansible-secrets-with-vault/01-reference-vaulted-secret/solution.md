### group_vars/prod/main.yml

```yaml
orders_api_token: "{{ vault_orders_api_token }}"
orders_api_port: 8080
```

### group_vars/prod/vault.yml

```yaml
vault_orders_api_token: "$ANSIBLE_VAULT;1.1;AES256..."
```

The reviewed variable file now names the setting without exposing the actual secret value.
