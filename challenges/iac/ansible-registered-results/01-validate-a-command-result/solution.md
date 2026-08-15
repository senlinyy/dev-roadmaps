### `site.yml`

```yaml
- name: Validate orders configuration
  hosts: orders_web
  tasks:
    - name: Run vendor validator
      ansible.builtin.command:
        cmd: /usr/local/bin/orders --check-config /etc/orders/orders.conf
      register: orders_validation
      changed_when: false
      failed_when: orders_validation.rc != 0

    - name: Confirm validator output
      ansible.builtin.assert:
        that:
          - "'configuration valid' in orders_validation.stdout"
        fail_msg: Orders configuration did not pass validation
```
