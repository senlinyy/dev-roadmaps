```bash
aws elbv2 describe-load-balancers --names devpolaris-orders-alb
aws elbv2 describe-listeners --load-balancer-arn arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/devpolaris-orders-alb/50dc6c495c0c9188
aws elbv2 describe-target-groups --names devpolaris-orders-api-tg
aws elbv2 describe-target-health --target-group-arn arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/devpolaris-orders-api-tg/6d0ecf831eec9f09
```

A working load balancer can still produce errors when a backend target fails its health check. Target health tells you which copy is trusted for traffic.
