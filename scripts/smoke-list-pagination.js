/**
 * Offline smoke checks for cache-backed followers/following pagination.
 * Run: node scripts/smoke-list-pagination.js
 */
import {
  LIST_PAGE_SIZE,
  buildOffsetToken,
  parseOffsetToken,
  sliceListPage,
  firstPageFromFullList,
} from "../src/services/utils/listPagination.js";

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const list = Array.from({ length: 120 }, (_, i) => ({ id: String(i), username: `u${i}` }));

const { page, nextPageId } = firstPageFromFullList(list, LIST_PAGE_SIZE);
assert(page.length === LIST_PAGE_SIZE, "first page size");
assert(nextPageId === buildOffsetToken(LIST_PAGE_SIZE), "first next token");

let token = nextPageId;
let total = page.length;
while (token) {
  const { items, nextPageId: next } = sliceListPage(list, token, LIST_PAGE_SIZE);
  total += items.length;
  token = next;
}
assert(total === list.length, `expected ${list.length} items, got ${total}`);
assert(parseOffsetToken("offset:50") === 50, "parse offset");
assert(parseOffsetToken(null) === 0, "null offset");

console.log("smoke-list-pagination: OK");
