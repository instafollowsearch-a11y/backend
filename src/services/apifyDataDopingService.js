import axios from "axios";

const APIFY_BASE = "https://api.apify.com/v2";
/** Only actor used for followers/following lists (thenetaji/instagram-followers-followings-scraper). */
const THENETAJI_FOLLOW_LISTS_ACTOR =
  "thenetaji~instagram-followers-followings-scraper";

const DEFAULT_TIMEOUT_MS = 120000;

const mapApifyUser = (item) => {
  if (!item || typeof item !== "object") return null;
  const username = item.username;
  if (!username) return null;

  const id =
    item.id ??
    item.userId ??
    item.pk ??
    item.pk_id ??
    username;

  return {
    id: String(id),
    username,
    fullName: item.full_name ?? item.fullName ?? item.fullname ?? "",
    profilePicUrl:
      item.profile_pic_url ??
      item.profile_pic_url_hd ??
      item.profilePicUrl ??
      item.profile_picture ??
      "",
    isVerified: Boolean(item.is_verified ?? item.isVerified),
    isPrivate: Boolean(item.is_private ?? item.isPrivate),
    followerCount:
      item.edge_followed_by?.count ??
      item.follower_count ??
      item.followerCount,
    followingCount:
      item.edge_follow?.count ??
      item.following_count ??
      item.followingCount,
    mediaCount: item.media_count ?? item.mediaCount,
    biography: item.biography ?? "",
    externalUrl: item.external_url ?? item.externalUrl ?? "",
    full_name: item.full_name ?? item.fullName,
    profile_pic_url:
      item.profile_pic_url ??
      item.profile_pic_url_hd ??
      item.profilePicUrl,
    is_verified: item.is_verified ?? item.isVerified,
    is_private: item.is_private ?? item.isPrivate,
  };
};

const uniqueUsersInOrder = (users = []) => {
  const seen = new Set();
  const out = [];
  for (const user of users) {
    if (!user) continue;
    const key = user.id ?? user.username;
    if (!key) {
      out.push(user);
      continue;
    }
    const k = String(key);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(user);
    }
  }
  return out;
};

const runActorSync = async (actorId, input) => {
  const token = process.env.APIFY_TOKEN;
  if (!token) {
    throw new Error(
      "Instagram API is temporarily unavailable. Please try again later."
    );
  }

  const url = `${APIFY_BASE}/acts/${actorId}/run-sync-get-dataset-items`;
  try {
    const response = await axios.post(url, input, {
      params: { token },
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      timeout: DEFAULT_TIMEOUT_MS,
      validateStatus: (s) => s < 500,
    });

    if (response.status >= 400) {
      const msg =
        response.data?.error?.message ??
        response.data?.message ??
        `Apify request failed (${response.status})`;
      throw new Error(msg);
    }

    const data = response.data;
    if (!Array.isArray(data)) {
      return [];
    }
    return data;
  } catch (error) {
    if (error.code === "ECONNABORTED") {
      throw new Error(
        "Instagram API is temporarily unavailable. Please try again later."
      );
    }
    if (error.response?.status === 401 || error.response?.status === 403) {
      throw new Error(
        "Instagram API is temporarily unavailable. Please try again later."
      );
    }
    if (error.response?.status === 429) {
      throw new Error(
        "API rate limit exceeded. Please try again in a few minutes or upgrade your plan for higher limits."
      );
    }
    throw error;
  }
};

const fetchFollowListFromApify = async (username, listType, maxCount) => {
  const maxItem = Math.min(Math.max(1, maxCount), 500);
  const input = {
    username: [username],
    type: listType,
    maxItem,
    profileEnriched: process.env.APIFY_PROFILE_ENRICHED === "true",
  };
  const raw = await runActorSync(THENETAJI_FOLLOW_LISTS_ACTOR, input);
  const mapped = raw.map(mapApifyUser).filter(Boolean);
  return uniqueUsersInOrder(mapped);
};

const APIFY_RETRY_DELAY_MS = 1500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const isHikerFollowListProvider = () =>
  (process.env.FOLLOWERS_FOLLOWING_PROVIDER || "apify").toLowerCase() === "hiker";

/** Follower/following lists use Apify unless explicitly overridden to hiker. */
export const useApifyForFollowLists = () => !isHikerFollowListProvider();

export const assertApifyConfigured = () => {
  if (isHikerFollowListProvider()) return;
  if (!process.env.APIFY_TOKEN) {
    throw new Error(
      "Instagram follower lists are temporarily unavailable. Please try again later."
    );
  }
};

const fetchFollowListWithRetry = async (username, listType, maxCount) => {
  const attempts = Math.max(1, parseInt(process.env.APIFY_LIST_RETRY_ATTEMPTS || "2", 10));
  let last = [];
  for (let attempt = 0; attempt < attempts; attempt++) {
    last = await fetchFollowListFromApify(username, listType, maxCount);
    if (last.length > 0) return last;
    if (attempt < attempts - 1) await sleep(APIFY_RETRY_DELAY_MS);
  }
  return last;
};

export const fetchFollowersFromApify = async (username, maxCount) =>
  fetchFollowListWithRetry(username, "followers", maxCount);

export const fetchFollowingFromApify = async (username, maxCount) =>
  fetchFollowListWithRetry(username, "followings", maxCount);

/** Public search: small scrape. Premium: max items stored in cache (load more in pages of FOLLOW_LIST_PAGE_SIZE). */
export const getApifyListMaxCount = (forPremium = false) => {
  const cap = forPremium ? 500 : 50;
  const raw = forPremium
    ? process.env.APIFY_MAX_COUNT || "50"
    : process.env.APIFY_PUBLIC_MAX_COUNT || "2";
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return forPremium ? 50 : 2;
  return Math.min(n, cap);
};
