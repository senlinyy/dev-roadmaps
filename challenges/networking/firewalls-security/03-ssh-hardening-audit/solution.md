```bash
$ cat /etc/ssh/sshd_config
$ grep "PermitRootLogin" /etc/ssh/sshd_config
$ grep "PasswordAuthentication" /etc/ssh/sshd_config
$ grep "^Port" /etc/ssh/sshd_config
$ echo "PermitRootLogin yes -> no" > /home/dev/reports/sshd-remediation.note
$ echo "PasswordAuthentication yes -> no" >> /home/dev/reports/sshd-remediation.note
$ echo "Port 22 -> 2222" >> /home/dev/reports/sshd-remediation.note
$ cat /home/dev/reports/sshd-remediation.note
```

The audit is not just to spot weak directives — it is to hand back the corrected values. Root login should be disabled, password authentication should be disabled, and the service should move off the default scanner port before the host is approved.
