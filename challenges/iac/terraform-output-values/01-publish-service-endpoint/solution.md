### outputs.tf

```hcl
output "orders_endpoint" {
  description = "HTTPS endpoint for the orders API"
  value       = "https://${aws_lb.orders.dns_name}"
  sensitive   = false
}
```

The output is state-backed, reviewable, and consumable without duplicating a provider-generated hostname.
