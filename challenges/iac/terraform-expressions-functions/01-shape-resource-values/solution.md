### locals.tf

```hcl
locals {
  environment = lower(trimspace(var.environment))
  bucket_name = substr(format("dp-orders-%s", local.environment), 0, 63)
  tags = merge({
    Service     = "orders"
    Environment = local.environment
  }, var.extra_tags)
}
```

### main.tf

```hcl
resource "aws_s3_bucket" "orders" {
  bucket = local.bucket_name
  tags   = local.tags
}
```

The expressions are reviewable, deterministic, and reusable across every consumer of the derived name and tags.
