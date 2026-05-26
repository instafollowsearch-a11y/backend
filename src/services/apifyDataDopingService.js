import axios from "axios";

const APIFY_BASE = "https://api.apify.com/v2";
/** Only actor used for followers/following lists (thenetaji/instagram-followers-followings-scraper). */
const THENETAJI_FOLLOW_LISTS_ACTOR =
  "thenetaji~instagram-followers-followings-scraper";

const DEFAULT_TIMEOUT_MS = 120000;

const apifyErrorPayload = (data) => {
  if (!data || typeof data !== "object") return { type: null, message: null };
  const err = data.error && typeof data.error === "object" ? data.error : data;
  return {
    type: err.type ?? null,
    message: err.message ?? data.message ?? null,
  };
};

const errorTypeHint = (type) => {
  const t = String(type || "").toLowerCase();
  if (
    t.includes("credit") ||
    t.includes("usage-limit") ||
    t.includes("payment") ||
    t.includes("402") ||
    t.includes("billing") ||
    t.includes("invoice")
  ) {
    return "credits or billing issue";
  }
  if (t.includes("invalid-token") || t.includes("token")) {
    return "invalid APIFY_TOKEN";
  }
  if (t.includes("actor-not-found")) return "actor not found";
  if (t.includes("actor-run-failed")) return "actor run failed";
  if (t.includes("rate-limit")) return "rate limited";
  if (t.includes("insufficient-permissions")) return "token lacks permission";
  if (t.includes("apify-plan-required")) return "paid Apify plan required";
  return null;
};

const describeApifyHttpError = (status, data) => {
  const { type, message } = apifyErrorPayload(data);
  const parts = [];

  if (status === 402) {
    parts.push(
      "Apify payment required — account may be out of credits or over the monthly usage limit."
    );
  } else if (status === 401) {
    parts.push("Apify authentication failed — APIFY_TOKEN is invalid or expired.");
  } else if (status === 403) {
    parts.push(
      "Apify access denied — token may lack permission or actor access is blocked."
    );
  } else if (status === 429) {
    parts.push("Apify rate limit exceeded — wait and retry.");
  } else if (status === 404) {
    parts.push(`Apify actor not found (${THENETAJI_FOLLOW_LISTS_ACTOR}).`);
  } else if (status >= 400) {
    parts.push(`Apify HTTP ${status}.`);
  }

  if (type) {
    const hint = errorTypeHint(type);
    parts.push(
      hint ? `Apify type: ${type} (${hint}).` : `Apify type: ${type}.`
    );
  }
  if (message) parts.push(`Apify says: ${message}`);

  return parts.join(" ");
};

const fetchApifyAccountUsageHint = async (token) => {
  if (!token) return null;
  try {
    const res = await axios.get(`${APIFY_BASE}/users/me/limits`, {
      params: { token },
      timeout: 15000,
      validateStatus: (s) => s < 500,
    });
    if (res.status >= 400) {
      return describeApifyHttpError(res.status, res.data) || null;
    }
    const limits = res.data?.data?.limits;
    const current = res.data?.data?.current;
    if (!limits || !current) return null;

    const used = current.monthlyUsageUsd;
    const max = limits.maxMonthlyUsageUsd;
    if (typeof used !== "number" || typeof max !== "number") return null;

    const atLimit = used >= max;
    return `Apify billing: $${used.toFixed(2)} of $${max.toFixed(2)} monthly limit used${atLimit ? " — limit reached, add credits in Apify console" : ""}.`;
  } catch {
    return null;
  }
};

const buildEmptyScrapeError = async ({
  username,
  listType,
  attempts,
  maxItem,
  lastApifyError,
}) => {
  const usageHint = await fetchApifyAccountUsageHint(process.env.APIFY_TOKEN);
  const parts = [
    `Apify ${listType} scrape returned 0 users for @${username} after ${attempts} attempt(s) (maxItem=${maxItem}, actor=${THENETAJI_FOLLOW_LISTS_ACTOR}).`,
  ];
  if (lastApifyError) parts.push(lastApifyError);
  if (usageHint) parts.push(usageHint);
  parts.push(
    "Likely causes: private/restricted Instagram account, scraper blocked, actor failure, or no Apify credits. Open console.apify.com → Runs for this actor to see the exact run log."
  );
  return parts.join(" ");
};

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
      "Apify is not configured — APIFY_TOKEN is missing on the server."
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
      const detail = describeApifyHttpError(response.status, response.data);
      throw new Error(detail || `Apify request failed (HTTP ${response.status}).`);
    }

    const data = response.data;
    if (!Array.isArray(data)) {
      return [];
    }
    return data;
  } catch (error) {
    if (error.message?.startsWith("Apify ")) throw error;

    if (error.code === "ECONNABORTED") {
      throw new Error(
        "Apify request timed out after 120s — try again or lower maxItem."
      );
    }

    const status = error.response?.status;
    const body = error.response?.data;
    if (status) {
      const detail = describeApifyHttpError(status, body);
      throw new Error(detail || `Apify request failed (HTTP ${status}).`);
    }

    throw new Error(
      `Apify request failed: ${error.message || "unknown network error"}.`
    );
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
      "Apify is not configured — APIFY_TOKEN is missing on the server."
    );
  }
};

const fetchFollowListWithRetry = async (username, listType, maxCount) => {
  const attempts = Math.max(
    1,
    parseInt(process.env.APIFY_LIST_RETRY_ATTEMPTS || "2", 10)
  );
  const maxItem = Math.min(Math.max(1, maxCount), 500);
  let last = [];
  let lastApifyError = null;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      last = await fetchFollowListFromApify(username, listType, maxCount);
      if (last.length > 0) return last;
    } catch (err) {
      lastApifyError = err.message || String(err);
      if (attempt >= attempts - 1) throw err;
    }
    if (attempt < attempts - 1) await sleep(APIFY_RETRY_DELAY_MS);
  }

  throw new Error(
    await buildEmptyScrapeError({
      username,
      listType,
      attempts,
      maxItem,
      lastApifyError,
    })
  );
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
