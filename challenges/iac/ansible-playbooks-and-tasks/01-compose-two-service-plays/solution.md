### `site.yml`

```yaml
- name: Configure orders database
  hosts: orders_db
  become: true
  tasks:
    - name: Install PostgreSQL
      ansible.builtin.apt:
        name: postgresql
        state: present

    - name: Keep PostgreSQL running
      ansible.builtin.service:
        name: postgresql
        state: started
        enabled: true

- name: Configure orders web
  hosts: orders_web
  become: true
  tasks:
    - name: Install nginx
      ansible.builtin.apt:
        name: nginx
        state: present

    - name: Keep nginx running
      ansible.builtin.service:
        name: nginx
        state: started
        enabled: true
```
