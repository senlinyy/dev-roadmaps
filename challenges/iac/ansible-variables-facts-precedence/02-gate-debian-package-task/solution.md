### site.yml

```yaml
- name: Configure orders web hosts
  hosts: orders_web
  become: true

  tasks:
    - name: Install nginx on Debian hosts
      ansible.builtin.apt:
        name: nginx
        state: present
      when: ansible_facts.os_family == "Debian"
```

The task still declares package state, but it now runs only when gathered facts show a Debian-family host.
