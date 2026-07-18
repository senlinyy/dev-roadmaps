### site.yml

```yaml
- name: Configure orders web hosts
  hosts: orders_web
  become: true
  serial: 1

  roles:
    - orders_web

  tasks:
    - name: Check local orders health endpoint
      ansible.builtin.uri:
        url: http://127.0.0.1/health
        status_code: 200
      register: orders_health
      retries: 5
      delay: 3
      until: orders_health.status == 200
```

The registered HTTP result gives the retry loop concrete host-local evidence, so the next serial batch starts only after the current host is healthy.
