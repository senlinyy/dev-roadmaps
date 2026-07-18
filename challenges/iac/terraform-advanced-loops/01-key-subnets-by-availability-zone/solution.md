```hcl
variable "web_subnets" {
  type = map(object({
    availability_zone = string
    netnum             = number
  }))

  default = {
    use1a = { availability_zone = "us-east-1a", netnum = 1 }
    use1b = { availability_zone = "us-east-1b", netnum = 2 }
    use1c = { availability_zone = "us-east-1c", netnum = 3 }
  }
}

resource "aws_subnet" "web" {
  for_each = var.web_subnets

  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet("10.0.0.0/16", 8, each.value.netnum)
  availability_zone = each.value.availability_zone

  tags = {
    Name = "web-${each.key}"
  }
}
```

The map keys become stable state addresses such as `aws_subnet.web["use1a"]`. Removing one key no longer renumbers every subnet after it.
