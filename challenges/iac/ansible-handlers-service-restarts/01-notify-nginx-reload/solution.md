### roles/orders_web/tasks/main.yml

```yaml
- name: Render nginx configuration
  ansible.builtin.template:
    src: nginx.conf.j2
    dest: /etc/nginx/nginx.conf
    mode: "0644"
  notify: Reload nginx
```

The template task notifies the handler only when the rendered configuration changes, so nginx is not reloaded on an unchanged run.

### roles/orders_web/handlers/main.yml

```yaml
- name: Reload nginx
  ansible.builtin.service:
    name: nginx
    state: reloaded
```
