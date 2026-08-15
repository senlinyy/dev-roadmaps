Inspect the service account resource first, then read the IAM policy attached to the production project.

Compare the member string in each binding with the exact runtime service account email. A role name alone does not prove the runtime has it.
