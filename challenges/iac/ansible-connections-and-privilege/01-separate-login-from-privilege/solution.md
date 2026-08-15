### `inventory.ini`

```ini
[orders_web]
web-01 ansible_host=192.0.2.10
```

### `group_vars/orders_web.yml`

```yaml
---
ansible_user: deploy
ansible_ssh_private_key_file: ~/.ssh/orders_deploy
```

### `site.yml`

```yaml
- name: Configure orders web
  hosts: orders_web
  become: true
  become_method: sudo
  become_user: root
  tasks:
    - name: Install nginx
      ansible.builtin.apt:
        name: nginx
        state: present
```
