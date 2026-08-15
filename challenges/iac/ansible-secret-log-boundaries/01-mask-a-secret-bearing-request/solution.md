### `deploy.yml`

```yaml
- name: Trigger orders deployment
  hosts: localhost
  gather_facts: false
  tasks:
    - name: Start deployment
      ansible.builtin.uri:
        url: https://deploy.internal.example/orders
        method: POST
        headers:
          Authorization: "Bearer {{ orders_api_token }}"
        status_code: 202
        return_content: false
      register: deploy_response
      no_log: true
      changed_when: deploy_response.status == 202
```
