### main.tf

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

  default_tags {
    tags = {
      project    = "devpolaris-orders"
      managed_by = "terraform"
    }
  }
}
```

The requirement chooses the provider package, while the provider block configures the AWS region and shared tags for this root module.
