```bash
$ cat /var/log/incidents/bastion-ssh.log
$ cat /var/log/incidents/edge-link.log
$ cat /var/log/incidents/db-neighbor.log
$ echo "bastion-ssh Layer 4" > /home/dev/reports/osi-routing.note
$ echo "edge-link Layer 1" >> /home/dev/reports/osi-routing.note
$ echo "db-neighbor Layer 2" >> /home/dev/reports/osi-routing.note
$ cat /home/dev/reports/osi-routing.note
```

This step is about applying the debugging model, not looking it up. The incident evidence is enough to classify the refused SSH connection as Layer 4, the dead link as Layer 1, and the failed ARP neighbor entry as Layer 2.
