```bash
aws acm describe-certificate --certificate-arn arn:aws:acm:us-east-1:123456789012:certificate/orders-cert
aws elbv2 describe-listeners --listener-arns arn:aws:elasticloadbalancing:us-east-1:123456789012:listener/app/devpolaris-orders-alb/50dc6c495c0c9188/9f49d4c9
```

HTTPS needs both pieces: a certificate that proves the name and a listener that presents that certificate on the public entry point.
