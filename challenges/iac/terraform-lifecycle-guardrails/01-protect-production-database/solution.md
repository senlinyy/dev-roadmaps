### database.tf

```hcl
resource "aws_db_instance" "orders" {
  identifier = "orders-prod"
  engine     = "postgres"

  lifecycle {
    prevent_destroy       = true
    create_before_destroy = true
  }
}
```

The guardrails make destructive intent explicit and favor replacement ordering that preserves availability when the provider supports it.
