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

    - name: Verify deployment acceptance
      ansible.builtin.assert:
        that:
          - deploy_response.status == 202
        fail_msg: Deployment API did not accept the request

    - name: Report safe deployment evidence
      ansible.builtin.debug:
        msg: Deployment request accepted
      changed_when: false
```
