### `roles/orders_web/meta/argument_specs.yml`

```yaml
---
argument_specs:
  main:
    short_description: Configure the orders web service
    options:
      orders_upstream_url:
        type: str
        required: true
      orders_port:
        type: int
        required: false
        default: 8080
```

### `roles/orders_web/defaults/main.yml`

```yaml
---
orders_port: 8080
```

### `roles/orders_web/tasks/main.yml`

```yaml
- name: Validate orders upstream URL
  ansible.builtin.assert:
    that:
      - orders_upstream_url is defined
      - orders_upstream_url is match('^https://')
    fail_msg: orders_upstream_url must be an HTTPS URL

- name: Report validated role inputs
  ansible.builtin.debug:
    msg: "orders_port={{ orders_port }}"
  changed_when: false
```
