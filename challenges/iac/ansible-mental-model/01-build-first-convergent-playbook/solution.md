### `site.yml`

```yaml
- name: Configure orders web
  hosts: orders_web
  become: true
  tasks:
    - name: Install nginx
      ansible.builtin.apt:
        name: nginx
        state: present
        update_cache: true

    - name: Keep nginx available
      ansible.builtin.service:
        name: nginx
        state: started
        enabled: true
```
