import axios from "axios";
import InstagramCache from "../../models/InstagramCache.js";
import {
  fetchFollowersFromApify,
  fetchFollowingFromApify,
  isHikerFollowListProvider,
  assertApifyConfigured,
} from "../apifyDataDopingService.js";
import {
  getListPageSize,
  sliceListPage,
  firstPageFromFullList,
} from "./listPagination.js";

const hikerApi = axios.create({
  baseURL: "https://api.hikerapi.com",
  headers: {
    Accept: "application/json",
    "x-access-key": process.env.HIKER_API_KEY,
  },
});

const maxLimit = 500;

export const findCacheByUserId = async (userId) => {
  if (userId == null) return null;
  const idStr = String(userId);
  const rows = await InstagramCache.findAll({
    attributes: ["username", "followers", "following", "userData"],
  });
  return (
    rows.find((row) => {
      const ud = row.userData || {};
      return String(ud.id) === idStr || String(ud.pk) === idStr;
    }) ?? null
  );
};

const getUserKey = (user) => {
  const key = user?.id ?? user?.pk ?? user?.username;
  return key === undefined || key === null ? null : String(key);
};

const uniqueUsersInOrder = (users = []) => {
  const seen = new Set();
  const uniqueUsers = [];

  for (const user of users) {
    const key = getUserKey(user);
    if (!key) {
      uniqueUsers.push(user);
      continue;
    }

    if (!seen.has(key)) {
      seen.add(key);
      uniqueUsers.push(user);
    }
  }

  return uniqueUsers;
};

export const getUserInfo = async (username) => {
  try {
    const response = await hikerApi.get("/v2/user/by/username", { params: { username } });
    const userData = response.data.user;
    if (!userData || userData.is_private) throw new Error('User not found or private');

    return {
      id: userData.pk,
      username: userData.username,
      fullName: userData.full_name,
      profilePicUrl: userData.profile_pic_url,
      isVerified: userData.is_verified,
      isPrivate: userData.is_private,
      followerCount: userData.follower_count,
      followingCount: userData.following_count,
      mediaCount: userData.media_count,
      biography: userData.biography,
      externalUrl: userData.external_url,
      // Добавляем дополнительные поля для совместимости
      pk: userData.pk,
      full_name: userData.full_name,
      profile_pic_url: userData.profile_pic_url,
      is_verified: userData.is_verified,
      is_private: userData.is_private,
      follower_count: userData.follower_count,
      following_count: userData.following_count,
      media_count: userData.media_count
    };
  } catch (error) {
    handleApiError(error, 'getting user info');
  }
}

const mapHikerFollowerUser = (user) => ({
  id: user.pk,
  username: user.username,
  fullName: user.full_name,
  profilePicUrl: user.profile_pic_url,
  isVerified: user.is_verified,
  isPrivate: user.is_private,
  followerCount: user.follower_count,
  followingCount: user.following_count,
  mediaCount: user.media_count,
  biography: user.biography,
  externalUrl: user.external_url,
});

const mapHikerFollowingUser = (user) => ({
  id: user.id,
  username: user.username,
  fullName: user.full_name,
  profilePicUrl: user.profile_pic_url,
  isVerified: user.is_verified,
  isPrivate: user.is_private,
  followerCount: user.follower_count,
  followingCount: user.following_count,
  mediaCount: user.media_count,
  biography: user.biography,
  externalUrl: user.external_url,
});

const resolveUsername = async (username, userId) => {
  if (username) return username;
  const cache = await findCacheByUserId(userId);
  return cache?.username ?? null;
};

const getFollowersHiker = async ({ userId, skipOnId = null, fetchOnce = false }) => {
  let results = [];
  let nextPageId = undefined;

  while (results.length < maxLimit) {
    const response = await hikerApi.get("/v2/user/followers", {
      params: { user_id: userId, page_id: nextPageId },
    });
    const users = response.data.response?.users || [];
    const mappedUsers = users.map(mapHikerFollowerUser);
    results = uniqueUsersInOrder([...results, ...mappedUsers]);
    nextPageId = response.data?.next_page_id;
    if (
      !nextPageId ||
      users.length === 0 ||
      users.some((user) => String(user.pk) === String(skipOnId)) ||
      fetchOnce
    ) {
      break;
    }
  }

  return { followers: results.slice(0, maxLimit), nextPageId };
};

