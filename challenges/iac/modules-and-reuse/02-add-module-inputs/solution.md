### variables.tf

```hcl
variable "bucket_name" {
  description = "Globally unique S3 bucket name for this application-owned bucket."
  type        = string
}

variable "service" {
  description = "Service name used in tags, such as orders-api."
  type        = string
}

variable "environment" {
  description = "Deployment environment, such as dev, staging, or prod."
  type        = string

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be one of dev, staging, or prod."
  }
}

variable "owner" {
  description = "Team or group responsible for this bucket."
  type        = string
  default     = "platform"
}

variable "versioning_enabled" {
  description = "Whether S3 object versioning should be enabled for recovery."
  type        = bool
  default     = false
}
```

These inputs form a small contract: callers provide values that vary, while the module keeps the bucket implementation inside the child module.
