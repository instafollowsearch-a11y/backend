import InstagramCache from "../models/InstagramCache.js";
import { useApifyForFollowLists, getApifyListMaxCount } from "./apifyDataDopingService.js";
import { firstPageFromFullList, getListPageSize } from "./utils/listPagination.js";
import {
  getUserInfo,
  getFollowers,
  getFollowing,
  getUserStories,
  updateCache,
  getPostLikers,
  getPostLikersOrThrow,
  getPostComments,
  getPostComentsWithCap,
  commentMatchesUser,
  getNextFollowersData,
  getNextFollowingData,
  fetchUserMedias,
  fetchMoreUserMedias,
  checkFollowsViaHiker,
} from "./utils/hikerHelperFunctions.js";

const SHARED_ACTIVITY_POST_LIMIT = Math.max(
  1,
  Number(process.env.SHARED_ACTIVITY_POST_LIMIT || 10)
);
const SHARED_ACTIVITY_COMMENT_CAP = Math.max(
  1,
  Number(process.env.SHARED_ACTIVITY_COMMENT_CAP || 40)
);
const SHARED_ACTIVITY_CONCURRENCY = Math.max(
  1,
  Number(process.env.SHARED_ACTIVITY_CONCURRENCY || 5)
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run async tasks with a fixed concurrency pool.
 * @template T
 * @param {Array<() => Promise<T>>} tasks
 * @param {number} concurrency
 * @returns {Promise<T[]>}
 */
const mapPool = async (tasks, concurrency) => {
  const results = new Array(tasks.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    async () => {
      while (nextIndex < tasks.length) {
        const i = nextIndex++;
        results[i] = await tasks[i]();
      }
    }
  );
  await Promise.all(workers);
  return results;
};

const mediaIdFromPost = (post) => post?.pk ?? post?.id;

const likerMatchesUser = (liker, targetUserId, targetUsername) => {
  if (!liker) return false;
  const ids = [liker.id, liker.pk]
    .filter((v) => v != null)
    .map(String);
  if (ids.includes(String(targetUserId))) return true;
  const uname = String(targetUsername || "").toLowerCase();
  if (!uname) return false;
  return String(liker.username || "").toLowerCase() === uname;
};

const summarizePost = (post) => ({
  postId: mediaIdFromPost(post),
  code: post.code,
  caption: post.caption?.text || "",
  imageUrl: post.image_versions2?.candidates?.[0]?.url || null,
});

/**
 * Fetch likers + comments for one post with one retry; never silent empty on hard fail.
 */
const fetchPostEngagement = async ({
  post,
  targetUserId,
  targetUsername,
  commentCap,
}) => {
  const mediaId = mediaIdFromPost(post);
  let likers = [];
  let comments = [];
  let likersError = null;
  let commentsError = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      likers = await getPostLikersOrThrow(mediaId);
      likersError = null;
      break;
    } catch (err) {
      likersError = err.message || "likers_failed";
      if (attempt === 0) await sleep(400);
    }
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      comments = await getPostComentsWithCap(mediaId, commentCap, {
        targetUserId,
        targetUsername,
        earlyExit: true,
      });
      commentsError = null;
      break;
    } catch (err) {
      commentsError = err.message || "comments_failed";
      if (attempt === 0) await sleep(400);
    }
  }

  return {
    post,
    mediaId,
    likers,
    comments,
    failed: Boolean(likersError || commentsError),
    errors: {
      likers: likersError,
      comments: commentsError,
    },
  };
};

const listStorageCap = (forPremium) =>
  Math.min(getApifyListMaxCount(forPremium), 500);

/** Apify lists are newest-first (full scrape). Legacy hiker provider uses cache diff. */
const followListForDisplay = (fullList, previousList) => {
  const list = Array.isArray(fullList) ? fullList : [];
  if (useApifyForFollowLists()) {
    return [...list];
  }
  const previousIds = new Set(
    (previousList || [])
      .map((u) => u?.id ?? u?.pk ?? u?.username)
      .filter(Boolean)
      .map(String)
  );
  return list.filter((u) => {
    const key = u?.id ?? u?.pk ?? u?.username;
    return key && !previousIds.has(String(key));
  });
};

