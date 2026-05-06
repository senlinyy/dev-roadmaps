### variables.tf

```hcl
variable "environment" {
  description = "Deployment environment for the orders service."
  type        = string
}

variable "service_name" {
  description = "Short service name used in tags and resource names."
  type        = string
  default     = "devpolaris-orders"
}

variable "extra_tags" {
  description = "Additional tags to add to orders resources."
  type        = map(string)
  default     = {}
}
```

### locals.tf

```hcl
locals {
  name_prefix = "${var.service_name}-${var.environment}"

  common_tags = merge(
    {
      service     = var.service_name
      environment = var.environment
      managed_by  = "terraform"
    },
    var.extra_tags
  )
}
```

### s3.tf

```hcl
resource "aws_s3_bucket" "orders_invoices" {
  bucket = "dp-${local.name_prefix}-invoices"
  tags   = local.common_tags
}
```

The resource now consumes named decisions instead of repeating naming and tag logic inline.
