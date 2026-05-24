import axios from "axios";

const APIFY_BASE = "https://api.apify.com/v2";
const ACTOR_FOLLOWERS = "datadoping~instagram-followers-scraper";
const ACTOR_FOLLOWING = "datadoping~instagram-following-scraper";

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
      item.profile_pic_url ?? item.profilePicUrl ?? item.profile_picture ?? "",
    isVerified: Boolean(item.is_verified ?? item.isVerified),
    isPrivate: Boolean(item.is_private ?? item.isPrivate),
    followerCount: item.follower_count ?? item.followerCount,
    followingCount: item.following_count ?? item.followingCount,
    mediaCount: item.media_count ?? item.mediaCount,
    biography: item.biography ?? "",
    externalUrl: item.external_url ?? item.externalUrl ?? "",
    full_name: item.full_name ?? item.fullName,
    profile_pic_url: item.profile_pic_url ?? item.profilePicUrl,
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

export const fetchFollowersFromApify = async (username, maxCount) => {
  const input = {
    usernames: [username],
    max_count: Math.min(Math.max(1, maxCount), 500),
  };
  const raw = await runActorSync(ACTOR_FOLLOWERS, input);
  const mapped = raw.map(mapApifyUser).filter(Boolean);
  return uniqueUsersInOrder(mapped);
};

export const fetchFollowingFromApify = async (username, maxCount) => {
  const input = {
    usernames: [username],
    max_count: Math.min(Math.max(1, maxCount), 500),
  };
  const raw = await runActorSync(ACTOR_FOLLOWING, input);
  const mapped = raw.map(mapApifyUser).filter(Boolean);
  return uniqueUsersInOrder(mapped);
};

export const useApifyForFollowLists = () => {
  const provider = (process.env.FOLLOWERS_FOLLOWING_PROVIDER || "apify").toLowerCase();
  if (provider === "hiker") return false;
  return Boolean(process.env.APIFY_TOKEN);
};

/** Public homepage search: smaller Apify scrape (faster). Premium keeps full cap. */
export const getApifyListMaxCount = (forPremium = false) => {
  const cap = 500;
  const raw = forPremium
    ? process.env.APIFY_MAX_COUNT || "500"
    : process.env.APIFY_PUBLIC_MAX_COUNT || "50";
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return forPremium ? cap : 50;
  return Math.min(n, cap);
};
