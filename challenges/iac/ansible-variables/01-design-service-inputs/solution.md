### `site.yml`

```yaml
- name: Configure orders web
  hosts: orders_web
  become: true
  tasks:
    - name: Render orders configuration
      ansible.builtin.template:
        src: orders.conf.j2
        dest: /etc/orders/orders.conf
        mode: "0640"
```

### `group_vars/all.yml`

```yaml
---
orders_port: 8080
orders_workers: 2
```

### `group_vars/production.yml`

```yaml
---
orders_workers: 6
orders_api_url: https://orders.internal.example
```

### `templates/orders.conf.j2`

```jinja2
listen={{ orders_port }}
workers={{ orders_workers }}
api_url={{ orders_api_url | mandatory }}
```
