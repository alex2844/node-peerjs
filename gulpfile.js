const
	{ fetch } = require('js-global-fetch'),
	fs = require('fs'),
	path = require('path'),
	gulp = require('gulp');

gulp.task('build', done => {
	let info = require(path.resolve(__dirname, 'package.json')),
		fn = path.join(__dirname, 'dist', 'peerjs.js'),
		dn = path.dirname(fn);
	if (!fs.existsSync(dn))
		fs.mkdirSync(dn, { recursive: true });
	fetch('https://raw.githubusercontent.com/peers/peerjs/master/package.json').then(res => res.json()).then(rinfo => {
		fetch('https://raw.githubusercontent.com/peers/peerjs/master/dist/peerjs.min.js').then(res => res.text()).then(lib => {
			fs.readFile(path.resolve(__dirname, 'src', 'room.js'), 'utf8', (err, room_) => {
				fs.readFile(path.resolve(__dirname, 'src', 'fetch.js'), 'utf8', (err, fetch_) => {
					fetch("https://closure-compiler.appspot.com/compile", {
						method: 'POST',
						headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
						body: 'output_info=compiled_code&js_code='+encodeURIComponent(room_+fetch_+"Peer.version={'node-peer': '"+info.version+"', peerjs: '"+rinfo.version+"'}")
					}).then(res => res.text()).then(compiler => {
						fs.writeFile(fn, lib
							.replace('CLOUD_HOST="0.peerjs.com"', 'CLOUD_HOST=location.hostname')
							.replace('CLOUD_PORT=443', 'CLOUD_PORT=8008')
							.replace('void 0===c._options.secure&&c._options.host!==s.util.CLOUD_HOST?c._options.secure=s.util.isSecure():c._options.host==s.util.CLOUD_HOST&&(c._options.secure=!0)', 'void 0===c._options.secure&&(c._options.secure=s.util.isSecure())')
							.replace('case"disconnected":', 'case"disconnected":n.connection.close(),') // FIX LEFT
							.replace(/\n\/\/# (.*?)$/, ';')
						+compiler, err => {
							done();
						});
					});
				});
			});
		});
	});
});
gulp.task('default', gulp.series('build'));
