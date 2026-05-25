/** Items returned per "Load more" click (UI page size). */
export const getListPageSize = () => {
  const n = parseInt(process.env.FOLLOW_LIST_PAGE_SIZE || "10", 10);
  if (!Number.isFinite(n) || n < 1) return 10;
  return Math.min(n, 50);
};

/** @deprecated Use getListPageSize() — kept for tests importing LIST_PAGE_SIZE */
export const LIST_PAGE_SIZE = 10;

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
  return 0;
};

/**
 * Slice a cached list for pagination.
 * @returns {{ items: array, nextPageId: string|null }}
 */
export const sliceListPage = (list, offsetToken, pageSize) => {
  const size = pageSize ?? getListPageSize();
  const listArr = Array.isArray(list) ? list : [];
  const offset = parseOffsetToken(offsetToken);
  const end = offset + size;
  const items = listArr.slice(offset, end);
  const nextOffset = end;
  const nextPageId =
    nextOffset < listArr.length ? buildOffsetToken(nextOffset) : null;
  return { items, nextPageId };
};

/**
 * First page + token for remaining items in a full list.
 */
export const firstPageFromFullList = (fullList, pageSize) => {
  const size = pageSize ?? getListPageSize();
  const list = Array.isArray(fullList) ? fullList : [];
  const nextPageId =
    list.length > size ? buildOffsetToken(size) : null;
  return { page: list.slice(0, size), nextPageId, fullList: list };
};
