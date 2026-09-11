// The feedback form's server side.
//
// It shares a route with the collection form because api/ is at Vercel Hobby's
// 12-function cap and a thirteenth file fails the DEPLOY while the BUILD still
// passes -- production quietly keeps serving the previous commit. So the first
// thing these tests pin down is that sharing a route did not change what the
// existing form does.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler from "../api/submit-collection.ts";

function mockRes(): any {
  return {
    statusCode: 0,
    body: null,
    headers: {} as any,
    setHeader(k: string, v: any) {
      this.headers[k] = v;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    },
  };
}

const VALID_COLLECTION = {
  collectionName: "Highsmith Street Photography",
  submitterName: "Ada",
  submitterEmail: "ada@example.com",
  collectionLink: "https://example.org/collection",
  licenseType: "CC0",
  licenseVerificationLink: "https://example.org/license",
  description: "Street photography, openly licensed.",
};

// The Resend payload from the most recent send, so tests can assert on what we
// would actually have emailed rather than only on the status code.
let sent: any;

beforeEach(() => {
  sent = null;
  process.env.RESEND_API_KEY = "test-key";
  process.env.SUBMIT_NOTIFY_EMAIL = "mel@example.com";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: any, init: any) => {
      sent = { url, body: JSON.parse(init.body) };
      return { ok: true, status: 200, text: async () => "" };
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.RESEND_API_KEY;
  delete process.env.SUBMIT_NOTIFY_EMAIL;
});

async function post(body: any) {
  const res = mockRes();
  await handler({ method: "POST", body, headers: {} } as any, res);
  return res;
}

describe("the collection form is unchanged by the folding-in", () => {
  it("still accepts a valid submission", async () => {
    const res = await post(VALID_COLLECTION);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("still enforces its own required fields", async () => {
    const res = await post({ ...VALID_COLLECTION, collectionName: "" });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain("collectionName");
  });

  it("routes on `kind`, so an absent one means the original form", async () => {
    // Every existing caller predates this field. If the default flipped, the
    // submit page would start failing validation for fields it never sends.
    await post(VALID_COLLECTION);
    expect(sent.body.subject).toContain("New Tranquilo submission");
  });

  it("still sets reply_to to the submitter", async () => {
    await post(VALID_COLLECTION);
    expect(sent.body.reply_to).toBe("ada@example.com");
  });
});

describe("feedback", () => {
  it("accepts a message alone", async () => {
    const res = await post({
      kind: "feedback",
      message: "The images are broken on iOS.",
    });
    expect(res.statusCode).toBe(200);
    expect(sent.body.subject).toContain("feedback");
    expect(sent.body.text).toContain("The images are broken on iOS.");
  });

  it("rejects an empty message, since it is the only thing we truly need", async () => {
    const res = await post({ kind: "feedback", message: "   " });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain("message");
  });

  it("does NOT require an email", async () => {
    // The load-bearing decision in this ticket. A bug report should not cost
    // someone their identity on a product with no accounts and no tracking.
    const res = await post({
      kind: "feedback",
      message: "Typo on the about page.",
    });
    expect(res.statusCode).toBe(200);
  });

  it("omits reply_to entirely when no email was given", async () => {
    // Not an empty string: Resend rejects the whole send on a malformed
    // reply_to, which would turn "chose to stay anonymous" into "the report
    // vanished".
    await post({ kind: "feedback", message: "Anonymous note." });
    expect("reply_to" in sent.body).toBe(false);
  });

  it("says plainly in the email that no reply is possible", async () => {
    // So a blank line does not read as an address that failed to come through.
    await post({ kind: "feedback", message: "Anonymous note." });
    expect(sent.body.text).toMatch(/anonymous/i);
  });

  it("sets reply_to when an email IS given", async () => {
    await post({
      kind: "feedback",
      message: "Call me back.",
      email: "ada@example.com",
    });
    expect(sent.body.reply_to).toBe("ada@example.com");
  });

  it("rejects a malformed email rather than silently dropping it", async () => {
    // Someone typing "ada@" was trying to give us a way to reply. Dropping it
    // looks identical to them choosing anonymity, and they never find out.
    const res = await post({ kind: "feedback", message: "Hi", email: "ada@" });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain("email");
  });

  it("keeps the report when the type is unrecognised", async () => {
    // The type vocabulary is ours, not theirs. A client sending an unknown one
    // is our bug, and losing someone's written report to it is the wrong trade.
    const res = await post({
      kind: "feedback",
      message: "Real report",
      feedbackType: "Nonsense",
    });
    expect(res.statusCode).toBe(200);
    expect(sent.body.text).toContain("Type: Something else");
    expect(sent.body.text).toContain("Real report");
  });

  it("carries the type through when it is a known one", async () => {
    await post({
      kind: "feedback",
      message: "x",
      feedbackType: "Feature idea",
    });
    expect(sent.body.subject).toContain("Feature idea");
  });

  it("caps the message length", async () => {
    const res = await post({ kind: "feedback", message: "x".repeat(4001) });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain("message");
  });

  it("escapes HTML in the message", async () => {
    // The notification is an HTML email we open ourselves; unescaped input from
    // a public form is how that becomes someone else's injection point.
    await post({ kind: "feedback", message: "<img src=x onerror=alert(1)>" });
    expect(sent.body.html).not.toContain("<img src=x");
    expect(sent.body.html).toContain("&lt;img");
  });

  it("records the Signals-first process in the notification itself", async () => {
    // The rule is that one report is a data point and several corroborating
    // ones are an issue. Stating it in the email keeps it from living only in a
    // ticket nobody re-reads at the moment of triage.
    await post({ kind: "feedback", message: "x" });
    expect(sent.body.text).toContain("Signals");
  });

  it("reports a misconfigured pipeline rather than claiming success", async () => {
    delete process.env.RESEND_API_KEY;
    const res = await post({ kind: "feedback", message: "x" });
    expect(res.statusCode).toBe(500);
    expect(res.body.ok).toBeUndefined();
  });

  it("surfaces a Resend failure instead of swallowing it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 422,
        text: async () => "bad request",
      })),
    );
    const res = await post({ kind: "feedback", message: "x" });
    expect(res.statusCode).toBe(502);
  });
});

