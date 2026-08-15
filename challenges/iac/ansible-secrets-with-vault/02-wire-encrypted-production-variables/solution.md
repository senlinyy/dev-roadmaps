### `deploy.yml`

```yaml
- name: Deploy orders
  hosts: production
  vars_files:
    - group_vars/production/vault.yml
  tasks:
    - name: Call deployment API
      ansible.builtin.uri:
        url: https://deploy.internal.example/orders
        method: POST
        headers:
          Authorization: "Bearer {{ orders_api_token }}"
        status_code: 202
      no_log: true
```

### `group_vars/production/vault.yml`

```yaml
$ANSIBLE_VAULT;1.1;AES256
3832656530643166633237646338333737353265376264386363643939326335
6138363731393939656562306439316438336137333365356630323631363238
```
