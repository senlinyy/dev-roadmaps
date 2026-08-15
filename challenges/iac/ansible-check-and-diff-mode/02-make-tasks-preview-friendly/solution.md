### `deploy.yml`

```yaml
- name: Deploy orders
  hosts: orders_web
  become: true
  tasks:
    - name: Render configuration
      ansible.builtin.template:
        src: orders.conf.j2
        dest: /etc/orders/orders.conf
        mode: "0640"
        validate: /usr/local/bin/orders --check-config %s
      diff: true

    - name: Verify external route
      ansible.builtin.command:
        cmd: /usr/local/bin/check-orders-route
      when: not ansible_check_mode
      changed_when: false
```

### `templates/orders.conf.j2`

```jinja2
workers={{ orders_workers }}
```
