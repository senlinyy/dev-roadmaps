### locals.tf

```hcl
locals {
  name_prefix = format("orders-%s", var.environment)
  common_tags = {
    Service     = "orders"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}
```

### main.tf

```hcl
resource "aws_s3_bucket" "logs" {
  bucket = "${local.name_prefix}-logs"
  tags   = local.common_tags
}

resource "aws_sqs_queue" "events" {
  name = "${local.name_prefix}-events"
  tags = local.common_tags
}
```

The shared locals remove copy-paste drift while leaving caller-controlled environment input explicit.
