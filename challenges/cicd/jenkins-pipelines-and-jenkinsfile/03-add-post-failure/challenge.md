---
title: "Notify the Team on Failure"
sectionSlug: parallel-branches-post-conditions-and-options
order: 3
---

The polaris-orders pipeline runs three stages but says nothing when a build breaks. Ops only finds out when somebody refreshes the Blue Ocean view, which is hours late and silent on weekends.

You have the current `Jenkinsfile` open. Your job:

1. **Add a `post` block on the pipeline** that fires when the build fails.
2. **Inside the `failure` condition**, send a Slack notification by calling `slackSend channel: '#orders-ci', message: "polaris-orders ${env.BUILD_NUMBER} failed"`.
3. **Leave the existing stages untouched.** The grader checks that the original Build, Test, and Package stages still run their `sh` steps.

The grader looks at the structure of the file. It checks that a `post { failure { ... } }` exists on the pipeline and that the failure body calls `slackSend`. It does not care about formatting or where you put the block.
