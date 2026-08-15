### `site.yml`

```yaml
- name: Harden SSH
  hosts: production
  become: true
  tasks:
    - name: Manage DevPolaris SSH policy
      ansible.builtin.blockinfile:
        path: /etc/ssh/sshd_config
        marker: "# {mark} DEVPOLARIS MANAGED SSH POLICY"
        block: |
          PasswordAuthentication no
          PermitRootLogin no
        backup: true
        validate: /usr/sbin/sshd -t -f %s
      diff: true
```
