---
title: "Build the Publish API Contract"
sectionSlug: build-a-small-publish-api
order: 1
---

Complete the OpenAPI document for `POST /lessons/{lessonId}/publish`. The path parameter is required, the JSON request body requires `publishedBy`, success returns 202, and invalid input returns 400. Use an API Gateway Lambda proxy integration with payload format version `2.0` and the supplied invocation URI.
