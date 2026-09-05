```bash
id dev; id alice; id bob; stat /srv/team /srv/team/notes.txt; umask
sudo chgrp team /srv/team /srv/team/notes.txt
sudo chmod 2770 /srv/team
sudo chmod 660 /srv/team/notes.txt
umask 007; touch /srv/team/review.txt
stat /srv/team /srv/team/notes.txt /srv/team/review.txt
```
