```bash
cat /srv/secure/secrets.txt
ls -l /srv/secure/secrets.txt
sudo chgrp analysts /srv/secure/secrets.txt
sudo chmod 640 /srv/secure/secrets.txt
cat /srv/secure/secrets.txt
```

Changing the group to `analysts` makes Alice match the group class. Mode `0640` grants that class read access while keeping write access with root and denying access to others.
