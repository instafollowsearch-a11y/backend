import axios from "axios";
import InstagramCache from "../../models/InstagramCache.js";

const hikerApi = axios.create({
  baseURL: "https://api.hikerapi.com",
  headers: {
    Accept: "application/json",
    "x-access-key": process.env.HIKER_API_KEY,
  },
});

const maxLimit = 500;


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

export const getFollowers = async ({ userId, skipOnId = null, fetchOnce = false }) => {
  try {
    let results = [];
    let nextPageId = undefined;

    while (results.length < maxLimit) {
      const response = await hikerApi.get("/v2/user/followers", {
        params: {
          user_id: userId,
          page_id: nextPageId,
        },
      });
      console.log("Users in each followers response", response.data.response.users.length);
      const users = response.data.response?.users || [];
      const mappedUsers = users.map((user) => ({
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
      }));

      results.push(...mappedUsers);

      // check if more pages exist
      nextPageId = response.data?.next_page_id;
      if (!nextPageId || users.length === 0 || users.some(user => String(user.pk) === String(skipOnId)) || fetchOnce) {
        break;
      }
    }

    return { followers: results.slice(0, maxLimit), nextPageId }
  } catch (error) {
    handleApiError(error, "getting followers");
    return [];
  }
};
export const getNextFollowersData = async ({ userId, nextPageId }) => {
  try {
    const response = await hikerApi.get("/v2/user/followers", {
      params: {
        user_id: Number(userId),
        page_id: nextPageId,
      },
    });
    console.log("Users in each followers response", response.data.response.users.length);
    const users = response.data.response?.users || [];
    const mappedUsers = users.map((user) => ({
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
    }));

    return { followers: mappedUsers, nextPageId: response?.data?.next_page_id }
  } catch (error) {
    handleApiError(error, "getting followers");
    return [];
  }
};

export const getFollowing = async ({ userId, skipOnId = null, fetchOnce = false }) => {
  try {
    let results = [];
    let nextPageId = undefined;

    while (results.length < maxLimit) {
      const response = await hikerApi.get("/gql/user/following/chunk", {
        params: {
          user_id: userId,
          end_cursor: nextPageId,
        },
      });

      const users = response.data?.[0] || [];
      console.log("Users in each following response", response.data?.[0]?.length);

      const mappedUsers = users.map((user) => ({
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
      }));

      results.push(...mappedUsers);

      nextPageId = response.data?.[1];

      if (!nextPageId || users.length === 0 || users.some(user => String(user.id) === String(skipOnId)) || fetchOnce) {
        break;
      }
    }

    return { following: results.slice(0, maxLimit), nextPageId };
  } catch (error) {
    handleApiError(error, "getting following");
    return [];
  }
};


export const getNextFollowingData = async ({ userId, nextPageId }) => {
  try {
    const response = await hikerApi.get("/gql/user/following/chunk", {
      params: {
        user_id: Number(userId),
        end_cursor: nextPageId,
      },
    });
    console.log("Users in each following response", response.data?.[0]?.length);
    const users = response.data?.[0] || [];
    const mappedUsers = users.map((user) => ({
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
    }));

    return { following: mappedUsers, nextPageId: response.data?.[1] }
  } catch (error) {
    handleApiError(error, "getting following");
    return [];
  }
};

export const getUserStories = async ({ userId }) => {
  try {
    const response = await hikerApi.get("/v2/user/stories", { params: { user_id: userId } });
    return response?.data?.reel?.items?.map(item => {
      let mediaUrl = null;

      // Определяем URL медиа (фото или видео)
      if (item.video_versions && item.video_versions.length > 0) {
        // Видео
        mediaUrl = item.video_versions[0].url;
      } else if (item.image_versions2 && item.image_versions2.candidates && item.image_versions2.candidates.length > 0) {
        // Фото
        mediaUrl = item.image_versions2.candidates[0].url;
      }

      return {
        id: item.pk,
        mediaUrl,
        mediaType: item.video_versions ? 'video' : 'image',
        takenAt: item.taken_at,
        expiringAt: item.expiring_at,
        duration: item.video_duration || null,
        viewCount: item.view_count || 0,
        hasAudio: item.has_audio || false
      };
    });
  } catch (error) {
    handleApiError(error, 'getting following');
  }
}

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
  const previousIds = new Set(previousUsers.map(user => String(user.id)));
  return currentUsers.filter(user => !previousIds.has(String(user.id)));
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

export const getPostLikers = async (mediaId) => {
  try {
    const response = await hikerApi.get("/v2/media/likers", { params: { id: mediaId } });
    console.log(response.data.users.length)
    return response.data.users?.map((record) => ({ ...record, postId: mediaId })) || [];
  } catch (err) {
    console.error(`Error fetching likers for media ${mediaId}:`, err.message);
    return [];
  }
};

export const getPostComments = async (mediaId) => {
  try {
    const response = await hikerApi.get("/v2/media/comments", { params: { id: mediaId } });
    console.log(response.data.response.comments.length)
    return response.data.response.comments?.map((record) => ({
      ...record,
      postId: mediaId
    })) || [];
  } catch (err) {
    console.error(`Error fetching comments for media ${mediaId}:`, err.message);
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
console.log(userId, nextPageId)
  try {
      const res = await hikerApi.get("/v2/user/medias", {
        params: {
          user_id: userId,
          page_id: nextPageId,
          safe_int: true,
        },
      });
console.log(res?.data?.response)
    return { medias: res?.data?.response?.items || [], nextPageId: res?.data?.next_page_id }
  } catch (err) {
    console.error("Error fetching medias:", err);
    return [];
  }
};


const handleApiError = (error, context = 'API request') => {
  console.error(`Error in ${context}:`, error.message);

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