$ cat /var/log/iostat-snapshot.txt
$ grep sda /var/log/iostat-snapshot.txt

Device `sda` is at 95.20% utilization with an average wait of 62.40ms, meaning it is nearly saturated and every I/O request is queuing behind other requests. The NVMe device is healthy at 0.45ms await.