const getFollowingHiker = async ({ userId, skipOnId = null, fetchOnce = false }) => {
  let results = [];
  let nextPageId = undefined;

  while (results.length < maxLimit) {
    const response = await hikerApi.get("/gql/user/following/chunk", {
      params: { user_id: userId, end_cursor: nextPageId },
    });
    const users = response.data?.[0] || [];
    const mappedUsers = users.map(mapHikerFollowingUser);
    results = uniqueUsersInOrder([...results, ...mappedUsers]);
    nextPageId = response.data?.[1];
    if (
      !nextPageId ||
      users.length === 0 ||
      users.some((user) => String(user.id) === String(skipOnId)) ||
      fetchOnce
    ) {
      break;
    }
  }

  return { following: results.slice(0, maxLimit), nextPageId };
};

const userMatchesTarget = (user, targetId, targetUsername) => {
  if (!user) return false;
  const ids = [user.id, user.pk, user.pk_id, user.user_id]
    .filter((v) => v !== undefined && v !== null)
    .map(String);
  if (targetId != null && ids.includes(String(targetId))) return true;
  if (
    targetUsername &&
    typeof user.username === "string" &&
    user.username.toLowerCase() === String(targetUsername).toLowerCase()
  ) {
    return true;
  }
  return false;
};

/**
 * Shared Activity only: does source follow target?
 * Uses Hiker's one-request search-in-following (not capped Apify lists / full pagination).
 */
export const checkFollowsViaHiker = async ({ sourceUser, targetUser }) => {
  const sourceId = sourceUser?.id ?? sourceUser?.pk;
  const targetId = targetUser?.id ?? targetUser?.pk;
  const targetUsername = targetUser?.username;

  if (sourceId == null || !targetUsername) {
    return { follows: null, truncated: true };
  }

  try {
    const response = await hikerApi.get("/v1/user/search/following", {
      params: {
        user_id: String(sourceId),
        query: String(targetUsername),
      },
    });
    const users = Array.isArray(response.data) ? response.data : [];
    const follows = users.some((u) => userMatchesTarget(u, targetId, targetUsername));
    return { follows, truncated: false };
  } catch (error) {
    // Search endpoint unavailable → unknown (never claim false)
    if (error.response?.status === 404 || error.response?.status === 422) {
      return { follows: null, truncated: true };
    }
    handleApiError(error, "checking follow relationship");
  }

  return { follows: null, truncated: true };
};

export const getFollowers = async ({
  userId,
  username = null,
  skipOnId = null,
  fetchOnce = false,
  maxCount = null,
}) => {
  try {
    if (isHikerFollowListProvider()) {
      return await getFollowersHiker({ userId, skipOnId, fetchOnce });
    }

    assertApifyConfigured();

    const resolvedUsername = await resolveUsername(username, userId);
    if (!resolvedUsername) {
      throw new Error("User not found. Please check the username and try again.");
    }

    const listMax = maxCount ?? maxLimit;
    let fullList = await fetchFollowersFromApify(resolvedUsername, listMax);

    if (skipOnId) {
      const idx = fullList.findIndex((u) => String(u.id) === String(skipOnId));
      if (idx === -1 && fullList.length >= listMax) {
        fullList = await fetchFollowersFromApify(resolvedUsername, listMax);
      }
    }

    const capped = fullList.slice(0, listMax);
    const { page, nextPageId } = firstPageFromFullList(capped, getListPageSize());

    return {
      followers: fetchOnce ? page : capped,
      nextPageId,
      followersFull: capped,
    };
  } catch (error) {
    handleApiError(error, "getting followers");
  }
};

export const getNextFollowersData = async ({ userId, nextPageId }) => {
  try {
    if (isHikerFollowListProvider()) {
      const response = await hikerApi.get("/v2/user/followers", {
        params: { user_id: Number(userId), page_id: nextPageId },
      });
      const users = response.data.response?.users || [];
      return {
        followers: uniqueUsersInOrder(users.map(mapHikerFollowerUser)),
        nextPageId: response?.data?.next_page_id,
      };
    }

    const cache = await findCacheByUserId(userId);
    if (!cache?.followers?.length) {
      return { followers: [], nextPageId: null };
    }

    const { items, nextPageId: next } = sliceListPage(
      cache.followers,
      nextPageId,
      getListPageSize()
    );
    return { followers: items, nextPageId: next };
  } catch (error) {
    handleApiError(error, "getting followers");
    return { followers: [], nextPageId: null };
  }
};

