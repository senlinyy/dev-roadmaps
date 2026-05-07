### site.yml

```yaml
- name: Configure orders web hosts
  hosts: orders_web
  become: true
  serial: 1

  roles:
    - orders_web
```

The play still targets the full group, but Ansible will process one host per batch.
