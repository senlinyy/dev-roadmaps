---
title: "Build the Cloud Run Error Alert"
sectionSlug: alert-policies
order: 1
---

Complete the alert policy for sustained HTTP 5xx responses from the production `orders-api` Cloud Run service. The condition must filter the request-count metric to the service and production project, align samples over five minutes, and trigger when the error count is greater than 25 for five minutes.

Route notifications to the production on-call channel and keep the policy enabled.