export const getFollowing = async ({
  userId,
  username = null,
  skipOnId = null,
  fetchOnce = false,
  maxCount = null,
}) => {
  try {
    if (isHikerFollowListProvider()) {
      return await getFollowingHiker({ userId, skipOnId, fetchOnce });
    }

    assertApifyConfigured();

    const resolvedUsername = await resolveUsername(username, userId);
    if (!resolvedUsername) {
      throw new Error("User not found. Please check the username and try again.");
    }

    const listMax = maxCount ?? maxLimit;
    let fullList = await fetchFollowingFromApify(resolvedUsername, listMax);

    if (skipOnId) {
      const idx = fullList.findIndex((u) => String(u.id) === String(skipOnId));
      if (idx === -1 && fullList.length >= listMax) {
        fullList = await fetchFollowingFromApify(resolvedUsername, listMax);
      }
    }

    const capped = fullList.slice(0, listMax);
    const { page, nextPageId } = firstPageFromFullList(capped, getListPageSize());

    return {
      following: fetchOnce ? page : capped,
      nextPageId,
      followingFull: capped,
    };
  } catch (error) {
    handleApiError(error, "getting following");
  }
};

export const getNextFollowingData = async ({ userId, nextPageId }) => {
  try {
    if (isHikerFollowListProvider()) {
      const response = await hikerApi.get("/gql/user/following/chunk", {
        params: { user_id: Number(userId), end_cursor: nextPageId },
      });
      const users = response.data?.[0] || [];
      return {
        following: uniqueUsersInOrder(users.map(mapHikerFollowingUser)),
        nextPageId: response.data?.[1],
      };
    }

    const cache = await findCacheByUserId(userId);
    if (!cache?.following?.length) {
      return { following: [], nextPageId: null };
    }

    const { items, nextPageId: next } = sliceListPage(
      cache.following,
      nextPageId,
      getListPageSize()
    );
    return { following: items, nextPageId: next };
  } catch (error) {
    handleApiError(error, "getting following");
    return { following: [], nextPageId: null };
  }
};

const pickStoryPosterUrl = (item) => {
  const candidates = item?.image_versions2?.candidates;
  if (!Array.isArray(candidates) || !candidates.length) return null;
  // Prefer a small-ish candidate for fast thumbnails / video posters.
  const sorted = [...candidates].sort(
    (a, b) => (a.width || 9999) - (b.width || 9999)
  );
  const mid = sorted.find((c) => (c.width || 0) >= 240) || sorted[sorted.length - 1];
  return mid?.url || sorted[0]?.url || null;
};

/**
 * Prefer a mid-quality MP4 so stories start faster than the highest bitrate.
 */
const pickStoryVideoUrl = (versions) => {
  if (!Array.isArray(versions) || !versions.length) return { mediaUrl: null, fallbackUrls: [] };
  const withUrl = versions.filter((v) => v?.url);
  if (!withUrl.length) return { mediaUrl: null, fallbackUrls: [] };

  const scored = [...withUrl].sort((a, b) => {
    const aw = a.width || 0;
    const bw = b.width || 0;
    return aw - bw;
  });

  // Target ~540–720p when available; otherwise closest under 720, else smallest.
  const preferred =
    scored.find((v) => (v.width || 0) >= 540 && (v.width || 0) <= 720) ||
    [...scored].reverse().find((v) => (v.width || 0) <= 720) ||
    scored[0];

  const fallbackUrls = scored
    .map((v) => v.url)
    .filter((url) => url && url !== preferred.url)
    .slice(0, 2);

  return { mediaUrl: preferred.url, fallbackUrls };
};

const mapStoryItem = (item) => {
  let mediaUrl = null;
  let fallbackUrls = [];
  const isVideo =
    item.media_type === 2 ||
    (item.video_versions && item.video_versions.length > 0);

  if (isVideo && item.video_versions?.length > 0) {
    const picked = pickStoryVideoUrl(item.video_versions);
    mediaUrl = picked.mediaUrl;
    fallbackUrls = picked.fallbackUrls;
  } else if (item.image_versions2?.candidates?.length > 0) {
    // Prefer mid-size image over largest for faster load.
    const candidates = [...item.image_versions2.candidates].sort(
      (a, b) => (a.width || 0) - (b.width || 0)
    );
    const preferred =
      candidates.find((c) => (c.width || 0) >= 720) ||
      candidates[candidates.length - 1];
    mediaUrl = preferred?.url || null;
  }

  const posterUrl = pickStoryPosterUrl(item);

  return {
    id: item.pk || item.id,
    mediaUrl,
    posterUrl,
    fallbackUrls,
    mediaType: isVideo ? 'video' : 'image',
    takenAt: item.taken_at,
    expiringAt: item.expiring_at,
    duration: item.video_duration || null,
    viewCount: item.view_count || 0,
    hasAudio: item.has_audio || false,
  };
};

