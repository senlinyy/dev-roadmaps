### roles/orders_web/tasks/main.yml

```yaml
- name: Render nginx configuration
  ansible.builtin.template:
    src: nginx.conf.j2
    dest: /etc/nginx/nginx.conf
    owner: root
    group: root
    mode: "0644"
    validate: "nginx -t -c %s"
```

### roles/orders_web/templates/nginx.conf.j2

```yaml
server {
    listen 80;
    server_name {{ orders_server_name }};

    location / {
        proxy_pass http://127.0.0.1:{{ orders_api_port }};
    }
}
```

The task now renders a reviewed template and asks nginx to validate the candidate config before it becomes active.
