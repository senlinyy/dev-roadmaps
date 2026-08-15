### `publish-workflow.asl.json`

```json
{
  "Comment": "Publish a validated lesson",
  "StartAt": "ValidateLesson",
  "States": {
    "ValidateLesson": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Next": "PublishEvent",
      "Retry": [
        {
          "ErrorEquals": ["Lambda.ServiceException"],
          "IntervalSeconds": 2,
          "MaxAttempts": 3,
          "BackoffRate": 2
        }
      ],
      "Catch": [
        {
          "ErrorEquals": ["States.ALL"],
          "Next": "RecordFailure"
        }
      ]
    },
    "PublishEvent": {
      "Type": "Task",
      "Resource": "arn:aws:states:::events:putEvents",
      "End": true
    },
    "RecordFailure": {
      "Type": "Task",
      "Resource": "arn:aws:states:::sqs:sendMessage",
      "Next": "PublishFailed"
    },
    "PublishFailed": {
      "Type": "Fail"
    }
  }
}
```