export const getUserStories = async ({ userId }) => {
  try {
    const response = await hikerApi.get("/v2/user/stories", {
      params: { user_id: userId },
    });
    const data = response?.data;
    const items =
      data?.reel?.items ??
      data?.items ??
      (Array.isArray(data?.reel) ? data.reel : null);

    if (!items || !Array.isArray(items) || items.length === 0) {
      return [];
    }

    return items.map(mapStoryItem).filter((s) => s.mediaUrl);
  } catch (error) {
    console.error("Error getting user stories:", error.message);
    return [];
  }
};

export const updateCache = async (username, data) => {
  try {
    const [cachedData, created] = await InstagramCache.findOrCreate({
      where: { username },
      defaults: {
        username,
        userData: data.userData,
        followers: data.followers,
        following: data.following,
        totalFollowers: data.followers.length,
        totalFollowing: data.following.length,
        lastFullUpdate: new Date(),
        lastFollowersUpdate: new Date(),
        lastFollowingUpdate: new Date(),
        isStale: false
      }
    });

    if (!created) {
      await cachedData.update({
        userData: data.userData,
        followers: data.followers,
        following: data.following,
        totalFollowers: data.followers.length,
        totalFollowing: data.following.length,
        lastFullUpdate: new Date(),
        lastFollowersUpdate: new Date(),
        lastFollowingUpdate: new Date(),
        isStale: false
      });
    }

    return cachedData;
  } catch (error) {
    console.error('Error updating cache:', error);
    throw error;
  }
}

export const generateRandomNewUsers = (currentUsers, previousUsers, type) => {
  // If no previous data, generate 1-15 random "new" users from current data
  if (!previousUsers || previousUsers.length === 0) {
    const count = Math.floor(Math.random() * 15) + 1; // 1 to 15
    const shuffled = [...currentUsers].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, Math.min(count, currentUsers.length));
  }

  // If we have previous data, find actual new users
  const newUsers = findNewUsers(currentUsers, previousUsers);

  // If no actual new users, generate 1-5 random "new" users
  if (newUsers.length === 0) {
    const count = Math.floor(Math.random() * 5) + 1; // 1 to 5
    const shuffled = [...currentUsers].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, Math.min(count, currentUsers.length));
  }

  return newUsers;
}

export const findNewUsers = (currentUsers, previousUsers) => {
  const previousIds = new Set((previousUsers || []).map(getUserKey).filter(Boolean));
  return uniqueUsersInOrder(currentUsers || []).filter(user => {
    const key = getUserKey(user);
    return key && !previousIds.has(key);
  });
}

