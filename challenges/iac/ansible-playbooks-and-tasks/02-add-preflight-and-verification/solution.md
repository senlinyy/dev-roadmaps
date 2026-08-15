### `site.yml`

```yaml
- name: Deploy orders web
  hosts: orders_web
  become: true
  pre_tasks:
    - name: Validate required deployment inputs
      ansible.builtin.assert:
        that:
          - orders_port is defined
          - orders_port | int > 0
        fail_msg: orders_port must be a positive integer

  tasks:
    - name: Render orders configuration
      ansible.builtin.template:
        src: orders.conf.j2
        dest: /etc/orders/orders.conf
        mode: "0640"

  post_tasks:
    - name: Verify orders health
      ansible.builtin.uri:
        url: http://127.0.0.1:{{ orders_port }}/health
        status_code: 200
      changed_when: false
```

### `templates/orders.conf.j2`

```jinja2
listen={{ orders_port }}
```
