### site.yml

```yaml
- name: Configure orders web hosts
  hosts: orders_web
  become: true
  serial: 1

  roles:
    - orders_web
```

With `serial: 1`, Ansible completes the play for one orders host before moving to the next host in the batch.