export const analyzeRedFlags = (userData) => {
  const redFlags = [];

  // Проверка на подозрительную активность
  if (userData.follower_count > 0 && userData.following_count > 0) {
    const ratio = userData.following_count / userData.follower_count;

    // Слишком много подписок по сравнению с подписчиками
    if (ratio > 10) {
      redFlags.push({
        type: 'following_ratio',
        severity: 'high',
        message: 'Following significantly more accounts than followers',
        details: `Following ${userData.following_count} accounts with only ${userData.follower_count} followers`
      });
    }

    // Очень мало подписчиков при большом количестве подписок
    if (userData.follower_count < 10 && userData.following_count > 100) {
      redFlags.push({
        type: 'low_followers',
        severity: 'medium',
        message: 'Very few followers despite following many accounts',
        details: `Only ${userData.follower_count} followers while following ${userData.following_count} accounts`
      });
    }

    // Подозрительно много подписчиков при мало постов
    if (userData.follower_count > 1000 && userData.media_count < 10) {
      redFlags.push({
        type: 'high_followers_low_posts',
        severity: 'medium',
        message: 'High follower count with very few posts',
        details: `${userData.follower_count} followers but only ${userData.media_count} posts`
      });
    }

    // Очень высокое соотношение подписчиков к постам
    if (userData.media_count > 0 && (userData.follower_count / userData.media_count) > 1000) {
      redFlags.push({
        type: 'suspicious_engagement_ratio',
        severity: 'high',
        message: 'Suspicious follower to post ratio',
        details: `${userData.follower_count} followers for only ${userData.media_count} posts`
      });
    }
  }

  // Проверка на подозрительную биографию
  if (userData.biography) {
    const bio = userData.biography.toLowerCase();

    // Подозрительные слова в био
    const suspiciousWords = [
      'buy', 'sell', 'follow', 'unfollow', 'dm', 'message', 'link', 'click',
      'promo', 'advertisement', 'sponsored', 'paid', 'earn', 'money',
      'business', 'marketing', 'promotion', 'offer', 'deal', 'discount'
    ];
    const foundWords = suspiciousWords.filter(word => bio.includes(word));

    if (foundWords.length > 2) {
      redFlags.push({
        type: 'suspicious_bio',
        severity: 'medium',
        message: 'Suspicious content in biography',
        details: `Contains suspicious words: ${foundWords.join(', ')}`
      });
    }

    // Проверка на спам-ссылки
    if (bio.includes('http') && (bio.includes('bit.ly') || bio.includes('tinyurl') || bio.includes('goo.gl'))) {
      redFlags.push({
        type: 'suspicious_links',
        severity: 'medium',
        message: 'Suspicious shortened links in biography',
        details: 'Contains shortened URLs which are often used for spam'
      });
    }
  }

  // Проверка на новый аккаунт
  if (userData.is_new_to_instagram) {
    redFlags.push({
      type: 'new_account',
      severity: 'low',
      message: 'Recently created account',
      details: 'Account was created recently'
    });
  }

  // Проверка на приватный аккаунт
  if (userData.is_private) {
    redFlags.push({
      type: 'private_account',
      severity: 'low',
      message: 'Private account',
      details: 'This account is private'
    });
  }

  // Проверка на верифицированный аккаунт (зеленый флаг)
  if (userData.is_verified) {
    redFlags.push({
      type: 'verified_account',
      severity: 'positive',
      message: 'Verified account',
      details: 'This account is verified by Instagram'
    });
  }

  // Проверка на пустую биографию при большом количестве подписчиков
  if ((!userData.biography || userData.biography.trim() === '') && userData.follower_count > 1000) {
    redFlags.push({
      type: 'empty_bio_high_followers',
      severity: 'low',
      message: 'Empty biography despite high follower count',
      details: 'Account has many followers but no biography'
    });
  }

  // Проверка на отсутствие постов при большом количестве подписчиков
  if (userData.media_count === 0 && userData.follower_count > 500) {
    redFlags.push({
      type: 'no_posts_high_followers',
      severity: 'medium',
      message: 'No posts despite high follower count',
      details: `${userData.follower_count} followers but no posts`
    });
  }

  return redFlags;
}

/**
 * Fetch likers sample. Throws on failure.
 * @param {string|number} mediaId
 */
export const getPostLikersOrThrow = async (mediaId) => {
  const response = await hikerApi.get("/v2/media/likers", { params: { id: mediaId } });
  return response.data.users?.map((record) => ({ ...record, postId: mediaId })) || [];
};

/**
 * Fetch likers sample; returns [] on error (legacy callers).
 */
export const getPostLikers = async (mediaId) => {
  try {
    return await getPostLikersOrThrow(mediaId);
  } catch (err) {
    console.error(`Error fetching likers for media ${mediaId}:`, err.message);
    return [];
  }
};

export const getPostComments = async (mediaId) => {
  try {
    const response = await hikerApi.get("/v2/media/comments", { params: { id: mediaId } });
    return response.data.response.comments?.map((record) => ({
      ...record,
      postId: mediaId
    })) || [];
  } catch (err) {
    console.error(`Error fetching comments for media ${mediaId}:`, err.message);
    return [];
  }
};

/**
 * Match comment author against target user ids / username.
 */
export const commentMatchesUser = (comment, targetUserId, targetUsername) => {
  const commentIds = [comment?.user_id, comment?.user?.pk, comment?.user?.id]
    .filter((v) => v != null)
    .map(String);
  if (targetUserId != null && commentIds.includes(String(targetUserId))) {
    return true;
  }
  const uname = String(targetUsername || '').toLowerCase();
  if (!uname) return false;
  const commentUser = comment?.user?.username || comment?.username || '';
  return String(commentUser).toLowerCase() === uname;
};

