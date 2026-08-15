### `site.yml`

```yaml
- name: Configure orders
  hosts: orders_web
  become: true
  tasks:
    - name: Render orders configuration
      ansible.builtin.template:
        src: orders.conf.j2
        dest: /etc/orders/orders.conf
        mode: "0640"
        validate: /usr/local/bin/orders --check-config %s
      notify: Restart orders

  handlers:
    - name: Restart orders
      ansible.builtin.service:
        name: orders
        state: restarted
```

### `templates/orders.conf.j2`

```jinja2
listen={{ orders_port }}
```
