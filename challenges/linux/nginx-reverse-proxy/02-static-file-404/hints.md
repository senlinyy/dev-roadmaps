`find /var/www/legacy -name "about.html"` printing nothing is the proof that the file isn't on disk; combine that with the 404 line for `/about.html` in the access log and you've closed the loop.