/**
 * Fetch comments with pagination, optional early-exit when target user found.
 * Includes preview_child_comments in the scanned set (no extra request).
 * @param {string|number} mediaId
 * @param {number} cap
 * @param {{ targetUserId?: string|number, targetUsername?: string, earlyExit?: boolean }} [opts]
 */
export const getPostComentsWithCap = async (mediaId, cap = 60, opts = {}) => {
  const { targetUserId, targetUsername, earlyExit = false } = opts;
  let comments = [];
  let nextPageId = undefined;
  let foundTarget = false;

  const absorb = (list) => {
    for (const record of list || []) {
      const mapped = { ...record, postId: mediaId };
      comments.push(mapped);
      if (
        earlyExit &&
        targetUserId != null &&
        commentMatchesUser(mapped, targetUserId, targetUsername)
      ) {
        foundTarget = true;
      }
      const children = record.preview_child_comments || record.child_comments || [];
      for (const child of children) {
        const childMapped = { ...child, postId: mediaId };
        comments.push(childMapped);
        if (
          earlyExit &&
          targetUserId != null &&
          commentMatchesUser(childMapped, targetUserId, targetUsername)
        ) {
          foundTarget = true;
        }
      }
    }
  };

  while (comments.length < cap) {
    const res = await hikerApi.get("/v2/media/comments", {
      params: {
        id: mediaId,
        page_id: nextPageId,
      },
    });

    const data = res?.data?.response || { comments: [] };
    const pageComments = data.comments || [];

    if (pageComments.length === 0) break;

    absorb(pageComments);
    if (earlyExit && foundTarget) break;

    nextPageId = res?.data?.next_page_id;
    if (!nextPageId) break;
  }

  return comments.slice(0, cap);
};

/**
 * Soft wrapper for capped comments (empty on error).
 */
export const getPostComentsWithCapSafe = async (mediaId, cap = 60, opts = {}) => {
  try {
    return await getPostComentsWithCap(mediaId, cap, opts);
  } catch (err) {
    console.error(`Error fetching capped comments for media ${mediaId}:`, err.message);
    return [];
  }
};

export const fetchUserMedias = async (userId, limit = 24) => {
  let medias = [];
  let nextPageId = undefined;

  try {
    while (medias.length < limit) {
      const res = await hikerApi.get("/v2/user/medias", {
        params: {
          user_id: userId,
          page_id: nextPageId,
          safe_int: true,
        },
      });

      const data = res?.data?.response || { items: [] };

      medias = medias.concat(data.items || []);

      if (!res?.data?.next_page_id || data.items.length === 0) {
        break;
      }

      nextPageId = res?.data?.next_page_id;
    }

    return { medias: medias.slice(0, limit), nextPageId }
  } catch (err) {
    console.error("Error fetching medias:", err);
    return [];
  }
};

export const fetchMoreUserMedias = async (userId, nextPageId) => {
  try {
      const res = await hikerApi.get("/v2/user/medias", {
        params: {
          user_id: userId,
          page_id: nextPageId,
          safe_int: true,
        },
      });
    return { medias: res?.data?.response?.items || [], nextPageId: res?.data?.next_page_id }
  } catch (err) {
    console.error("Error fetching medias:", err);
    return [];
  }
};


const handleApiError = (error, context = 'API request') => {
  console.error(`Error in ${context}:`, error.message);

  if (error.message && !error.response) {
    if (
      error.message.includes('rate limit exceeded') ||
      error.message.includes('temporarily unavailable') ||
      error.message.includes('User not found') ||
      error.message.includes('Access denied')
    ) {
      throw error;
    }
  }

  // Обработка ошибки 429 (Too Many Requests)
  if (error.response && error.response.status === 429) {
    throw new Error('API rate limit exceeded. Please try again in a few minutes or upgrade your plan for higher limits.');
  }

  // Обработка ошибки 402 (Quota Exceeded)
  if (error.response && error.response.status === 402) {
    throw new Error('Instagram API is temporarily unavailable. Please try again later.');
  }

  // Обработка ошибки 404 (Not Found)
  if (error.response && error.response.status === 404) {
    throw new Error('User not found. Please check the username and try again.');
  }

  // Обработка ошибок сервера
  if (error.response && error.response.status >= 500) {
    throw new Error('Instagram API is temporarily unavailable. Please try again later.');
  }

  // Обработка ошибки 403 (Forbidden)
  if (error.response && error.response.status === 403) {
    throw new Error('Access denied. The account might be private or restricted.');
  }

  throw error;
}
