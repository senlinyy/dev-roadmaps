```bash
aws logs describe-log-groups --log-group-name-prefix /aws/ecs/devpolaris-orders-api
aws logs filter-log-events --log-group-name /aws/ecs/devpolaris-orders-api --filter-pattern ERROR
```