const profileCount = (userInfo, ...keys) => {
  for (const key of keys) {
    const n = userInfo?.[key];
    if (typeof n === "number" && n > 0) return n;
  }
  return 0;
};

const assertListWhenProfileHasCount = (
  list,
  profileCountValue,
  label,
  username = ""
) => {
  if (profileCountValue > 0 && (!list || list.length === 0)) {
    const handle = username ? `@${username}` : "this account";
    throw new Error(
      `We could not load recent ${label} for ${handle}. Please try again in a few minutes.`
    );
  }
};

const wantsFollowers = (searchType) =>
  !searchType || searchType === "both" || searchType === "followers";

const wantsFollowing = (searchType) =>
  !searchType || searchType === "both" || searchType === "following";

const getCacheTtlMinutes = () => {
  const n = parseInt(process.env.FOLLOW_CACHE_TTL_MINUTES || "30", 10);
  return Number.isFinite(n) && n > 0 ? n : 30;
};

const getRedFlagPostLimit = (forPremium) => {
  const raw = forPremium
    ? process.env.ADVANCED_RED_FLAG_POSTS ?? "6"
    : process.env.PUBLIC_RED_FLAG_POSTS ?? "0";
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : forPremium ? 6 : 0;
};

const emptyFollowersData = () => ({
  followers: [],
  followersFull: [],
  nextPageId: null,
});

const emptyFollowingData = () => ({
  following: [],
  followingFull: [],
  nextPageId: null,
});

const followersDataFromCachedList = (list, forPremium = true) => {
  const capped = (list || []).slice(0, listStorageCap(forPremium));
  const pageSize = getListPageSize();
  const { page, nextPageId } = firstPageFromFullList(capped, pageSize);
  return { followers: page, followersFull: capped, nextPageId };
};

const followingDataFromCachedList = (list, forPremium = true) => {
  const capped = (list || []).slice(0, listStorageCap(forPremium));
  const pageSize = getListPageSize();
  const { page, nextPageId } = firstPageFromFullList(capped, pageSize);
  return { following: page, followingFull: capped, nextPageId };
};

const cachedListUsable = (list, forPremium, apifyMax) => {
  const len = Array.isArray(list) ? list.length : 0;
  if (len === 0) return false;
  if (!forPremium) return true;
  const publicCap = getApifyListMaxCount(false);
  if (len <= publicCap && apifyMax > publicCap) return false;
  return true;
};

const fetchFollowLists = async ({
  userId,
  username,
  searchType,
  forPremium,
  cachedData,
  userInfo = null,
}) => {
  const needFollowers = wantsFollowers(searchType);
  const needFollowing = wantsFollowing(searchType);
  const apifyMax = getApifyListMaxCount(forPremium);
  const cacheFresh =
    useApifyForFollowLists() &&
    cachedData &&
    typeof cachedData.isFresh === "function" &&
    cachedData.isFresh(getCacheTtlMinutes());

  if (
    cacheFresh &&
    (!needFollowers ||
      cachedListUsable(cachedData.followers, forPremium, apifyMax)) &&
    (!needFollowing ||
      cachedListUsable(cachedData.following, forPremium, apifyMax))
  ) {
    return {
      followersData: needFollowers
        ? followersDataFromCachedList(cachedData.followers, forPremium)
        : emptyFollowersData(),
      followingData: needFollowing
        ? followingDataFromCachedList(cachedData.following, forPremium)
        : emptyFollowingData(),
      fromCache: true,
    };
  }

  const [followersData, followingData] = await Promise.all([
    needFollowers
      ? getFollowers({ userId, username, fetchOnce: true, maxCount: apifyMax })
      : Promise.resolve(emptyFollowersData()),
    needFollowing
      ? getFollowing({ userId, username, fetchOnce: true, maxCount: apifyMax })
      : Promise.resolve(emptyFollowingData()),
  ]);

  const followersFull =
    followersData?.followersFull ?? followersData?.followers ?? [];
  const followingFull =
    followingData?.followingFull ?? followingData?.following ?? [];

  if (userInfo) {
    if (needFollowers) {
      assertListWhenProfileHasCount(
        followersFull,
        profileCount(userInfo, "followerCount", "follower_count"),
        "recent followers",
        username
      );
    }
    if (needFollowing) {
      assertListWhenProfileHasCount(
        followingFull,
        profileCount(userInfo, "followingCount", "following_count"),
        "recent following",
        username
      );
    }
  }

  return { followersData, followingData, fromCache: false };
};

