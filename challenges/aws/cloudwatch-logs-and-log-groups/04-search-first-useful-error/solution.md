```bash
aws logs describe-log-groups --log-group-name-prefix /aws/ecs/devpolaris-orders-api
aws logs filter-log-events --log-group-name /aws/ecs/devpolaris-orders-api --filter-pattern ERROR
```

The useful evidence is not just that an error exists. It is the matching correlation ID and the structured fields that tell the team which checkout failed.
