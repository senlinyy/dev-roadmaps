```bash
ss -lntp
ps -p 310 -o pid,user,args
nc -vz 127.0.0.1 9000
nc -vz 10.20.0.10 9000
```

The loopback probe succeeds; the interface-address probe returns refusal. The socket is bound only to loopback.
