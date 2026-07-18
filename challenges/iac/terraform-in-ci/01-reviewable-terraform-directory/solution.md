### infra/orders/prod/main.tf

```hcl
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "eu-west-2"
}
```

Version constraints make provider selection reviewable, and removing static keys lets CI supply short-lived credentials through its trusted identity boundary.

### infra/orders/prod/s3.tf

```hcl
resource "aws_s3_bucket" "orders_invoices" {
  bucket = "dp-orders-invoices-prod"
}
```
