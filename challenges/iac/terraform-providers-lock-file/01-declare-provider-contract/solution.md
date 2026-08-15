### providers.tf

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

provider "aws" {
  alias  = "dr"
  region = "eu-west-1"
}
```

The dependency contract is reviewed separately from provider instances, and credentials remain outside the configuration.
