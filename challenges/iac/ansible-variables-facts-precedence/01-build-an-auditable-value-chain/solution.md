### `group_vars/all.yml`

```yaml
---
orders_workers: 2
```

### `group_vars/production.yml`

```yaml
---
orders_workers: 6
```

### `host_vars/web-canary-01.yml`

```yaml
---
orders_workers: 1
```

### `site.yml`

```yaml
- name: Audit orders inputs
  hosts: production
  pre_tasks:
    - name: Report resolved worker count
      ansible.builtin.debug:
        msg: "orders_workers={{ orders_workers }}"
      changed_when: false
  tasks: []
```
