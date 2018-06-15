# node-peerjs

[![Version](https://img.shields.io/npm/v/node-peerjs.svg)](https://www.npmjs.org/package/node-peerjs)

PeerServer helps broker connections between PeerJS clients. Data is not proxied through the server.

Create server:
```javascript
var peer = require('node-peerjs').PeerServer().on('connection', function(id) {
	console.log('connection', id)
}).on('disconnect', function(id) {
	console.log('disconnect', id)
});
```
Connecting to the server from PeerJS:
```html
<script src="http://localhost:8008/lib"></script>
<script>
var peer = new Peer('someid', {host: 'localhost', port: 8008}).on('open', function(id) {
	console.log('open'  +id);
});
</script>
```
```nginx
location /peerjs {
	proxy_pass http://127.0.0.1:8008;
	proxy_http_version 1.1;
	proxy_set_header Upgrade $http_upgrade;
	proxy_set_header Connection "upgrade";
}
```

## Installation
```
npm install -g node-peerjs
```
