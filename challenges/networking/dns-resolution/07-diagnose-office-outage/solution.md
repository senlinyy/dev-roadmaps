```bash
dig @10.20.0.53 new.example.com A
dig @1.1.1.1 new.example.com A
dig @192.0.2.53 new.example.com A
sleep 60
dig @10.20.0.53 new.example.com A
curl -v -I https://new.example.com/health
```

The corporate resolver cached a negative answer before launch. Expiry makes the record visible; the final request separately verifies the service.

