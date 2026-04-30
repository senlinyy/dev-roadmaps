---
title: "Replace Hardcoded Secrets with withCredentials"
sectionSlug: binding-credentials-into-builds
order: 1
---

A Jenkinsfile from a contractor came in with the AWS access key and Slack webhook URL pasted as plain strings. The security team wants both moved to the Jenkins credential store and bound through `withCredentials` so the build logs never see the literal secrets.

The current Jenkinsfile is in the editor. Your job:

1. **Remove the inline `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` env entries**.
2. **Wrap the deploy `sh` call in `withCredentials([...])`** that binds an AWS-credentials credential id `polaris-aws-deploy` into `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`.
3. **Bind the Slack webhook** as a `string(credentialsId: 'polaris-slack-webhook', variable: 'SLACK_WEBHOOK')` in the same `withCredentials` list.
4. **Leave the `Build` stage and the `agent any` directive** untouched.

The grader checks the structure: no inline secrets, a `withCredentials` block exists in the deploy stage, and the right credential ids and variable names are bound.
