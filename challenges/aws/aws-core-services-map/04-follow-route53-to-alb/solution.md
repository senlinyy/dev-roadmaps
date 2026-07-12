```bash
aws route53 list-hosted-zones-by-name --dns-name devpolaris.com
aws route53 list-resource-record-sets --hosted-zone-id ZDEVPOORDERS
aws elbv2 describe-load-balancers --names devpolaris-orders-alb
```

- `--dns-name` finds the hosted zone for `devpolaris.com`.
- `--hosted-zone-id` lists the records inside the selected zone so you can inspect the alias target.
- `--names` returns the ALB details for the load balancer referenced by that alias.
