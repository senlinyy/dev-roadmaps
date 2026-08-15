### `audit-sink.json`

```json
{
  "name": "prod-admin-audit",
  "destination": "storage.googleapis.com/devpolaris-prod-audit-logs",
  "filter": "resource.labels.project_id=\"devpolaris-prod\" AND logName:\"cloudaudit.googleapis.com/activity\"",
  "uniqueWriterIdentity": true
}
```
