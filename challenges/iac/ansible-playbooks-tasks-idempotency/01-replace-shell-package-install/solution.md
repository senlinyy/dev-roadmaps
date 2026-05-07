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

The task now describes the desired package state, so a second run can report `ok` when nginx is already installed.
