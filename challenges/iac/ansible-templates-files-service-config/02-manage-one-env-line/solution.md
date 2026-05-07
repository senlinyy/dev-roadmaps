### roles/orders_web/tasks/main.yml

```yaml
- name: Set orders API port
  ansible.builtin.lineinfile:
    path: /etc/default/devpolaris-orders-api
    regexp: "^ORDERS_API_PORT="
    line: "ORDERS_API_PORT={{ orders_api_port }}"
    create: true
    owner: root
    group: root
    mode: "0644"
```

`lineinfile` now controls one setting as state, rather than appending a shell echo on every run.
