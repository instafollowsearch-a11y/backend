/** Page size for followers/following UI "load more" (matches Apify default batch). */
export const LIST_PAGE_SIZE = 50;

export const OFFSET_PREFIX = "offset:";

export const buildOffsetToken = (offset) => {
  const n = Number(offset);
  if (!Number.isFinite(n) || n < 0) return null;
  return `${OFFSET_PREFIX}${n}`;
};

export const parseOffsetToken = (token) => {
  if (token == null || token === "") return 0;
  const s = String(token);
  if (s.startsWith(OFFSET_PREFIX)) {
    const n = parseInt(s.slice(OFFSET_PREFIX.length), 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }
  // Legacy Hiker cursor: treat as start of list (re-fetch from cache at 0 not possible)
  return 0;
};

/**
 * Slice a cached list for pagination.
 * @returns {{ items: array, nextPageId: string|null }}
 */
export const sliceListPage = (list, offsetToken, pageSize = LIST_PAGE_SIZE) => {
  const listArr = Array.isArray(list) ? list : [];
  const offset = parseOffsetToken(offsetToken);
  const end = offset + pageSize;
  const items = listArr.slice(offset, end);
  const nextOffset = end;
  const nextPageId =
    nextOffset < listArr.length ? buildOffsetToken(nextOffset) : null;
  return { items, nextPageId };
};

/**
 * First page + token for remaining items in a full list.
 */
export const firstPageFromFullList = (fullList, pageSize = LIST_PAGE_SIZE) => {
  const list = Array.isArray(fullList) ? fullList : [];
  const nextPageId =
    list.length > pageSize ? buildOffsetToken(pageSize) : null;
  return { page: list.slice(0, pageSize), nextPageId, fullList: list };
};
