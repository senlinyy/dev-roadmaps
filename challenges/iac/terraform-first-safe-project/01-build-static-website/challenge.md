---
title: "Build the Static Website Resources"
sectionSlug: create-the-s3-website-resources
order: 1
revision: 2
---

The project requirements, provider, and website files are ready. Complete the infrastructure layer so the bucket, website configuration, and uploaded index document form one connected project.

Your job:

1. **Create** `aws_s3_bucket.website` from `local.bucket_name`.
2. **Create** `aws_s3_bucket_website_configuration.website` using the bucket ID and set `index_document` suffix to `index.html`.
3. **Create** `aws_s3_object.index` using the bucket ID, key `index.html`, source `site/index.html`, and content type `text/html`.

The grader checks the resulting configuration and its relationships, not formatting or a prose explanation.
