### `site.yml`

```yaml
- name: Configure mixed web fleet
  hosts: orders_web
  become: true
  gather_facts: true
  tasks:
    - name: Install nginx on Debian
      ansible.builtin.apt:
        name: nginx
        state: present
        update_cache: true
      when: ansible_facts.os_family == "Debian"

    - name: Install nginx on Red Hat
      ansible.builtin.dnf:
        name: nginx
        state: present
      when: ansible_facts.os_family == "RedHat"

    - name: Keep the platform service running
      ansible.builtin.service:
        name: "{{ 'nginx' if ansible_facts.os_family == 'Debian' else 'nginx' }}"
        state: started
        enabled: true
```
