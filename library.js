'use strict';

const createCache = require.main.require('./src/cacheCreate');

const db = require.main.require('./src/database');
const posts = require.main.require('./src/posts');
const user = require.main.require('./src/user');
const topics = require.main.require('./src/topics');
const winston = require.main.require('winston');

const twoWayBlock = {};
const cache = createCache({
	name: 'nodebb-plugin-two-way-block',
	max: 1024,
	maxSize: 4096,
	sizeCalculation: n => n.length || 1,
	ttl: 1000 * 60 * 60 * 24,
});
twoWayBlock.addBlock = async function (data) {
	const { uid, targetUid } = data;
	await db.sortedSetAdd(`uid:${targetUid}:blocked_by_uids`, Date.now(), uid);
	cache.delete(parseInt(targetUid, 10));
};
twoWayBlock.removeBlock = async function (data) {
	const { uid, targetUid } = data;
	await db.sortedSetRemove(`uid:${targetUid}:blocked_by_uids`, uid);
	cache.delete(parseInt(targetUid, 10));
};
twoWayBlock.filterBlocks = async function (data) {
	const { set, property, uid } = data;
	const blockedByUids = await twoWayBlock.list(uid);
	const isPlain = typeof set[0] !== 'object';
	data.set = set.filter(
		item => !blockedByUids.has(parseInt(isPlain ? item : item[property], 10))
	);

	return data;
};
twoWayBlock.list = async function (uid) {
	uid = parseInt(uid, 10);
	const cached = cache.get(uid);
	if (cached?.length) {
		return new Set(cached);
	}
	const blockedBy = await db.getSortedSetRange(
		`uid:${uid}:blocked_by_uids`,
		0,
		-1
	);
	const blockedBySet = new Set(blockedBy.map(blocked_by_uid => parseInt(blocked_by_uid, 10)).filter(Boolean));
	cache.set(uid, blockedBySet);
	return blockedBySet;
};

twoWayBlock.filterTeasers = async function (data) {
	try {
		const blockedByUids = await twoWayBlock.list(data.uid);
		if (data.teasers && data.teasers.length > 0) {
			data.teasers = await Promise.all(
				data.teasers.map((postData) => {
					if (!postData) return undefined;
					return blockedByUids.has(parseInt(postData.user ? postData.user.uid : postData.uid, 10)) ?
						getPreviousNonBlockedPost(postData, blockedByUids) :
						postData;
				})
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
	if (isBlocked) {
		return undefined;
	}
	prevPost.user = await user.getUserFields(prevPost.uid, ['uid', 'username', 'userslug', 'picture']);
	return prevPost;
}

module.exports = twoWayBlock;
