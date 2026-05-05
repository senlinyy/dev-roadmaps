```bash
aws route53 list-hosted-zones-by-name --dns-name devpolaris.com
aws route53 list-resource-record-sets --hosted-zone-id ZDEVPOORDERS
aws elbv2 describe-load-balancers --names devpolaris-orders-alb
```

The friendly name is stable, but the alias record still points at a real AWS entry point. That is the thing the request reaches first.
