### `site.yml`

```yaml
- name: Deploy orders web
  hosts: orders_web
  become: true
  roles:
    - orders_web
```

### `roles/orders_web/defaults/main.yml`

```yaml
---
orders_port: 8080
orders_workers: 2
```

### `roles/orders_web/tasks/main.yml`

```yaml
- name: Render orders configuration
  ansible.builtin.template:
    src: orders.conf.j2
    dest: /etc/orders/orders.conf
    owner: root
    group: orders
    mode: "0640"
    validate: /usr/local/bin/orders --check-config %s
  notify: Restart orders
```

### `roles/orders_web/handlers/main.yml`

```yaml
- name: Restart orders
  ansible.builtin.service:
    name: orders
    state: restarted
```

### `roles/orders_web/templates/orders.conf.j2`

```jinja2
listen={{ orders_port }}
workers={{ orders_workers }}
```
