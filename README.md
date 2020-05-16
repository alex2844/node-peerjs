# node-peerjs

[![Version](https://img.shields.io/npm/v/node-peerjs.svg)](https://www.npmjs.org/package/node-peerjs)

PeerServer helps broker connections between PeerJS clients.

Create server:
```javascript
var peer = require('node-peerjs').PeerServer()
		.on('connection', console.log.bind(console, 'connection'))
		.on('disconnect', console.log.bind(console, 'disconnect'));
```
Connecting to the server from PeerJS:
```html
<script src='http://localhost:8008/peerjs/lib.js'></script>
<script>var peer = new Peer().on('open', console.log.bind(console, 'open'));</script>
```
CDN
```html
<script src='https://alex2844.github.io/node-peerjs/dist/peerjs.js'></script>
```
If you prefer to use a cloud hosted PeerServer instead of running your own:
```javascript
new Peer('IdUser', {host: 'peerjs.com', port: 9000})
```
Create room
```javascript
var room = Peer.Room('IdRoom', {name: 'User 1'})
		.on('server', console.log.bind(console, 'server'))
		.on('data', console.log.bind(console, 'data'))
		.on('join', console.log.bind(console, 'join'))
		.on('left', console.log.bind(console, 'left'))
		.on('list', console.log.bind(console, 'list'))
		.on('error', console.error.bind(console, 'error'));
```
Send data to peer(s)
```javascript
peer.send('data');
room.send('data' [, id ]);
```
Fetch
```javascript
Peer.Fetch('https://api.qwedl.com/ip.php', {
    init: {
        secure: true,
        host: '0.peerjs.com',
        port: 443
    }
}).then(res => {
    console.log(res);
    res.json().then(console.log.bind(console));
});
```
Config nginx proxy:
```nginx
location /peerjs {
	proxy_pass http://127.0.0.1:8008;
	proxy_http_version 1.1;
	proxy_set_header Upgrade $http_upgrade;
	proxy_set_header Connection "upgrade";
}
```

## Debug
http://localhost:8008/debug

## Installation
```
npm install -g node-peerjs
```
