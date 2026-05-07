---
title: "Reference Vaulted Secret"
sectionSlug: "where-secrets-belong-in-the-orders-playbook"
order: 1
---

Move the runtime API token reference away from plaintext group vars and point it at a vaulted variable.

Requirements:

1. **Public var file:** `orders_api_token: "{{ vault_orders_api_token }}"` in `group_vars/prod/main.yml`.
2. **Vault var file:** define `vault_orders_api_token` in `group_vars/prod/vault.yml`.
3. **Do not keep:** the plaintext token `plain-prod-token`.
