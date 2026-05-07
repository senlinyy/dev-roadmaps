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

### group_vars/orders_web.yml

```yaml
ansible_user: ubuntu
ansible_become: true
orders_environment: prod
```

The host map stays focused on host identity, while shared connection settings live at group scope.
