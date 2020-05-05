'use strict';
const LRU = require("lru-cache");

const controllers = require('./lib/controllers');
const winston = require.main.require('winston');
const meta = require.main.require('./src/meta');
const db = require.main.require('./src/database');

const twoWayBlock = {};
const cache = new LRU({
			max: 100,
			length: function () { return 1; },
			maxAge: 0,
		})
twoWayBlock.addBlock = async function ({uid, targetUid}) {
	await db.sortedSetAdd(`uid:${targetUid}:blocked_by_uids`, Date.now(), uid);
	cache.del(parseInt(targetUid, 10));
}
twoWayBlock.removeBlock = async function({uid, targetUid}) {
	await db.sortedSetRemove(`uid:${targetUid}:blocked_by_uids`, uid);
	cache.del(parseInt(targetUid, 10));
}
twoWayBlock.filterBlocks = async function ({uid, posts}) {
	const blocked_uids = await twoWayBlock.list(uid);
	const blockedSet = new Set(blocked_uids);
	posts = posts.filter(function (item) {
        return !blockedSet.has(parseInt(isPlain ? item : item[property], 10));
	});
	return {uid, posts};
}
twoWayBlock.list = async function(uid) {
	if (cache.has(parseInt(uid, 10))) {
		return cache.get(parseInt(uid, 10));
	}
	let blocked_by = await db.getSortedSetRange('uid:' + uid + ':blocked_by_uids', 0, -1);
	blocked_by = blocked.map(uid => parseInt(uid, 10)).filter(Boolean);
	cache.set(parseInt(uid, 10), blocked_by);
	return blocked_by;
}

module.exports = twoWayBlock;
