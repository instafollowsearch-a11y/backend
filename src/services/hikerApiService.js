import InstagramCache from "../models/InstagramCache.js";
import { getUserInfo, getFollowers, getFollowing, getUserStories, updateCache, findNewUsers, getPostLikers, getPostComments, getNextFollowersData, getNextFollowingData, fetchUserMedias, fetchMoreUserMedias } from "./utils/hikerHelperFunctions.js";

export const getRecentActivity = async (username, userSubscription = 'free') => {
  const startTime = Date.now();
  try {
    const userInfo = await getUserInfo(username);

    // Get cached data for comparison
    let cachedData = await InstagramCache.findOne({ where: { username } });
    let previousFollowers = [];
    let previousFollowing = [];

    if (cachedData) {
      previousFollowers = cachedData.followers || [];
      previousFollowing = cachedData.following || [];
    }

    // Get fresh data and stories
    const userId = userInfo.id || userInfo.pk;
    const [followersData, followingData, userPosts] = await Promise.all([
      getFollowers({ userId, fetchOnce: true }),
      getFollowing({ userId, fetchOnce: true }),
      fetchUserMedias(userId, 12)
    ]);
    const followers = followersData?.followers;
    const following = followingData?.following

    // Update cache
    cachedData = await updateCache(username, {
      userData: userInfo,
      followers,
      following
    });

    // Find new followers/following using random generation logic
    const newFollowers = findNewUsers(followers, previousFollowers);
    const newFollowing = findNewUsers(following, previousFollowing);

    const userPostsData = await Promise.all(
      userPosts?.medias?.map(async (post) => {
        const likers = await getPostLikers(post.id); // returns array of user objects
        return { post, likers };
      })
    );

    // Map of userId → { user, count }
    const likerMap = {};

    for (const { likers } of userPostsData) {
      for (const liker of likers) {
        const userId = liker.id; // adjust key if needed
        if (!likerMap[userId]) {
          likerMap[userId] = { user: { ...liker }, count: 0 };
        }
        likerMap[userId].count += 1;
      }
    }

    // Build array with full user + count
    const frequentLikers = Object.values(likerMap)
      .filter((entry) => entry.count > 1)
      .map((entry) => ({ ...entry.user, count: entry.count }));

    const followerIds = new Set(followers.map(f => f.id));
    const followingIds = new Set(following.map(f => f.id));

    // Keep only frequent likers who are also in followers or following
    const redFlags = frequentLikers.filter((liker) =>
      followerIds.has(liker.id) || followingIds.has(liker.id)
    );

    return {
      userInfo,
      newFollowers,
      newFollowing,
      stories: null,
      redFlags,

      followers,
      following,
      totalNewFollowers: newFollowers.length,
      totalNewFollowing: newFollowing.length,
      lastUpdated: new Date(),
      totalFollowers: followers.length,
      totalFollowing: following.length,
      processingTime: Date.now() - startTime
    };
  } catch (error) {
    console.error('Error getting recent activity:', error.message);
    throw error;
  }
}

export const getAdvancedActivity = async (username, userSubscription = 'free') => {
  const startTime = Date.now();
  try {
    // Get user info first
    const userInfo = await getUserInfo(username);

    // Get cached data for comparison
    let cachedData = await InstagramCache.findOne({ where: { username } });
    let previousFollowers = [];
    let previousFollowing = [];

    if (cachedData) {
      previousFollowers = cachedData.followers || [];
      previousFollowing = cachedData.following || [];
    }

    // Get fresh data and stories
    const userId = userInfo.id || userInfo.pk;
    const [followersData, followingData, stories, userPosts] = await Promise.all([
      getFollowers({ userId, fetchOnce: true }),
      getFollowing({ userId, fetchOnce: true }),
      getUserStories({ userId }),
      fetchUserMedias(userId, 12)
    ]);
    const followers = followersData?.followers;
    const following = followingData?.following

    // Update cache
    cachedData = await updateCache(username, {
      userData: userInfo,
      followers,
      following
    });

    const userPostsData = await Promise.all(
      userPosts?.medias?.map(async (post) => {
        const likers = await getPostLikers(post.id); // returns array of user objects
        return { post, likers };
      })
    );

    // Map of userId → { user, count }
    const likerMap = {};

    for (const { likers } of userPostsData) {
      for (const liker of likers) {
        const userId = liker.id; // adjust key if needed
        if (!likerMap[userId]) {
          likerMap[userId] = { user: { ...liker }, count: 0 };
        }
        likerMap[userId].count += 1;
      }
    }

    // Build array with full user + count
    const frequentLikers = Object.values(likerMap)
      .filter((entry) => entry.count > 1)
      .map((entry) => ({ ...entry.user, count: entry.count }));

    const followerIds = new Set(followers.map(f => f.id));
    const followingIds = new Set(following.map(f => f.id));

    // Keep only frequent likers who are also in followers or following
    const redFlags = frequentLikers.filter((liker) =>
      followerIds.has(liker.id) || followingIds.has(liker.id)
    );


    // Find REAL new followers/following (no random generation)
    const newFollowers = findNewUsers(followers, previousFollowers);
    const newFollowing = findNewUsers(following, previousFollowing);

    // Add red flags and stories only for premium users

    const premiumStories = stories;

    return {
      userInfo,
      newFollowers,
      newFollowing,
      stories: premiumStories,
      redFlags,
      totalNewFollowers: newFollowers.length,
      totalNewFollowing: newFollowing.length,
      lastUpdated: new Date(),
      totalFollowers: followers.length,
      totalFollowing: following.length,
      processingTime: Date.now() - startTime,
      followersNextPageId: followersData?.nextPageId,
      followingNextPageId: followingData?.nextPageId,
      followers,
      following
    };
  } catch (error) {
    console.error('Error getting advanced activity:', error.message);
    throw error;
  }
}

