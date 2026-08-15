### `deploy.yml`

```yaml
- name: Release orders
  hosts: orders_web
  become: true
  serial: 1
  max_fail_percentage: 0
  any_errors_fatal: true
  pre_tasks:
    - name: Require an immutable release identifier
      ansible.builtin.assert:
        that:
          - orders_release is defined
          - orders_release | length > 0
        fail_msg: CI must supply orders_release

  tasks:
    - name: Install approved orders release
      ansible.builtin.apt:
        name: "orders={{ orders_release }}"
        state: present

  post_tasks:
    - name: Verify orders health
      ansible.builtin.uri:
        url: http://127.0.0.1:8080/health
        status_code: 200
      register: orders_health
      retries: 6
      delay: 5
      until: orders_health.status == 200
      changed_when: false
```

### `ansible.cfg`

```ini
[defaults]
host_key_checking = True
retry_files_enabled = False
interpreter_python = auto_silent
```
