The Deployment selector, Pod labels, and Service selector must agree. The IAM role annotation belongs on the ServiceAccount, and the Pod template must name that ServiceAccount.
---
Use a named container port so the probes and Service can refer to http instead of duplicating a number.
