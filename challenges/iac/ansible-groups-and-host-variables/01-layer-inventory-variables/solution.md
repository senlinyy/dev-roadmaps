### `inventory.ini`

```ini
[orders_web]
web-01 ansible_host=192.0.2.10
web-02 ansible_host=192.0.2.11

[production:children]
orders_web
```

### `group_vars/production.yml`

```yaml
---
environment: production
monitoring_enabled: true
```

### `group_vars/orders_web.yml`

```yaml
---
orders_port: 8080
orders_workers: 4
```

### `host_vars/web-02.yml`

```yaml
---
orders_port: 8081
```
