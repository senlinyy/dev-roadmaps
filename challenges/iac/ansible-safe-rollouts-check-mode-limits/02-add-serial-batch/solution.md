### site.yml

```yaml
- name: Configure orders web hosts
  hosts: orders_web
  become: true
  serial: 1

  roles:
    - orders_web
```
