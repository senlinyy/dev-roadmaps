### group_vars/all.yml

```yaml
web_package_by_os:
  Debian: nginx
  RedHat: httpd
```

### roles/web/tasks/main.yml

```yaml
- name: Install web package
  ansible.builtin.package:
    name: "{{ web_package_by_os[ansible_facts.os_family] }}"
    state: present
  when: ansible_facts.os_family in ['Debian', 'RedHat']
```

The fact selects the platform-specific package, while the condition prevents an undefined lookup on unsupported hosts.
