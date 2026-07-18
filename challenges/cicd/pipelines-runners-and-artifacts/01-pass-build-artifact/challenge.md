---
title: "Pass One Build Artifact Between Jobs"
sectionSlug: passing-evidence-between-jobs
order: 1
---

The preview deployment runs on a fresh runner and cannot find `checkout-api.tar.gz`, even though the build job created it. Repair the workflow so the build job preserves that package and the deploy job receives the same run output instead of rebuilding it.

Your job:

1. **Upload `checkout-api.tar.gz`** from the build job as artifact `checkout-api-package` with `actions/upload-artifact@v4`.
2. **Make `deploy-preview` wait for `build`** before it starts.
3. **Download `checkout-api-package`** in the deploy job with `actions/download-artifact@v4`.
4. **Deploy the downloaded archive** with `./scripts/deploy-preview.sh checkout-api.tar.gz` and do not rebuild in the deploy job.

The grader checks the artifact transfer contract across both jobs.
