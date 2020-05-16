Peer.Fetch = Object.assign((url, options, l) => {
	let p2p = !!Peer.fetch_,
		ttl = 30 * 60,
		time = Math.round(new Date().getTime()/1000),
		cache = (localStorage.peerFetchCache ? JSON.parse(localStorage.peerFetchCache) : {});
	for (let k in cache) {
		if (cache[k].expires >= time)
			continue;
		delete cache[k];
		localStorage.peerFetchCache = JSON.stringify(cache);
	}
	if (options && (options.ttl !== undefined)) {
		ttl = options.ttl;
		delete options.ttl;
	}
	let hash = JSON.stringify({ url, options }).split('').reduce((a, b) => {
		a = ((a<<5)-a) + b.charCodeAt(0);
		return a & a;
	}, 0);
	return Peer.Fetch.init(options && options.init).catch(() => {}).then(() => {
		if (ttl && cache[hash])
			return new Promise(res => res(Peer.Fetch.response(cache[hash].body, cache[hash].status, cache[hash].headers, cache[hash].url, 'cache')));
		else
			return new Promise((res, rej) => {
				if (ttl && Peer.fetch_ && (!p2p || (Object.keys(Peer.fetch_.list).length > 1))) {
					let data_ = e => {
						if ((e.id == 'me') || (hash != e.data.hash))
							return;
						if (!e.data.pair && !pair)
							Peer.fetch_.send({
								hash: e.data.hash,
								pair: true
							}, (pair = e.id));
						else if ((pair == e.id) && e.data.body) {
							clearTimeout(timer);
							Peer.fetch_.off('data', data_);
							cache[hash] = e.data.body;
							localStorage.peerFetchCache = JSON.stringify(cache);
							return res(Peer.Fetch.response(e.data.body.body, e.data.body.status, e.data.body.headers, e.data.body.url, 'p2p'));
						}
					};
					let pair,
						timer = setTimeout(() => (Peer.fetch_.off('data', data_), rej()), 1500);
					Peer.fetch_.on('data', data_);
					Peer.fetch_.send({ hash });
				}else
					rej();
			});
	}).catch(() => {
		let controller = new AbortController();
		setTimeout(() => controller.abort(), 10000);
		return fetch(url, Object.assign((options || {}), {
			signal: controller.signal
		})).then(e => {
			let body = [],
				reader = e.body.getReader(),
				status = e.status,
				headers = {};
			for (let pair of e.headers.entries()) {
				headers[pair[0]] = pair[1];
			}
			return (function read() {
				return reader.read().then(({ done, value }) => (!done && read(value.forEach(v => body.push(v)))));
			})().then(e => {
				if (ttl) {
					let expires = time + ttl;
					cache[hash] = { url, expires, status, headers, body };
					localStorage.peerFetchCache = JSON.stringify(cache);
				}
				return Peer.Fetch.response(body, status, headers, url, 'remote');
			});
		});
	})
}, {
	response: (body, status, headers, url, method) => Object.defineProperties(new Response(new Uint8Array(body), {
		status, headers
	}), {
		url: { value: url },
		method: { value: method }
	}),
	init: options => new Promise((res, rej) => {
		if (Peer.fetch_)
			res({
				room: Peer.fetch_,
				fetch: Peer.Fetch
			});
		else{
			let timer = setTimeout(() => rej(), 5000);
			Peer.fetch_ = Peer.Room('fetch', options)
			.on('error', e => (clearTimeout(timer), rej(e)))
			.on('join', e => (clearTimeout(timer), res({
				room: Peer.fetch_,
				fetch: Peer.Fetch
			})))
			.on('data', e => {
				let cache = (localStorage.peerFetchCache ? JSON.parse(localStorage.peerFetchCache) : {});
				if ((e.id != 'me') && cache[e.data.hash]) {
					if (e.data.pair == undefined)
						Peer.fetch_.send({
							pair: false,
							hash: e.data.hash
						}, e.id);
					else if (e.data.pair && !e.data.body)
						Peer.fetch_.send({
							pair: true,
							hash: e.data.hash,
							body: cache[e.data.hash]
						}, e.id);
				}
			});
		}
	})
});
