### site.yml

```yaml
- name: Configure orders web hosts
  hosts: orders_web
  become: true

  roles:
    - orders_web
```

The play now keeps targeting concerns in `site.yml` and delegates repeated web configuration to the role.
