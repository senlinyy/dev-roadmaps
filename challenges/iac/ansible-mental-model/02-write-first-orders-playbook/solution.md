### inventory/prod.yml

```yaml
all:
  children:
    orders_web:
      hosts:
        orders-web-01:
          ansible_host: 10.0.10.21
        orders-web-02:
          ansible_host: 10.0.10.22
```

### site.yml

```yaml
- name: Configure orders web hosts
  hosts: orders_web
  become: true

  tasks:
    - name: Install nginx
      ansible.builtin.apt:
        name: nginx
        state: present
        update_cache: true
```

The play names the host group, uses privilege escalation, and lets the apt module describe package state.
