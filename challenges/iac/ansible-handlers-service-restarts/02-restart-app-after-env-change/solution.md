### roles/orders_web/tasks/main.yml

```yaml
- name: Install orders environment file
  ansible.builtin.template:
    src: orders-api.env.j2
    dest: /etc/default/devpolaris-orders-api
    owner: root
    group: root
    mode: "0640"
  notify: Restart orders API
```

### roles/orders_web/handlers/main.yml

```yaml
- name: Reload nginx
  ansible.builtin.service:
    name: nginx
    state: reloaded

- name: Restart orders API
  ansible.builtin.systemd_service:
    name: devpolaris-orders-api
    state: restarted
    daemon_reload: true
```

The app restart is now tied to the file that can change the app runtime environment.
