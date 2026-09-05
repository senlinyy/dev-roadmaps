```bash
ip route show
ip route get 10.80.24.50
ip route get 10.81.24.50
ip route get 198.51.100.20
```

The `/20` wins for the production destination, the `/8` handles other private traffic, and `/0` handles the public documentation address.