const buildFollowKeySet = (users = []) => {
  const keys = new Set();
  for (const u of users) {
    if (u?.id != null) keys.add(String(u.id));
    if (u?.pk != null) keys.add(String(u.pk));
    if (u?.username) keys.add(String(u.username).toLowerCase());
  }
  return keys;
};

const likerMatchesFollowLists = (liker, followerKeys, followingKeys) => {
  const ids = [liker.id, liker.pk].filter(Boolean).map(String);
  const username = liker.username ? String(liker.username).toLowerCase() : null;
  for (const id of ids) {
    if (followerKeys.has(id) || followingKeys.has(id)) return true;
  }
  if (username && (followerKeys.has(username) || followingKeys.has(username))) {
    return true;
  }
  return false;
};

/** Fetch post likers only (no follow-list filter). Safe to run parallel with Apify. */
const fetchLikerFrequencyMap = async (userId, postLimit) => {
  if (!postLimit || postLimit <= 0) return {};

  const userPosts = await fetchUserMedias(userId, postLimit);
  const userPostsData = await Promise.all(
    (userPosts?.medias || []).map(async (post) => {
      const likers = await getPostLikers(post.id);
      return { post, likers };
    })
  );

  const likerMap = {};
  for (const { likers } of userPostsData) {
    for (const liker of likers) {
      const likerKey = String(liker.id ?? liker.pk ?? liker.username ?? "");
      if (!likerKey) continue;
      if (!likerMap[likerKey]) {
        likerMap[likerKey] = { user: { ...liker }, count: 0 };
      }
      likerMap[likerKey].count += 1;
    }
  }
  return likerMap;
};

const redFlagsFromLikerMap = (likerMap, followersFull, followingFull) => {
  const followerKeys = buildFollowKeySet(followersFull);
  const followingKeys = buildFollowKeySet(followingFull);

  return Object.values(likerMap)
    .filter((entry) => entry.count > 1)
    .map((entry) => ({ ...entry.user, count: entry.count }))
    .filter((liker) =>
      likerMatchesFollowLists(liker, followerKeys, followingKeys)
    );
};

const scheduleCacheUpdate = (username, payload) => {
  updateCache(username, payload).catch((err) => {
    console.error("Background cache update failed:", err.message);
  });
};

export const getRecentActivity = async (
  username,
  userSubscription = "free",
  searchType = "both"
) => {
  const startTime = Date.now();
  try {
    const [userInfo, cachedData] = await Promise.all([
      getUserInfo(username),
      InstagramCache.findOne({ where: { username } }),
    ]);

    const previousFollowers = cachedData?.followers || [];
    const previousFollowing = cachedData?.following || [];
    const userId = userInfo.id || userInfo.pk;

    const redFlagLimit = getRedFlagPostLimit(false);
    const [{ followersData, followingData, fromCache }, likerMap] =
      await Promise.all([
        fetchFollowLists({
          userId,
          username,
          searchType: "both",
          forPremium: false,
          cachedData,
          userInfo,
        }),
        fetchLikerFrequencyMap(userId, redFlagLimit),
      ]);

    const followersFull =
      followersData?.followersFull ?? followersData?.followers ?? [];
    const followingFull =
      followingData?.followingFull ?? followingData?.following ?? [];
    const followers = followersData?.followers ?? followersFull;
    const following = followingData?.following ?? followingFull;

    const cacheFollowers =
      followersFull.length > 0 ? followersFull : previousFollowers;
    const cacheFollowing =
      followingFull.length > 0 ? followingFull : previousFollowing;

    const redFlags = redFlagsFromLikerMap(
      likerMap,
      cacheFollowers,
      cacheFollowing
    );

    scheduleCacheUpdate(username, {
      userData: userInfo,
      followers: cacheFollowers,
      following: cacheFollowing,
    });

    const newFollowers = followListForDisplay(followersFull, previousFollowers);
    const newFollowing = followListForDisplay(followingFull, previousFollowing);

    return {
      userInfo,
      newFollowers,
      newFollowing,
      stories: null,
      redFlags,
      followers,
      following,
      followListOrder: useApifyForFollowLists() ? "chronological" : "diff",
      totalNewFollowers: newFollowers.length,
      totalNewFollowing: newFollowing.length,
      lastUpdated: new Date(),
      totalFollowers: followersFull.length,
      totalFollowing: followingFull.length,
      processingTime: Date.now() - startTime,
      cacheHit: fromCache,
    };
  } catch (error) {
    console.error("Error getting recent activity:", error.message);
    throw error;
  }
};

