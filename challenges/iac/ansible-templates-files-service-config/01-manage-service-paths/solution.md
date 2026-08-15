### `site.yml`

```yaml
- name: Prepare orders paths
  hosts: orders_web
  become: true
  tasks:
    - name: Create configuration directory
      ansible.builtin.file:
        path: /etc/orders
        state: directory
        owner: root
        group: orders
        mode: "0750"

    - name: Create data directory
      ansible.builtin.file:
        path: /var/lib/orders
        state: directory
        owner: orders
        group: orders
        mode: "0750"

    - name: Create managed environment file
      ansible.builtin.file:
        path: /etc/orders/orders.env
        state: touch
        owner: root
        group: orders
        mode: "0640"
        modification_time: preserve
        access_time: preserve
```
