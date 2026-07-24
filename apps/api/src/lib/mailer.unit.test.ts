import { Effect, Exit, Option } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeMailer } from "./mailer";

const from = "Poppynz <no-reply@poppynz.com>";

const resendMailer = (adminNotificationEmails: ReadonlyArray<string> = []) =>
  makeMailer({ resendApiKey: Option.some("re_test_key"), from, adminNotificationEmails });
const logMailer = () => makeMailer({ resendApiKey: Option.none(), from, adminNotificationEmails: [] });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("makeMailer (resend mode)", () => {
  it("posts the mail to the Resend API with the configured sender and key", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ id: "mail-1" }), { status: 200 }));

    await Effect.runPromise(
      resendMailer().sendReferralInvite({
        email: "invitee@example.com",
        inviterName: "Maria Santos",
        role: "family",
        link: "https://app.poppynz.com/auth/sign-up?email=invitee%40example.com&role=family",
      }),
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer re_test_key",
      "Content-Type": "application/json",
    });
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      from,
      to: ["invitee@example.com"],
      subject: "Maria Santos invited you to join Poppynz",
    });
    expect(body.html).toContain("https://app.poppynz.com/auth/sign-up?email=invitee%40example.com&amp;role=family");
    expect(body.text).toContain("Maria Santos invited you to join Poppynz as a family.");
  });

  it("sends the admin notification to the configured recipient list", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ id: "mail-1" }), { status: 200 }));

    await Effect.runPromise(
      resendMailer(["springfield@poppynz.com", "kay@poppynz.com"]).sendAdminApprovalRequestSubmitted({
        providerName: "Provider User",
        providerEmail: "provider@example.com",
      }),
    );

    const body = JSON.parse(String(fetchSpy.mock.calls[0]![1]?.body));
    expect(body.to).toEqual(["springfield@poppynz.com", "kay@poppynz.com"]);
    expect(body.subject).toBe("New service provider approval request");
    expect(body.text).toContain("Provider User (provider@example.com)");
  });

  it("skips the admin notification when no recipients are configured", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await Effect.runPromise(
      resendMailer([]).sendAdminApprovalRequestSubmitted({
        providerName: "Provider User",
        providerEmail: "provider@example.com",
      }),
    );

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fails with MailerError when Resend responds with an error status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "invalid from" }), { status: 422 }),
    );

    const exit = await Effect.runPromiseExit(
      resendMailer().sendMagicLink({ email: "user@example.com", link: "https://app.poppynz.com/magic" }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(String(exit.cause)).toContain("MailerError");
    }
  });

  it("fails with MailerError when the request itself fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));

    const exit = await Effect.runPromiseExit(
      resendMailer().sendApprovalGranted({
        email: "provider@example.com",
        name: "Provider",
        expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
  });
});

describe("makeMailer (log mode, no RESEND_API_KEY)", () => {
  it("logs the magic link in the historical format instead of sending", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => { });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await Effect.runPromise(
      logMailer().sendMagicLink({ email: "user@example.com", link: "https://localhost:5173/magic" }),
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith("Magic link for user@example.com: https://localhost:5173/magic");
  });

  it("logs other mails instead of sending", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => { });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await Effect.runPromise(
      logMailer().sendApprovalRequestRejected({
        email: "provider@example.com",
        name: "Provider",
        reason: "Missing documents",
      }),
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(String(logSpy.mock.calls[0]![0])).toContain("provider@example.com");
  });
});
