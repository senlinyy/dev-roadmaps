### `deploy.yml`

```yaml
- name: Deploy orders web
  hosts: orders_web
  become: true
  serial: 2
  max_fail_percentage: 0
  any_errors_fatal: true

  pre_tasks:
    - name: Drain current batch
      ansible.builtin.uri:
        url: "https://lb.internal.example/nodes/{{ inventory_hostname }}/drain"
        method: POST
        status_code: 202
      delegate_to: localhost

  tasks:
    - name: Install pinned orders release
      ansible.builtin.apt:
        name: "orders={{ orders_release }}"
        state: present
      notify: Restart orders

  post_tasks:
    - name: Verify local orders health
      ansible.builtin.uri:
        url: http://127.0.0.1:8080/health
        status_code: 200
      register: orders_health
      retries: 6
      delay: 5
      until: orders_health.status == 200
      changed_when: false

    - name: Return current batch to service
      ansible.builtin.uri:
        url: "https://lb.internal.example/nodes/{{ inventory_hostname }}/enable"
        method: POST
        status_code: 202
      delegate_to: localhost

  handlers:
    - name: Restart orders
      ansible.builtin.service:
        name: orders
        state: restarted
```
