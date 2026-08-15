### `site.yml`

```yaml
- name: Tune PostgreSQL
  hosts: orders_db
  become: true
  tasks:
    - name: Set PostgreSQL connection limit
      ansible.builtin.lineinfile:
        path: /etc/postgresql/16/main/postgresql.conf
        regexp: '^max_connections\s*='
        line: 'max_connections = 300'
        backup: true
        validate: /usr/lib/postgresql/16/bin/postgres -t -D /etc/postgresql/16/main -C config_file
```
