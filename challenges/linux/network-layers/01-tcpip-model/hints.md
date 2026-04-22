Use `cat` first to see the file shape, then `grep "udp/"` and `grep "tcp/443"` to pull the lines you need. `grep -c` returns just the count when you need a number for the TCP totals.
