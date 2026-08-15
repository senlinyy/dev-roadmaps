### `inventory.ini`

```ini
[orders_web]
web-01 ansible_host=192.0.2.10
web-02 ansible_host=192.0.2.11

[production:children]
orders_web
```

### `group_vars/orders_web.yml`

```yaml
---
ansible_user: deploy
ansible_python_interpreter: /usr/bin/python3
```
