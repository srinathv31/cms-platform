import { describe, expect, it } from "vitest";
import { API_ERROR_STATUS } from "../golive-types";
import {
  apiBadRequest,
  consumerMismatch,
  consumerNotFound,
  NOTICE_LIMIT,
  parseLimit,
  parseVersionNumber,
  QUERY_MESSAGES,
  SEARCH_LIMIT,
} from "./api-errors";

describe("the GET routes' errors", () => {
  it("words them as the contract does, with the contract's statuses", () => {
    expect(consumerNotFound("acme")).toEqual({ code: "consumer_not_found", message: "Consumer acme doesn't exist." });
    expect(consumerMismatch("coral")).toEqual({ code: "consumer_mismatch", message: "X-Consumer-Id doesn't match consumer coral." });
    expect(apiBadRequest(QUERY_MESSAGES.searchLimit)).toEqual({ code: "bad_request", message: "limit must be a number from 1 to 50." });
    expect(API_ERROR_STATUS.consumer_not_found).toBe(404);
    expect(API_ERROR_STATUS.consumer_mismatch).toBe(403);
  });
});

describe("parseLimit", () => {
  const search = (raw: string | null) => parseLimit(raw, SEARCH_LIMIT, QUERY_MESSAGES.searchLimit);

  it("defaults when absent or blank, takes whole numbers in range", () => {
    expect(search(null)).toEqual({ ok: true, value: 20 });
    expect(search("  ")).toEqual({ ok: true, value: 20 });
    expect(search("1")).toEqual({ ok: true, value: 1 });
    expect(search(" 50 ")).toEqual({ ok: true, value: 50 });
    expect(parseLimit(null, NOTICE_LIMIT, QUERY_MESSAGES.noticeLimit)).toEqual({ ok: true, value: 50 });
    expect(parseLimit("200", NOTICE_LIMIT, QUERY_MESSAGES.noticeLimit)).toEqual({ ok: true, value: 200 });
  });

  it.each(["0", "51", "-1", "2.5", "ten", "1e1", "99999999999999999999"])("refuses %s", (raw) => {
    expect(search(raw)).toEqual({ ok: false, error: { code: "bad_request", message: "limit must be a number from 1 to 50." } });
  });

  it("the notices range is 1–200", () => {
    expect(parseLimit("201", NOTICE_LIMIT, QUERY_MESSAGES.noticeLimit)).toEqual({
      ok: false,
      error: { code: "bad_request", message: "limit must be a number from 1 to 200." },
    });
  });
});

describe("parseVersionNumber", () => {
  it("absent → undefined; 1, 2, 10 → the number", () => {
    expect(parseVersionNumber(null, QUERY_MESSAGES.version)).toEqual({ ok: true, value: undefined });
    expect(parseVersionNumber("", QUERY_MESSAGES.version)).toEqual({ ok: true, value: undefined });
    expect(parseVersionNumber("10", QUERY_MESSAGES.version)).toEqual({ ok: true, value: 10 });
  });

  it.each(["0", "01", "-1", "1.5", "v2", "draft"])("refuses %s", (raw) => {
    expect(parseVersionNumber(raw, QUERY_MESSAGES.since)).toEqual({ ok: false, error: { code: "bad_request", message: "since must be a version number." } });
  });
});
