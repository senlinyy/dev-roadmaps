```yaml
jenkins:
  systemMessage: "devpolaris-jenkins (managed by CasC)"
  numExecutors: 0
  mode: EXCLUSIVE
  securityRealm:
    local:
      allowsSignup: false
      users:
        - id: devpolaris-admin
          password: ${POLARIS_ADMIN_PASSWORD}
  authorizationStrategy:
    roleBased:
      roles:
        global:
          - name: admin
            permissions:
              - "Overall/Administer"
            assignments:
              - devpolaris-admin
```

`numExecutors: 0` plus `mode: EXCLUSIVE` is the standard production pair: the controller never runs builds, and unlabeled jobs cannot accidentally land on labeled agents either. The local realm uses an env-var-resolved password so the cleartext never sits in git. Role-based auth gives the admin user a single global role with a clear permission set; further roles can be added under the same `global:` list or via `items:` and `agents:` for finer scoping.
