'use strict';

const LRU = require('lru-cache');

const db = require.main.require('./src/database');
const posts = require.main.require('./src/posts');
const user = require.main.require('./src/user');
const topics = require.main.require('./src/topics');
const winston = require.main.require('winston');

const twoWayBlock = {};
const cache = new LRU({
	max: 100,
	length: function () {
		return 1;
	},
	maxAge: 0,
});
twoWayBlock.addBlock = async function (data) {
	const { uid, targetUid } = data;
	await db.sortedSetAdd(`uid:${targetUid}:blocked_by_uids`, Date.now(), uid);
	cache.del(parseInt(targetUid, 10));
};
twoWayBlock.removeBlock = async function (data) {
	const { uid, targetUid } = data;
	await db.sortedSetRemove(`uid:${targetUid}:blocked_by_uids`, uid);
	cache.del(parseInt(targetUid, 10));
};
twoWayBlock.filterBlocks = async function (data) {
	const { set, property, uid } = data;
	const blocked_by_uids = await twoWayBlock.list(uid);
	const blockedSet = new Set(blocked_by_uids);
	const isPlain = typeof set[0] !== 'object';
	data.set = set.filter(
		item => !blockedSet.has(parseInt(isPlain ? item : item[property], 10))
	);

	return data;
};
twoWayBlock.list = async function (uid) {
	if (cache.has(parseInt(uid, 10))) {
		return cache.get(parseInt(uid, 10));
	}
	let blocked_by = await db.getSortedSetRange(
		`uid:${uid}:blocked_by_uids`,
		0,
		-1
	);
	blocked_by = blocked_by.map(uid => parseInt(uid, 10)).filter(Boolean);
	cache.set(parseInt(uid, 10), blocked_by);
	return blocked_by;
};

twoWayBlock.filterTeasers = async function (data) {
	try {
		const blocked_by_uids = await twoWayBlock.list(data.uid);
		const blockedSet = new Set(blocked_by_uids);
		if (data.teasers && data.teasers.length > 0) {
			data.teasers = await Promise.all(
				data.teasers.map(postData => (blockedSet.has(parseInt(postData.uid, 10)) ?
					getPreviousNonBlockedPost(postData, blockedSet) :
					postData))
			);
		}
	} catch (e) {
		winston.error(
			`[nodebb-plugin-two-way-block] encountered an error while processing teasers: ${e.stack}`
		);
		if (!(e instanceof TypeError)) {
			throw e;
		}
	}
	return data;
};
async function getPreviousNonBlockedPost(postData, blockedSet) {
	let isBlocked = false;
	let prevPost = postData;
	const postsPerIteration = 5;
	let start = 0;
	let stop = start + postsPerIteration - 1;
	let checkedAllReplies = false;

	function checkBlocked(post) {
		const isPostBlocked = blockedSet.has(parseInt(post.uid, 10));
		prevPost = !isPostBlocked ? post : prevPost;
		return isPostBlocked;
	}

	do {
		/* eslint-disable no-await-in-loop */
		let pids = await db.getSortedSetRevRange(
			`tid:${postData.tid}:posts`,
			start,
			stop
		);
		if (!pids.length) {
			checkedAllReplies = true;
			const mainPid = await topics.getTopicField(postData.tid, 'mainPid');
			pids = [mainPid];
		}
		const prevPosts = await posts.getPostsFields(pids, [
			'pid',
			'uid',
			'timestamp',
			'tid',
			'content',
		]);
		isBlocked = prevPosts.every(checkBlocked);
		start += postsPerIteration;
		stop = start + postsPerIteration - 1;
	} while (isBlocked && prevPost && prevPost.pid && !checkedAllReplies);
	prevPost.user = await user.getUserFields(prevPost.uid, ['uid', 'username', 'userslug', 'picture']);
	return prevPost;
}

module.exports = twoWayBlock;
