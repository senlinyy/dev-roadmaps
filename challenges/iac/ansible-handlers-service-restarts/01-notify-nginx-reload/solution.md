### roles/orders_web/tasks/main.yml

```yaml
- name: Render nginx configuration
  ansible.builtin.template:
    src: nginx.conf.j2
    dest: /etc/nginx/nginx.conf
    mode: "0644"
  notify: Reload nginx
```

### roles/orders_web/handlers/main.yml

```yaml
- name: Reload nginx
  ansible.builtin.service:
    name: nginx
    state: reloaded
```

The config task now triggers a reload only when Ansible reports that the rendered config changed.
