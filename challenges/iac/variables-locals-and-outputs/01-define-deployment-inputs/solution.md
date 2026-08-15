### variables.tf

```hcl
variable "environment" {
  type    = string
  default = "dev"

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be dev, staging, or prod."
  }
}

variable "replica_count" {
  type    = number
  default = 2

  validation {
    condition     = var.replica_count >= 1 && var.replica_count <= 10
    error_message = "Replica count must be between 1 and 10."
  }
}
```

### service.tf

```hcl
resource "aws_ecs_service" "orders" {
  name          = "orders-${var.environment}"
  desired_count = var.replica_count
}
```

The module rejects impossible deployment shapes early and consumes caller input through references instead of duplicated literals.
