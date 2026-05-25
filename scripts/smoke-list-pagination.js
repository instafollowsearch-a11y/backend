/**
 * Offline smoke checks for cache-backed followers/following pagination.
 * Run: node scripts/smoke-list-pagination.js
 */
import {
  getListPageSize,
  buildOffsetToken,
  parseOffsetToken,
  sliceListPage,
  firstPageFromFullList,
} from "../src/services/utils/listPagination.js";

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const pageSize = getListPageSize();
const list = Array.from({ length: 50 }, (_, i) => ({ id: String(i), username: `u${i}` }));

const { page, nextPageId } = firstPageFromFullList(list, pageSize);
assert(page.length === pageSize, `first page size ${pageSize}`);
assert(nextPageId === buildOffsetToken(pageSize), "first next token");

let token = nextPageId;
let total = page.length;
while (token) {
  const { items, nextPageId: next } = sliceListPage(list, token, pageSize);
  total += items.length;
  token = next;
}
assert(total === list.length, `expected ${list.length} items, got ${total}`);
assert(parseOffsetToken("offset:10") === 10, "parse offset");
assert(parseOffsetToken(null) === 0, "null offset");

console.log(`smoke-list-pagination: OK (pageSize=${pageSize}, total=${total})`);
