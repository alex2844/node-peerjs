Peer.Room = Object.assign(function(roomid, options) {
	var _this = Peer.Room;
	_this.ROOMID = (roomid || 'general');
	_this.OPTIONS = (options || {});
	_this.list = {};
	_this.createServer();
	return _this;
}, {
	MSG_TYPE: {
		CHAT: 1,
		NEW_MEMBER: 2,
		RENAME: 3,
		DEPARTURE: 5,
		BROADCAST: 6,
		PING: 7,
		ACK: 8,
		MEMBERS_REQ: 9,
		MEMBERS_REP: 10,
	},
	_events: {},
	event: Peer.prototype.emit,
	on: Peer.prototype.on,
	off: Peer.prototype.off,
	emptyConnToClients: function() {
		if (this.connToClients)
			for (var id in this.connToClients) {
				this.closeClientConnection(this.connToClients[id]);
			}
		this.connToClients = {};
	},
	handleConnToClient: function(peerid) {
		var _this = this;
		this.connToClients[peerid].on('open', function() {
			_this.broadcast({
				type: _this.MSG_TYPE.NEW_MEMBER,
				peerid: peerid,
				peername: _this.connToClients[peerid].peername,
			});
			_this.connToClients[peerid].on('error', _this.event.bind(_this, 'error'));
		});
		this.connToClients[peerid].on('data', function(data) {
			switch(data.type) {
				case _this.MSG_TYPE.CHAT: {
					_this.connToClients[data.peerid].peername = data.peername;
					_this.broadcast({
						type: _this.MSG_TYPE.BROADCAST,
						peerid: data.peerid,
						peername: data.peername,
						to: data.to,
						data: data.data,
					});
					break;
				}
				case _this.MSG_TYPE.RENAME: {
					_this.connToClients[data.peerid].peername = data.peername;
					_this.broadcast({
						type: _this.MSG_TYPE.RENAME,
						peerid: data.peerid,
						peername: data.peername
					});
				}
				case _this.MSG_TYPE.PING: {
					_this.connToClients[data.peerid]._lastPingTimestamp = (new Date()).getTime();
					_this.connToClients[data.peerid].send({
						type: _this.MSG_TYPE.ACK,
						timestamp: (new Date()).getTime(),
					});
					break;
				}
				case _this.MSG_TYPE.MEMBERS_REQ: {
					var members = [];
					for (var id in _this.connToClients) {
						var conn = _this.connToClients[id];
						members.push({ peerid: id, peername: conn.peername });
					}
					_this.connToClients[data.peerid].send({
						type: _this.MSG_TYPE.MEMBERS_REP,
						members: members
					});
					break;
				}
			}
		});
		this.broadcastDepartureOnClose(this.connToClients[peerid]);
	},
	broadcastDepartureOnClose: function(conn) {
		var _this = this;
		conn.on('close', function() {
			_this.closeClientConnection(conn);
		});
	},
	closeClientConnection: function(conn) {
		conn.close();
		delete this.connToClients[conn.peer];
		if (conn._pingInterval)
			clearInterval(conn._pingInterval);
		this.broadcast({ type: this.MSG_TYPE.DEPARTURE, peerid: conn.peer, peername: conn.peername });
	},
	broadcast: function(data) {
		for (var id in this.connToClients) {
			if (!data.to || (data.to == id) || (data.peerid == id))
				this.connToClients[id].send({
					type: data.type,
					peerid: data.peerid,
					peername: data.peername,
					to: data.to,
					data: data.data
				});
		}
	},
	createServer: function() {
		var _this = this;
		this._lastAckTimestamp = null;
		this.emptyConnToClients();
		this.server = new Peer(this.ROOMID, this.OPTIONS);
		this.server.on('error', function(e) {
			if (e.toString().match(/ID.*is taken/))
				_this.createClient((_this.server = null));
		});
		this.server.on('open', function() {
			_this.event('server', {
				id: _this.server.id,
				host: _this.server.options.host,
				port: _this.server.options.port
			});
			_this.createClient();
			_this.server.on('connection', function(conn) {
				_this.connToClients[conn.peer] = conn;
				_this.handleConnToClient(conn.peer);
			});
		});
	},
	createClient: function() {
		var _this = this;
		this.client = new Peer(this.OPTIONS);
		this.client.on('error', this.event.bind(this, 'error'));
		this.client.on('open', function(id) {
			_this.id = id;
			_this.connToServer = _this.client.connect(_this.ROOMID);
			_this.connToServer.on('open', function() {
				if (_this.OPTIONS.name)
					_this.connToServer.send({
						type: _this.MSG_TYPE.RENAME,
						peerid: _this.id,
						peername: _this.OPTIONS.name
					});
				_this.handleConnToServer();
				_this.client.disconnect();
				if (_this.refreshMembersInterval)
					clearInterval(_this.refreshMembersInterval);
				_this.refreshMembers(_this);
				_this.refreshMembersInterval = setInterval(_this.refreshMembers, 30*1000, _this);
			});
		});
	},
	send: function(data, to) {
		this.connToServer.send({
			type: this.MSG_TYPE.CHAT,
			peerid: this.client.id || this.client._lastServerId,
			peername: (this.OPTIONS.name || this.id),
			to: to,
			data: data
		});
	},
	handleConnToServer: function() {
		var _this = this;
		this.connToServer.on('error', this.event.bind(this, 'error'));
		this.connToServer.on('data', function(data) {
			switch(data.type) {
				case _this.MSG_TYPE.NEW_MEMBER: {
					var displayName = data.peername || data.peerid;
					_this.list[data.peerid] = displayName;
					_this.event('join', displayName);
					break;
				}
				case _this.MSG_TYPE.RENAME: {
					var displayName = data.peername || data.peerid;
					_this.list[data.peerid] = displayName;
					break;
				}
				case _this.MSG_TYPE.BROADCAST: {
					var displayName = data.peername || data.peerid;
					_this.list[data.peerid] = displayName;
					_this.event('data', Object.assign({
						id: ((data.peerid == _this.id) ? 'me' : data.peerid),
						name: displayName,
						data: data.data,
					}, (data.to ? { private: true } : {})));
					break;
				}
				case _this.MSG_TYPE.DEPARTURE: {
					var displayName = data.peername || data.peerid;
					delete _this.list[data.peerid];
					_this.event('left', displayName);
					break;
				}
				case _this.MSG_TYPE.ACK: {
					if (!_this._lastAckTimestamp || _this._lastAckTimestamp < data.timestamp)
						_this._lastAckTimestamp = data.timestamp;
					break;
				}
				case _this.MSG_TYPE.MEMBERS_REP: {
					_this.list = {};
					for (var i = 0; i < data.members.length; i++) {
						var m = data.members[i];
						var displayName = m.peername || m.peerid;
						_this.list[m.peerid] = displayName;
					}
					break;
				}
			}
			_this.event('list', _this.list);
		});
		this.connToServer.on('close', _this.createServer.bind(_this));
	},
	refreshMembers: function(_this) {
		_this.connToServer.send({
			type: _this.MSG_TYPE.MEMBERS_REQ,
			peerid: _this.client.id || _this.client._lastServerId,
		});
	}
});
