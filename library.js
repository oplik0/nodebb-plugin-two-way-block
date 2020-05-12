'use strict';
const LRU = require("lru-cache");

const db = require.main.require('./src/database');

const twoWayBlock = {};
const cache = new LRU({
			max: 100,
			length: function () { return 1; },
			maxAge: 0,
		})
twoWayBlock.init = async function (data) {
	return;
};
twoWayBlock.addBlock = async function (data) {
	const {uid, targetUid} = data;
	await db.sortedSetAdd(`uid:${targetUid}:blocked_by_uids`, Date.now(), uid);
	cache.del(parseInt(targetUid, 10));
}
twoWayBlock.removeBlock = async function(data) {
	const {uid, targetUid} = data
	await db.sortedSetRemove(`uid:${targetUid}:blocked_by_uids`, uid);
	cache.del(parseInt(targetUid, 10));
}
twoWayBlock.filterBlocks = async function (data) {
	const { set, property, uid } = data;
	const blocked_by_uids = await twoWayBlock.list(uid);
	const blockedSet = new Set(blocked_by_uids);
	const isPlain = typeof set[0] !== "object";
    data.set = set.filter(
		(item) => !blockedSet.has(parseInt(isPlain ? item : item[property], 10))
	);

    return data;
}
twoWayBlock.list = async function(uid) {
	if (cache.has(parseInt(uid, 10))) {
		return cache.get(parseInt(uid, 10));
	}
	let blocked_by = await db.getSortedSetRange('uid:' + uid + ':blocked_by_uids', 0, -1);
	blocked_by = blocked_by.map(uid => parseInt(uid, 10)).filter(Boolean);
	cache.set(parseInt(uid, 10), blocked_by);
	return blocked_by;
}

twoWayBlock.filterTeasers = async function(data) {
	const blocked_by_uids = await twoWayBlock.list(data.uid);
	const blockedSet = new Set(blocked_by_uids);
	data.teasers = data.teasers.filter(
        (postData) => !blockedSet.has(parseInt(postData.uid, 10))
	);
	return data;
}

module.exports = twoWayBlock;
