### roles/orders_web/tasks/main.yml

```yaml
- name: Install orders API environment
  ansible.builtin.template:
    src: orders-api.env.j2
    dest: /etc/default/devpolaris-orders-api
    owner: root
    group: root
    mode: "0640"
  no_log: true
```

The restricted file mode limits host access, while `no_log` prevents secret-bearing task arguments and results from entering automation logs.
