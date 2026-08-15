### queues.tf

```hcl
variable "event_types" {
  type    = set(string)
  default = ["created", "paid", "failed"]
}

resource "aws_sqs_queue" "events" {
  for_each = var.event_types

  name = "orders-${each.key}"
  tags = {
    Service   = "orders"
    EventType = each.key
  }
}
```

Named keys produce stable addresses such as `aws_sqs_queue.events["paid"]` instead of fragile numeric positions.
