### group_vars/orders_web.yml

```yaml
orders_service_name: devpolaris-orders-api
orders_api_port: 8080
orders_owner: devpolaris
```

The group vars file now holds shared values that tasks and templates can reuse without copying literals everywhere.