export const getAdvancedActivity = async (
  username,
  userSubscription = "free",
  searchType = "both"
) => {
  const startTime = Date.now();
  try {
    const [userInfo, cachedData] = await Promise.all([
      getUserInfo(username),
      InstagramCache.findOne({ where: { username } }),
    ]);

    const previousFollowers = cachedData?.followers || [];
    const previousFollowing = cachedData?.following || [];
    const userId = userInfo.id || userInfo.pk;

    const redFlagLimit = getRedFlagPostLimit(true);
    const [
      { followersData, followingData, fromCache },
      stories,
      likerMap,
    ] = await Promise.all([
      fetchFollowLists({
        userId,
        username,
        searchType,
        forPremium: true,
        cachedData,
        userInfo,
      }),
      getUserStories({ userId }),
      fetchLikerFrequencyMap(userId, redFlagLimit),
    ]);

    const followersFull =
      followersData?.followersFull ?? followersData?.followers ?? [];
    const followingFull =
      followingData?.followingFull ?? followingData?.following ?? [];
    const followers = followersData?.followers ?? followersFull;
    const following = followingData?.following ?? followingFull;

    const cacheFollowers =
      followersFull.length > 0 ? followersFull : previousFollowers;
    const cacheFollowing =
      followingFull.length > 0 ? followingFull : previousFollowing;

    const redFlags = redFlagsFromLikerMap(
      likerMap,
      cacheFollowers,
      cacheFollowing
    );

    scheduleCacheUpdate(username, {
      userData: userInfo,
      followers: cacheFollowers,
      following: cacheFollowing,
    });

    const newFollowers = followListForDisplay(followersFull, previousFollowers);
    const newFollowing = followListForDisplay(followingFull, previousFollowing);

    return {
      userInfo,
      newFollowers,
      newFollowing,
      stories,
      redFlags,
      followListOrder: useApifyForFollowLists() ? "chronological" : "diff",
      totalNewFollowers: newFollowers.length,
      totalNewFollowing: newFollowing.length,
      lastUpdated: new Date(),
      totalFollowers: followersFull.length,
      totalFollowing: followingFull.length,
      processingTime: Date.now() - startTime,
      followersNextPageId: followersData?.nextPageId,
      followingNextPageId: followingData?.nextPageId,
      followers,
      following,
      cacheHit: fromCache,
    };
  } catch (error) {
    console.error("Error getting advanced activity:", error.message);
    throw error;
  }
};

