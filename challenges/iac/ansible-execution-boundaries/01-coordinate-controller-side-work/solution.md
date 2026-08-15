### `deploy.yml`

```yaml
- name: Deploy orders web
  hosts: orders_web
  gather_facts: false
  pre_tasks:
    - name: Resolve the approved release once
      ansible.builtin.uri:
        url: https://releases.internal.example/orders/latest
        return_content: true
        status_code: 200
      delegate_to: localhost
      run_once: true
      register: approved_release
      changed_when: false

    - name: Share the approved release with managed hosts
      ansible.builtin.set_fact:
        orders_release: "{{ approved_release.json.version }}"
      delegate_to: "{{ item }}"
      delegate_facts: true
      loop: "{{ ansible_play_hosts_all }}"
      run_once: true

    - name: Drain each managed host
      ansible.builtin.uri:
        url: "https://lb.internal.example/nodes/{{ inventory_hostname }}/drain"
        method: POST
        status_code: 202
      delegate_to: localhost
```