describe("report", () => {
  const VALID_REPORT = {
    kind: "report",
    itemSource: "met",
    itemNativeId: "437123",
    itemTitle: "Self-Portrait",
    itemUrl: "https://tranquilo.art/v/met-437123",
    categories: ["There's an issue with image"],
  };

  it("accepts a valid report", async () => {
    const res = await post(VALID_REPORT);
    expect(res.statusCode).toBe(200);
    expect(sent.body.subject).toContain("User content report");
  });

  it("requires itemSource and itemNativeId", async () => {
    const res = await post({ ...VALID_REPORT, itemSource: "" });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain("itemSource");
  });

  it("does NOT require an email, same as feedback", async () => {
    const res = await post(VALID_REPORT);
    expect(res.statusCode).toBe(200);
  });

  it("never sets reply_to -- a report carries no reporter identity at all", async () => {
    await post(VALID_REPORT);
    expect("reply_to" in sent.body).toBe(false);
  });

  it("accepts more than one checked category at once", async () => {
    await post({
      ...VALID_REPORT,
      categories: [
        "There's an issue with image",
        "I'm having a technical issue (broken link)",
      ],
    });
    expect(sent.body.text).toContain(
      "There's an issue with image, I'm having a technical issue (broken link)",
    );
  });

  it("drops an unrecognised category rather than rejecting the whole report", async () => {
    // The category list is ours, not the reporter's -- a client sending an
    // unknown one is our bug, and losing the rest of a real report to it
    // would be the wrong trade.
    await post({
      ...VALID_REPORT,
      categories: ["Nonsense", "There's an issue with content"],
    });
    expect(sent.body.text).toContain("Report: There's an issue with content");
    expect(sent.body.text).not.toContain("Nonsense");
  });

  it("requires at least a category or a comment, not neither", async () => {
    const res = await post({ ...VALID_REPORT, categories: [], comment: "" });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain("Nothing to report");
  });

  it("accepts a comment alone with no category checked", async () => {
    const res = await post({
      ...VALID_REPORT,
      categories: [],
      comment: "The lightbox never opens.",
    });
    expect(res.statusCode).toBe(200);
    expect(sent.body.text).toContain("(no category selected)");
    expect(sent.body.text).toContain("The lightbox never opens.");
  });

  it("puts the item's link in the notification, in the requested wording", async () => {
    await post(VALID_REPORT);
    expect(sent.body.text).toContain(
      "A user made a report at: https://tranquilo.art/v/met-437123",
    );
  });

  it("says No comment provided when no comment was given", async () => {
    await post(VALID_REPORT);
    expect(sent.body.text).toContain("Comment: No comment provided");
  });

  it("carries a comment through when given", async () => {
    await post({
      ...VALID_REPORT,
      comment: "The colors look washed out on my phone.",
    });
    expect(sent.body.text).toContain(
      "Comment: The colors look washed out on my phone.",
    );
  });

  it("puts the date and time in the subject", async () => {
    await post(VALID_REPORT);
    expect(sent.body.subject).toMatch(
      /User content report \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/,
    );
  });

  it("caps the comment length", async () => {
    const res = await post({ ...VALID_REPORT, comment: "x".repeat(2001) });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain("comment");
  });

  it("escapes HTML in the comment", async () => {
    await post({ ...VALID_REPORT, comment: "<img src=x onerror=alert(1)>" });
    expect(sent.body.html).not.toContain("<img src=x");
    expect(sent.body.html).toContain("&lt;img");
  });

  it("reports a misconfigured pipeline rather than claiming success", async () => {
    delete process.env.RESEND_API_KEY;
    const res = await post(VALID_REPORT);
    expect(res.statusCode).toBe(500);
  });
});

describe("method handling", () => {
  it("rejects GET for both forms", async () => {
    const res = mockRes();
    await handler({ method: "GET", body: {}, headers: {} } as any, res);
    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe("POST");
  });
});
