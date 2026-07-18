### main.tf

```hcl
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = "eu-west-2"
}
```

One input now drives both resource naming and tags, preventing those two representations of the environment from drifting apart.

### variables.tf

```hcl
variable "environment" {
  description = "Deployment environment for the orders service."
  type        = string
}
```

### s3.tf

```hcl
resource "aws_s3_bucket" "orders_invoices" {
  bucket = "dp-devpolaris-orders-${var.environment}-invoices"

  tags = {
    service     = "devpolaris-orders"
    environment = var.environment
    managed_by  = "terraform"
  }
}
```
