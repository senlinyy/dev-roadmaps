---
title: "Render Nginx Template"
sectionSlug: "rendering-an-nginx-template-with-variables"
order: 1
---

Wire the web role so it renders the Nginx config from a Jinja template and validates it before replacement.

Requirements:

1. **Template task:** `src: nginx.conf.j2`, `dest: /etc/nginx/nginx.conf`, `mode: "0644"`.
2. **Validation:** `validate: "nginx -t -c %s"`.
3. **Template values:** use `{{ orders_api_port }}` and `{{ orders_server_name }}` in the template.
