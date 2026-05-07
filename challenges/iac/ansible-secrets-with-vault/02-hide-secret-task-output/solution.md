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

The task still manages the secret-bearing file, but Ansible should not print token-bearing values in task output.