export const getSharedActivity = async (username1, username2) => {
  const startTime = Date.now();
  try {
    const [firstUser, secondUser] = await Promise.all([
      getUserInfo(username1),
      getUserInfo(username2),
    ]);

    const firstUserId = firstUser.id || firstUser.pk;
    const secondUserId = secondUser.id || secondUser.pk;

    const [firstFollowsSecond, secondFollowsFirst] = await Promise.all([
      checkFollowsViaHiker({ sourceUser: firstUser, targetUser: secondUser }),
      checkFollowsViaHiker({ sourceUser: secondUser, targetUser: firstUser }),
    ]);
    const isFirstFollowingSecond = firstFollowsSecond.follows;
    const isSecondFollowingFirst = secondFollowsFirst.follows;

    const [firstUserPosts, secondUserPosts] = await Promise.all([
      fetchUserMedias(firstUserId, SHARED_ACTIVITY_POST_LIMIT),
      fetchUserMedias(secondUserId, SHARED_ACTIVITY_POST_LIMIT),
    ]);

    const firstMedias = firstUserPosts?.medias || [];
    const secondMedias = secondUserPosts?.medias || [];

    const firstTasks = firstMedias.map(
      (post) => () =>
        fetchPostEngagement({
          post,
          targetUserId: secondUserId,
          targetUsername: secondUser.username,
          commentCap: SHARED_ACTIVITY_COMMENT_CAP,
        })
    );
    const secondTasks = secondMedias.map(
      (post) => () =>
        fetchPostEngagement({
          post,
          targetUserId: firstUserId,
          targetUsername: firstUser.username,
          commentCap: SHARED_ACTIVITY_COMMENT_CAP,
        })
    );

    const [firstUserPostData, secondUserPostData] = await Promise.all([
      mapPool(firstTasks, SHARED_ACTIVITY_CONCURRENCY),
      mapPool(secondTasks, SHARED_ACTIVITY_CONCURRENCY),
    ]);

    const partialErrors = [];
    const firstUserPostsLikedBySecond = [];
    const secondUserPostsLikedByFirst = [];
    const firstUserPostsCommentedBySecond = [];
    const secondUserPostsCommentedByFirst = [];

    for (const row of firstUserPostData) {
      if (row.failed) {
        partialErrors.push({
          owner: "firstUser",
          mediaId: row.mediaId,
          errors: row.errors,
        });
      }
      if (row.likers.some((u) => likerMatchesUser(u, secondUserId, secondUser.username))) {
        firstUserPostsLikedBySecond.push(summarizePost(row.post));
      }
      if (
        row.comments.some((c) =>
          commentMatchesUser(c, secondUserId, secondUser.username)
        )
      ) {
        firstUserPostsCommentedBySecond.push(summarizePost(row.post));
      }
    }

    for (const row of secondUserPostData) {
      if (row.failed) {
        partialErrors.push({
          owner: "secondUser",
          mediaId: row.mediaId,
          errors: row.errors,
        });
      }
      if (row.likers.some((u) => likerMatchesUser(u, firstUserId, firstUser.username))) {
        secondUserPostsLikedByFirst.push(summarizePost(row.post));
      }
      if (
        row.comments.some((c) =>
          commentMatchesUser(c, firstUserId, firstUser.username)
        )
      ) {
        secondUserPostsCommentedByFirst.push(summarizePost(row.post));
      }
    }

    return {
      firstUser,
      secondUser,
      isFirstFollowingSecond,
      isSecondFollowingFirst,
      firstUserPostsLikedBySecond,
      secondUserPostsLikedByFirst,
      firstUserPostsCommentedBySecond,
      secondUserPostsCommentedByFirst,
      firstUserPostLength: firstMedias.length,
      secondUserPostLength: secondMedias.length,
      postScanLimit: SHARED_ACTIVITY_POST_LIMIT,
      commentScanCap: SHARED_ACTIVITY_COMMENT_CAP,
      likesAreSampled: true,
      partialErrors,
      processingTime: Date.now() - startTime,
    };
  } catch (error) {
    console.error("Error getting shared activity:", error.message);
    throw error;
  }
};

