### `inventory.ini`

```ini
[orders_web]
web-01 ansible_host=192.0.2.10
web-02 ansible_host=192.0.2.11

[orders_db]
db-01 ansible_host=192.0.2.20

[production:children]
orders_web
orders_db
```
