```yaml
- name: Render orders configuration
  ansible.builtin.template:
    src: orders.conf.j2
    dest: /etc/orders/orders.conf
    mode: "0640"
  diff: true
  notify: Restart orders

- name: Verify external route
  ansible.builtin.command: /usr/local/bin/check-orders-route
  when: not ansible_check_mode
  changed_when: false
```

The template module can predict and display file changes. The external command runs only during a real apply and does not create false changed status.
