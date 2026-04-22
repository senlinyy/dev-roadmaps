```bash
$ cat /etc/ssh/sshd_config
$ grep "PermitRootLogin" /etc/ssh/sshd_config
$ grep "PasswordAuthentication" /etc/ssh/sshd_config
$ grep "^Port" /etc/ssh/sshd_config
```

Three defaults violate the hardening baseline: `PermitRootLogin yes` lets attackers brute-force the root account directly, `PasswordAuthentication yes` keeps the door open to credential-guessing bots even when keys are deployed, and `Port 22` keeps the daemon at the address every scanner on the internet checks first. Flip them to `no`, `no`, and a non-standard port (e.g. `2222`), then `systemctl restart sshd`.
