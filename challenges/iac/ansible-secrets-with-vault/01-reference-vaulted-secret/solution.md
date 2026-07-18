### group_vars/prod/main.yml

```yaml
orders_api_token: "{{ vault_orders_api_token }}"
orders_api_port: 8080
```

The public name stays stable for playbooks, while the value is resolved from the encrypted Vault artifact only when Ansible decrypts it. The encrypted file is intentionally not hand-authored in the editor.
