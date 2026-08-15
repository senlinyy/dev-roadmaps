### `queue-attributes.json`

```json
{
  "VisibilityTimeout": "120",
  "MessageRetentionPeriod": "345600",
  "ReceiveMessageWaitTimeSeconds": "20",
  "SqsManagedSseEnabled": "true",
  "RedrivePolicy": "{\"deadLetterTargetArn\":\"arn:aws:sqs:eu-west-2:123456789012:lesson-publish-dlq\",\"maxReceiveCount\":\"5\"}"
}
```
