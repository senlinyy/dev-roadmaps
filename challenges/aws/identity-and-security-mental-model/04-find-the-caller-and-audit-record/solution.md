```bash
aws sts get-caller-identity
aws cloudtrail lookup-events --lookup-attributes AttributeKey=EventName,AttributeValue=GetSecretValue
```

This gives you three different pieces of evidence: the incident target, the active caller, and the audit record for the denied secret read.
