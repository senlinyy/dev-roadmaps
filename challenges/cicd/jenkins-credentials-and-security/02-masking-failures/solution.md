```bash
$ cat /var/log/jenkins/builds/orders-api-12483.log
$ grep dpop_ /var/log/jenkins/builds/orders-api-12483.log
$ grep polaris-deploy-token /var/log/jenkins/builds/orders-api-12483.log
```

The third-from-last `+` line is the leak: a `sh 'echo "raw substitution check: dpop_a3f29c4b9d77"'` wrote the literal token because the build code typed it back as a hard-coded string. The masker only replaces values bound through `withCredentials`, not arbitrary strings in shell arguments. Fixing this means deleting the offending line from the build script (it was a debug aid that should never have shipped) and rotating the credential since it is now in build history.
