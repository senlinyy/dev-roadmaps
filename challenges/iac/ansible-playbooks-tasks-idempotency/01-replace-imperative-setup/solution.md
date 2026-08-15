### `site.yml`

```yaml
- name: Prepare orders hosts
  hosts: orders_web
  become: true
  tasks:
    - name: Create orders account
      ansible.builtin.user:
        name: orders
        system: true
        shell: /usr/sbin/nologin
        create_home: false

    - name: Create orders directory
      ansible.builtin.file:
        path: /srv/orders
        state: directory
        owner: orders
        group: orders
        mode: "0750"

    - name: Install curl
      ansible.builtin.apt:
        name: curl
        state: present
```
