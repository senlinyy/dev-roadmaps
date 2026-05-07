### inventory/prod.yml

```yaml
all:
  children:
    orders_web:
      hosts:
        orders-web-01:
          ansible_host: 10.0.10.21
        orders-web-02:
          ansible_host: 10.0.10.22
```

The inventory now gives the `orders_web` group two stable host aliases and their connection addresses.
