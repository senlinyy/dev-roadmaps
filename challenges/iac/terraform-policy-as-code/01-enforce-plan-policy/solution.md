### policy/terraform.rego

```rego
package terraform.policy

deny contains message if {
  some resource in input.resource_changes
  startswith(resource.type, "aws_")
  tags := object.get(resource.change.after, "tags", {})
  missing := {"Owner", "Environment"} - {key | tags[key]}
  count(missing) > 0
  message := sprintf("%s is missing required tags: %v", [resource.address, missing])
}

deny_delete contains message if {
  some resource in input.resource_changes
  resource.change.actions == ["delete"]
  object.get(resource.change.before.tags, "Environment", "") == "prod"
  message := sprintf("%s deletes a protected production resource", [resource.address])
}
```

The policy separates missing metadata from protected deletion and can be tested against small plan JSON fixtures before pipeline use.
