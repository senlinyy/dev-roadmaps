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

### infra/orders/prod/s3.tf

```hcl
resource "aws_s3_bucket" "orders_invoices" {
  bucket = "dp-orders-invoices-prod"
}
```

The provider version constraint makes CI and local review target the same provider line, while credentials stay outside committed Terraform files.
