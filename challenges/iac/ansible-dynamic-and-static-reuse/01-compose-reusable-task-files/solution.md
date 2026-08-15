### `site.yml`

```yaml
- name: Deploy orders web
  hosts: orders_web
  become: true
  tasks:
    - name: Load installation tasks
      ansible.builtin.import_tasks: tasks/install.yml
      tags: [install]

    - name: Load runtime verification
      ansible.builtin.include_tasks: tasks/verify.yml
      when: orders_verify | default(true) | bool
      tags: [verify]
```

### `tasks/install.yml`

```yaml
- name: Install orders package
  ansible.builtin.apt:
    name: orders
    state: present
```

### `tasks/verify.yml`

```yaml
- name: Check orders health
  ansible.builtin.uri:
    url: http://127.0.0.1:8080/health
    status_code: 200
  changed_when: false
```
