---
title: "Route Priority Publish Notifications"
sectionSlug: message-attributes-and-filter-policies
order: 1
---

The search indexing subscription should receive only `LessonPublished` events for `standard` or `priority` lessons with a retry count below 3. Complete the SNS subscription filter policy. The publisher sends `eventType`, `tier`, and numeric `retryCount` as message attributes.