export const getInstagramAdmirers = async (username) => {
  const startTime = Date.now();
  try {
    // Step 1: Get user info
    const userinfo = await getUserInfo(username);
    const userId = userinfo.id || userinfo.pk;

    // Step 2: Get recent posts
    const userPosts = await fetchUserMedias(userId, 48);

    // Step 3: Get likers for each post
    const postsWithLikers = await Promise.all(
      userPosts?.medias?.map(async (post) => {
        const likers = await getPostLikers(post.id);
        return { post, likers };
      })
    );

    // Step 4: Count likes per user across all posts
    const likerCounts = {}; // { userId: { count, username, profilePicUrl } }

    postsWithLikers.forEach(({ likers }) => {
      likers.forEach((liker) => {
        if (!likerCounts[liker.pk]) {
          likerCounts[liker.pk] = {
            id: liker.pk,
            username: liker.username,
            profilePicUrl: liker.profile_pic_url,
            count: 0,
          };
        }
        likerCounts[liker.pk].count++;
      });
    });

    // Step 5: Convert counts to percentage
    const totalPosts = userPosts?.medias?.length || 0;
    let admirers = Object.values(likerCounts).map((liker) => ({
      id: liker.id,
      username: liker.username,
      profilePicUrl: liker.profilePicUrl,
      likePercentage: totalPosts > 0 ? Math.round((liker.count / totalPosts) * 100) : 0,
    }));

    // Step 6: Sort & rank
    admirers = admirers
      .sort((a, b) => b.likePercentage - a.likePercentage || a.username.localeCompare(b.username))
      .map((item, idx) => ({ ...item, rank: idx + 1 }));

    admirers = admirers.slice(0, 100);

    return {
      success: true,
      userinfo,
      admirers,
      processingTime: Date.now() - startTime,
    };
  } catch (error) {
    console.error("Error getting admirers:", error.message);
    throw error;
  }
};

/** Story site: profile, posts, stories only — no Apify followers/following (tabs funnel to main site). */
export const getStoryViewerProfile = async (username) => {
  const startTime = Date.now();
  const postLimit = (() => {
    const n = parseInt(process.env.STORY_VIEWER_POST_LIMIT || "9", 10);
    return Number.isFinite(n) && n > 0 ? n : 9;
  })();

  try {
    const userinfo = await getUserInfo(username);
    const userId = userinfo.id || userinfo.pk;
    const [userPosts, userStories] = await Promise.all([
      fetchUserMedias(userId, postLimit),
      getUserStories({ userId }),
    ]);

    return {
      success: true,
      userinfo,
      userPosts,
      userStories,
      userFollowers: { followers: [], nextPageId: null },
      userFollowing: { following: [], nextPageId: null },
      totalPosts: Array.isArray(userPosts?.medias) ? userPosts.medias.length : 0,
      processingTime: Date.now() - startTime,
    };
  } catch (error) {
    console.error("Error getting story viewer profile:", error.message);

    return {
      success: false,
      error: error.message,
      userinfo: null,
      userPosts: [],
      userStories: null,
      userFollowers: null,
      userFollowing: null,
      totalPosts: 0,
      processingTime: Date.now() - startTime,
    };
  }
};

export const getInstagramProfileDetails = async (username, { forPremium = false } = {}) => {
  const startTime = Date.now();
  const listMax = getApifyListMaxCount(forPremium);

  try {
    const userinfo = await getUserInfo(username);
    const userId = userinfo.id || userinfo.pk;
    const [userPosts, userStories, userFollowers, userFollowing] = await Promise.all([
      fetchUserMedias(userId, 24),
      getUserStories({ userId }),
      getFollowers({ userId, username, fetchOnce: true, maxCount: listMax }),
      getFollowing({ userId, username, fetchOnce: true, maxCount: listMax }),
    ]);

    return {
      success: true,
      userinfo,
      userPosts,
      userStories,
      userFollowers,
      userFollowing,
      totalPosts: userPosts.length,
      processingTime: Date.now() - startTime,
    };
  } catch (error) {
    console.error("Error getting profile details:", error.message);
    console.error("Full error:", error);
    
    return {
      success: false,
      error: error.message,
      userinfo: null,
      userPosts: [],
      userStories: null,
      userFollowers: null,
      userFollowing: null,
      totalPosts: 0,
      processingTime: Date.now() - startTime,
    };
  }
};


export const getNextFollowers = async (userId, nextPageId) => {
  try {
    const data = await getNextFollowersData({ userId, nextPageId })
    return data
  } catch (error) {
    console.error("Error getting next followers:", error.message);
    throw error;
  }
};
export const getNextFollowing = async (userId, nextPageId) => {
  try {
    const data = await getNextFollowingData({ userId, nextPageId })
    return data
  } catch (error) {
    console.error("Error getting next following:", error.message);
    throw error;
  }
};
export const getNextMedias = async (userId, nextPageId) => {
  try {
    const data = await fetchMoreUserMedias(userId, nextPageId )
    return data
  } catch (error) {
    console.error("Error getting next medias:", error.message);
    throw error;
  }
};