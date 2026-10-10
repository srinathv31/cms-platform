import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RESPONSE_FORMATS } from "@/domain/golive/samples";
import type { Channel } from "@/domain/types";
import { Responses } from "./responses";

// The SHARE panel's response formats: one per channel that is on, and the base64 opt-in only where a
// document channel answers it (Push and SMS are JSON already).

const names = (channels: Channel[]) =>
  [...renderToStaticMarkup(<Responses responses={[...RESPONSE_FORMATS]} errors={[]} channels={channels} />).matchAll(/<span class="w-14[^"]*">([^<]+)<\/span>/g)].map(
    (m) => m[1],
  );

describe("Responses", () => {
  it("lists a document's channels and the base64 opt-in", () => {
    expect(names(["pdf", "email"])).toEqual(["PDF", "Email", "Base64"]);
  });

  it("lists an alert's Push and SMS, without base64", () => {
    expect(names(["push", "sms"])).toEqual(["Push", "SMS"]);
  });
});