export const getSharedActivity = async (username1, username2) => {
  const startTime = Date.now();
  try {
    // Get user info first
    const [firstUser, secondUser] = await Promise.all([
      getUserInfo(username1),
      getUserInfo(username2),
    ]);

    const firstUserId = firstUser.id || firstUser.pk;
    const secondUserId = secondUser.id || secondUser.pk;

    // Get following info
    const [firstUserFollowingData, secondUserFollowingData] = await Promise.all([
      getFollowing({ userId: firstUserId, skipOnId: secondUserId }),
      getFollowing({ userId: secondUserId, skipOnId: firstUserId }),
    ]);
    const firstUserFollowing = firstUserFollowingData?.following;
    const secondUserFollowing = secondUserFollowingData?.following;

    const isFirstFollowingSecond = firstUserFollowing.some(
      (user) =>
        String(user.id) === String(secondUserId) ||
        user.username === secondUser.username
    );

    const isSecondFollowingFirst = secondUserFollowing.some(
      (user) =>
        String(user.id) === String(firstUserId) ||
        user.username === firstUser.username
    );

    // Fetch recent posts for both users
    const [firstUserPosts, secondUserPosts] = await Promise.all([
      fetchUserMedias(firstUserId),
      fetchUserMedias(secondUserId),
    ]);

    // Fetch likers + comments for both users' posts in one Promise.all
    const [firstUserPostData, secondUserPostData] = await Promise.all([
      Promise.all(
        firstUserPosts?.medias?.map(async (post) => {
          const [likers, comments] = await Promise.all([
            getPostLikers(post.id),
            getPostComments(post.id),
          ]);
          return { post, likers, comments };
        })
      ),
      Promise.all(
        secondUserPosts?.medias?.map(async (post) => {
          const [likers, comments] = await Promise.all([
            getPostLikers(post.id),
            getPostComments(post.id),
          ]);
          return { post, likers, comments };
        })
      ),
    ]);

    // Analyze interactions
    const firstUserPostsLikedBySecond = [];
    const secondUserPostsLikedByFirst = [];
    const firstUserPostsCommentedBySecond = [];
    const secondUserPostsCommentedByFirst = [];

    for (const { post, likers, comments } of firstUserPostData) {
      if (
        likers.some(
          (u) =>
            String(u.id) === String(secondUserId) ||
            u.username === secondUser.username
        )
      ) {
        firstUserPostsLikedBySecond.push({
          postId: post.id,
          code: post.code,
          caption: post.caption?.text || "",
          imageUrl: post.image_versions2?.candidates?.[0]?.url || null,
        });
      }

      if (
        comments.some(
          (c) =>
            String(c.user_id) === String(secondUserId) ||
            c.user?.username === secondUser.username
        )
      ) {
        firstUserPostsCommentedBySecond.push({
          postId: post.id,
          code: post.code,
          caption: post.caption?.text || "",
          imageUrl: post.image_versions2?.candidates?.[0]?.url || null,
        });
      }
    }

    for (const { post, likers, comments } of secondUserPostData) {
      if (
        likers.some(
          (u) =>
            String(u.id) === String(firstUserId) ||
            u.username === firstUser.username
        )
      ) {
        secondUserPostsLikedByFirst.push({
          postId: post.id,
          code: post.code,
          caption: post.caption?.text || "",
          imageUrl: post.image_versions2?.candidates?.[0]?.url || null,
        });
      }

      if (
        comments.some(
          (c) =>
            String(c.user_id) === String(firstUserId) ||
            c.user?.username === firstUser.username
        )
      ) {
        secondUserPostsCommentedByFirst.push({
          postId: post.id,
          code: post.code,
          caption: post.caption?.text || "",
          imageUrl: post.image_versions2?.candidates?.[0]?.url || null,
        });
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
      firstUserPostLength: firstUserPostData.length,
      secondUserPostLength: secondUserPostData.length,
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
    const totalPosts = userPosts.length;
    let admirers = Object.values(likerCounts).map((liker) => ({
      id: liker.id,
      username: liker.username,
      profilePicUrl: liker.profilePicUrl,
      likePercentage: Math.round((liker.count / totalPosts) * 100),
    }));

    // Step 6: Sort & rank
    admirers = admirers
      .sort((a, b) => b.likePercentage - a.likePercentage || a.username.localeCompare(b.username))
      .map((item, idx) => ({ ...item, rank: idx + 1 }));

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

export const getInstagramProfileDetails = async (username) => {

  try {
    const userinfo = await getUserInfo(username);
    const userId = userinfo.id || userinfo.pk;
    const [userPosts, userStories, userFollowers, userFollowing] = await Promise.all([
      fetchUserMedias(userId, 24),
      getUserStories({ userId }),
      getFollowers({ userId, fetchOnce: true }),
      getFollowing({ userId, fetchOnce: true })
    ]);

    return {
      success: true,
      userinfo,
      userPosts,
      userStories,
      userFollowers,
      userFollowing,
    };
  } catch (error) {
    console.error("Error getting profile details:", error.message);
    throw error;
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