### roles/orders_web/defaults/main.yml

```yaml
orders_service_name: devpolaris-orders-api
orders_api_port: 8080
orders_server_name: orders.devpolaris.internal
```

The role now advertises the values callers can override without reading every task file.
