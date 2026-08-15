### `event-pattern.json`

```json
{
  "source": ["com.northstar.lessons"],
  "detail-type": ["LessonPublished", "LessonRepublished"],
  "detail": {
    "tenantId": ["tenant-learning"],
    "courseLevel": [
      { "anything-but": "internal" }
    ]
  }
}
```
