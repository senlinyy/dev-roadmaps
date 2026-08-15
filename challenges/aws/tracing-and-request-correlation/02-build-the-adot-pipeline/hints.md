Collector components do nothing until the service pipelines reference them.
---
The traces pipeline uses awsxray. The logs pipeline uses awscloudwatchlogs. Both should use memory_limiter before batch.
