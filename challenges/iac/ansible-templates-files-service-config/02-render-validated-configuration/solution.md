### `site.yml`

```yaml
- name: Configure orders service
  hosts: orders_web
  become: true
  tasks:
    - name: Render orders configuration
      ansible.builtin.template:
        src: orders.conf.j2
        dest: /etc/orders/orders.conf
        owner: root
        group: orders
        mode: "0640"
        validate: /usr/local/bin/orders --check-config %s
```

### `templates/orders.conf.j2`

```jinja2
listen={{ orders_port }}
workers={{ orders_workers | default(2) }}
upstream={{ orders_upstream | mandatory }}
```
