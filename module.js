var express = require('express'),
	http = require('http'),
	https = require('https'),
	bodyParser = require('body-parser'),
	WebSocketServer = require('ws').Server,
	url = require('url'),
	cors = require('cors'),
	fs = require('fs'),
	path = require('path');

exports = module.exports = {
	_cache: null,
	proto: {
		_initializeWSS: function(server) { /** Initialize WebSocket server. */
			var self = this;
			if (this.mountpath instanceof Array)
				throw new Error("This app can only be mounted on a single path");
			var path = this.mountpath;
			var path = path + (path[path.length - 1] != '/' ? '/' : '') + 'peerjs';
			this._wss = new WebSocketServer({ path: path, server: server}); // Create WebSocket server as well.
			this._wss.on('connection', function(socket, req) {
				if (!socket.upgradeReq)
					socket.upgradeReq = req;
				var query = url.parse(socket.upgradeReq.url, true).query,
					id = query.id,
					token = query.token,
					key = query.key,
					ip = socket.upgradeReq.socket.remoteAddress;
				if (!id || !token || !key) {
					socket.send(JSON.stringify({ type: 'ERROR', payload: { msg: 'No id, token, or key supplied to websocket server' } }));
					socket.close();
					return;
				}
				if (!self._clients[key] || !self._clients[key][id]) {
					self._checkKey(key, ip, function(err) {
						if (!err) {
							if (!self._clients[key][id]) {
								self._clients[key][id] = { token: token, ip: ip };
								self._ips[ip]++;
								socket.send(JSON.stringify({ type: 'OPEN' }));
							}
							self._configureWS(socket, key, id, token);
						}else
							socket.send(JSON.stringify({ type: 'ERROR', payload: { msg: err } }));
					});
				}else
					self._configureWS(socket, key, id, token);
			});
		},
		_configureWS: function(socket, key, id, token) {
			var self = this,
				client = this._clients[key][id];
			if (token === client.token) { // res 'close' event will delete client.res for us
				client.socket = socket;
				if (client.res) // Client already exists
					client.res.end();
			}else{ // ID-taken, invalid token
				socket.send(JSON.stringify({ type: 'ID-TAKEN', payload: { msg: 'ID is taken' } }));
				socket.close();
				return;
			}
			this._processOutstanding(key, id);
			socket.on('close', function() { // Cleanup after a socket closes.
				self._log('Socket closed:', id);
				if (client.socket == socket)
					self._removePeer(key, id);
			});
			socket.on('message', function(data) { // Handle messages from peers.
				try {
					var message = JSON.parse(data);
					if (['LEAVE', 'CANDIDATE', 'OFFER', 'ANSWER'].indexOf(message.type) !== -1)
						self._handleTransmission(key, {
							type: message.type,
							src: id,
							dst: message.dst,
							payload: message.payload
						});
					else
						module.exports.util.prettyError('Message unrecognized');
				} catch(e) {
					self._log('Invalid message', data);
					throw e;
				}
			});
			this.emit('connection', id); // We're going to emit here, because for XHR we don't *know* when someone disconnects.
		},
		_checkAllowsDiscovery: function(key, cb) {
			cb(this._options.allow_discovery);
		},
		_checkKey: function(key, ip, cb) {
			if (key == this._options.key) {
				if (!this._clients[key])
					this._clients[key] = {};
				if (!this._outstanding[key])
					this._outstanding[key] = {};
				if (!this._ips[ip])
					this._ips[ip] = 0;
				if (Object.keys(this._clients[key]).length >= this._options.concurrent_limit) { // Check concurrent limit
					cb('Server has reached its concurrent user limit');
					return;
				}
				if (this._ips[ip] >= this._options.ip_limit) {
					cb(ip + ' has reached its concurrent user limit');
					return;
				}
				cb(null);
			}else
				cb('Invalid key provided');
		},
		_initializeHTTP: function() { /** Initialize HTTP server routes. */
			var self = this;
			this.use(cors());
			this.get('/', function(req, res, next) {
				var d = require(path.resolve(__dirname, 'package.json'));
				res.send({
					name: d.name,
					description: d.description,
					contributors: d.contributors
				});
			});
			this.get('/debug', function(req, res, next) {
				res.send("<script src='http://localhost:8008/peerjs/lib.js'></script><script>var peer = new Peer().on('open', console.log.bind(console, 'open'));</script>");
			});
			this.get('/:key/lib.js', function(req, res, next) {
				res.writeHead(200, {
					'Content-Type': 'application/javascript',
					'Cache-Control': 'max-age=3600'
				});
				if (module.exports._cache)
					res.end(module.exports._cache);
				else
					fs.exists(path.resolve(__dirname, 'lib.js'), function(exists) {
						if (exists)
							fs.readFile(path.resolve(__dirname, 'lib.js'), 'utf8', function(err, chunk) {
								res.end((module.exports._cache = chunk));
							});
						else{
							https.get('https://raw.githubusercontent.com/peers/peerjs/master/dist/peer.min.js', function(get) {
								var d = require(path.resolve(__dirname, 'package.json'));
								var v,
									body = '';
								get.on('data', function(chunk) {
									body += chunk;
								}).on('end', function() {
									fs.readFile(path.resolve(__dirname, 'room.js'), 'utf8', function(err, chunk) {
										https.request({
											host: 'closure-compiler.appspot.com',
											path: '/compile',
											method: 'POST',
											headers: {'Content-Type': 'application/x-www-form-urlencoded'}
										}, function(get) {
											module.exports._cache = '';
											get.setEncoding('utf8');
											get.on('data', function(chunk) {
												module.exports._cache += chunk;
											}).on('end', function() {
												fs.writeFile(path.resolve(__dirname, 'lib.js'), (module.exports._cache = module.exports._cache.replace(/\n/g, ' ')), function() {
													res.end(module.exports._cache);
												});
											});
										}).end('output_info=compiled_code&js_code='+encodeURIComponent(body.replace('CLOUD_HOST:"0.peerjs.com"', 'CLOUD_HOST:location.hostname').replace('CLOUD_PORT:9e3', 'CLOUD_PORT:8008').replace(/\/\*(.*)\*\//g, function(s) {
											v = s.split(':')[1].split(',')[0];
											return '';
										})+chunk+"Peer.version={'node-peer': '"+d.version+"', peerjs: '"+v+"'}"));
									});
								});
							});
						}
					});
			});
			this.get('/:key/id', function(req, res, next) { // Retrieve guaranteed random ID.
				res.contentType = 'text/html';
				res.send(self._generateClientId(req.params.key));
			});
			this.post('/:key/:id/:token/id', function(req, res, next) { // Server sets up HTTP streaming when you get post an ID.
				var id = req.params.id,
					token = req.params.token,
					key = req.params.key,
					ip = req.connection.remoteAddress;
				if (!self._clients[key] || !self._clients[key][id]) {
					self._checkKey(key, ip, function(err) {
					if (!err && !self._clients[key][id]) {
						self._clients[key][id] = { token: token, ip: ip };
						self._ips[ip]++;
						self._startStreaming(res, key, id, token, true);
					}else
						res.send(JSON.stringify({ type: 'HTTP-ERROR' }));
					});
				}else
					self._startStreaming(res, key, id, token);
			});
			this.get('/:key/peers', function(req, res, next) { // Get a list of all peers for a key, enabled by the `allowDiscovery` flag.
			var key = req.params.key;
			if (self._clients[key]) {
				self._checkAllowsDiscovery(key, function(isAllowed) {
					if (isAllowed)
						res.send(Object.keys(self._clients[key]));
					else
						res.sendStatus(401);
				});
			}else
				res.sendStatus(404);
			});
			var handle = function(req, res, next) {
				var client,
					key = req.params.key,
					id = req.params.id;
				if (!self._clients[key] || !(client = self._clients[key][id])) {
					if (req.params.retry) {
						res.sendStatus(401);
						return;
					}else{ // Retry this request
						req.params.retry = true;
						setTimeout(handle, 25, req, res);
						return;
					}
				}
				if (req.params.token !== client.token) { // Auth the req
					res.sendStatus(401);
					return;
				}else{
					self._handleTransmission(key, {
						type: req.body.type,
						src: id,
						dst: req.body.dst,
						payload: req.body.payload
					});
					res.sendStatus(200);
				}
			}
			var jsonParser = bodyParser.json();
			this.post('/:key/:id/:token/offer', jsonParser, handle);
			this.post('/:key/:id/:token/candidate', jsonParser, handle);
			this.post('/:key/:id/:token/answer', jsonParser, handle);
			this.post('/:key/:id/:token/leave', jsonParser, handle);
		},
		_startStreaming: function(res, key, id, token, open) { /** Saves a streaming response and takes care of timeouts and headers. */
			var self = this;
			res.writeHead(200, {'Content-Type': 'application/octet-stream'});
			var pad = '00';
			for (var i = 0; i < 10; i++) {
				pad += pad;
			}
			res.write(pad + '\n');
			if (open)
				res.write(JSON.stringify({ type: 'OPEN' }) + '\n');
			var client = this._clients[key][id];
			if (token === client.token) { // Client already exists
				res.on('close', function() {
					if (client.res === res) {
						if (!client.socket) { // No new request yet, peer dead
							self._removePeer(key, id);
							return;
						}
						delete client.res;
					}
				});
				client.res = res;
				this._processOutstanding(key, id);
			}else // ID-taken, invalid token
				res.end(JSON.stringify({ type: 'HTTP-ERROR' }));
		},
		_pruneOutstanding: function() {
			var keys = Object.keys(this._outstanding);
			for (var k = 0, kk = keys.length; k < kk; k += 1) {
				var key = keys[k];
				var dsts = Object.keys(this._outstanding[key]);
				for (var i = 0, ii = dsts.length; i < ii; i += 1) {
					var offers = this._outstanding[key][dsts[i]];
					var seen = {};
					for (var j = 0, jj = offers.length; j < jj; j += 1) {
						var message = offers[j];
						if (!seen[message.src]) {
							this._handleTransmission(key, { type: 'EXPIRE', src: message.dst, dst: message.src });
							seen[message.src] = true;
						}
					}
				}
				this._outstanding[key] = {};
			}
		},
		_setCleanupIntervals: function() { /** Cleanup */
			var self = this;
			setInterval(function() { // Clean up ips every 10 minutes
				var keys = Object.keys(self._ips);
				for (var i = 0, ii = keys.length; i < ii; i += 1) {
					var key = keys[i];
					if (self._ips[key] === 0)
						delete self._ips[key];
				}
			}, 600000);
			setInterval(function() { // Clean up outstanding messages every 5 seconds
				self._pruneOutstanding();
			}, 5000);
		},
		_processOutstanding: function(key, id) { /** Process outstanding peer offers. */
			var offers = this._outstanding[key][id];
			if (!offers)
				return;
			for (var j = 0, jj = offers.length; j < jj; j += 1) {
				this._handleTransmission(key, offers[j]);
			}
			delete this._outstanding[key][id];
		},
		_removePeer: function(key, id) {
			if (this._clients[key] && this._clients[key][id]) {
				this._ips[this._clients[key][id].ip]--;
				delete this._clients[key][id];
				this.emit('disconnect', id);
			}
		},
		_handleTransmission: function(key, message) { /** Handles passing on a message. */
			var type = message.type,
				src = message.src,
				dst = message.dst,
				data = JSON.stringify(message),
				destination = this._clients[key][dst];
			if (destination) { // User is connected!
				try {
					this._log(type, 'from', src, 'to', dst);
					if (destination.socket)
						destination.socket.send(data);
					else if (destination.res) {
						data += '\n';
						destination.res.write(data);
					}else// Neither socket no res available. Peer dead?
						throw "Peer dead";
				} catch (e) { // This happens when a peer disconnects without closing connections and the associated WebSocket has not closed. Tell other side to stop trying.
					this._removePeer(key, dst);
					this._handleTransmission(key, {
					type: 'LEAVE',
					src: dst,
					dst: src
					});
				}
			}else{ // Wait for this client to connect/reconnect (XHR) for important messages.
				if (type !== 'LEAVE' && type !== 'EXPIRE' && dst) {
					var self = this;
					if (!this._outstanding[key][dst])
						this._outstanding[key][dst] = [];
					this._outstanding[key][dst].push(message);
				}else if (type === 'LEAVE' && !dst)
				this._removePeer(key, src);
				else { // Unavailable destination specified with message LEAVE or EXPIRE Ignore
				}
			}
		},
		_generateClientId: function(key) {
			var clientId = module.exports.util.randomId();
			if (!this._clients[key])
				return clientId;
			while (!!this._clients[key][clientId]) {
				clientId = module.exports.util.randomId();
			}
			return clientId;
		},
		_log: function() {
			if (this._options.debug)
				console.log.apply(console, arguments);
		}
	},
	util: {
		debug: false,
		inherits: function(ctor, superCtor) {
			ctor.super_ = superCtor;
			ctor.prototype = Object.create(superCtor.prototype, {
				constructor: {
					value: ctor,
					enumerable: false,
					writable: true,
					configurable: true
				}
			});
		},
		extend: function(dest, source) {
			source = source || {};
			for (var key in source) {
				if (source.hasOwnProperty(key))
					dest[key] = source[key];
			}
			return dest;
		},
		randomId: function () {
			return (Math.random().toString(36) + '0000000000000000000').substr(2, 16);
		},
		prettyError: function (msg) {
			console.log('ERROR PeerServer: ', msg);
		}
	},
	ExpressPeerServer: function(server, options) {
		var app = express();
		this.util.extend(app, this.proto);
		options = app._options = this.util.extend({
			debug: false,
			timeout: 5000,
			key: 'peerjs',
			ip_limit: 5000,
			concurrent_limit: 5000,
			allow_discovery: false,
			proxied: false
		}, options);
		app._clients = {}; // Connected clients
		app._outstanding = {}; // Messages waiting for another peer.
		app._ips = {}; // Mark concurrent users per ip
		if (options.proxied)
			app.set('trust proxy', options.proxied);
		app.on('mount', function() {
			if (!server)
				throw new Error('Server is not passed to constructor - can\'t start PeerServer');
			app._initializeHTTP(); // Initialize HTTP routes. This is only used for the first few milliseconds before a socket is opened for a Peer.
			app._setCleanupIntervals();
			app._initializeWSS(server);
		});
		return app;
	},
	PeerServer: function(options, callback) {
		options = options || {};
		var app = express(),
			path = (options.path || '/'),
			port = (options.port || 8008);
		delete options.path;
		if (path[0] !== '/')
			path = '/' + path;
		if (path[path.length - 1] !== '/')
			path += '/';
		var server;
		if (options.ssl) {
			if (options.ssl.certificate) { // Preserve compatibility with 0.2.7 API
				options.ssl.cert = options.ssl.certificate;
				delete options.ssl.certificate;
			}
			server = https.createServer(options.ssl, app);
			delete options.ssl;
		}else
			server = http.createServer(app);
		var peerjs = module.exports.ExpressPeerServer(server, options);
		app.use(path, peerjs);
		if (callback)
			server.listen(port, function() {
				callback(server);
			});
		else
			server.listen(port);
		return peerjs;
	}
}
