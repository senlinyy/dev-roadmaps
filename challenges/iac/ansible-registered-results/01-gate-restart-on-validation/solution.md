```yaml
- name: Validate orders API configuration
  ansible.builtin.command: /usr/local/bin/orders-api --check-config /etc/orders-api/config.yml
  register: orders_config_check
  changed_when: false
  failed_when: false

- name: Restart orders API after valid configuration
  ansible.builtin.systemd_service:
    name: devpolaris-orders-api
    state: restarted
  when: orders_config_check.rc == 0
```

The first task records host-local validation evidence while keeping the play alive long enough to inspect it. The second task changes service state only when that host returned a successful validation code.
