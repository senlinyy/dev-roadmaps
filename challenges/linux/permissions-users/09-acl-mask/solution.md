```bash
ls -l /srv/finance/report.csv
getfacl /srv/finance/report.csv
test -r /srv/finance/report.csv
test -w /srv/finance/report.csv
```

Alice's named entry requests read and write, but the ACL mask permits only read. The effective named-user access is therefore read-only, which the separate tests confirm.
