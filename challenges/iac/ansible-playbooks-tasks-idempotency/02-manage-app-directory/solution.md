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

    - name: Create application directory
      ansible.builtin.file:
        path: /opt/devpolaris-orders
        state: directory
        owner: root
        group: root
        mode: "0755"
```

The directory task describes the final filesystem state without relying on a repeated `mkdir` command.
