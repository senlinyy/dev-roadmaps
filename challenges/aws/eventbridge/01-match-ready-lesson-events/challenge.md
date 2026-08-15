---
title: "Match Ready Lesson Events"
sectionSlug: match-events-with-rules
order: 1
---

Complete the rule pattern for Northstar lesson events. It should match `LessonPublished` and `LessonRepublished` from `com.northstar.lessons`, only for the `tenant-learning` tenant, and only when `courseLevel` is anything except `internal`. Keep the pattern scoped to the custom event bus at rule configuration time rather than adding an event-bus field to the event pattern.
