$ cat /var/log/dmesg
$ grep "Out of memory" /var/log/dmesg
$ grep error /var/log/dmesg

The kernel killed java (PID 4521) via the OOM killer because it consumed nearly 7 GB of RSS. Separately, device sda experienced an I/O error at sector 209715200, which the EXT4 filesystem also logged.
