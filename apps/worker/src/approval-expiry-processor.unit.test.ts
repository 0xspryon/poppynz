import {
  makeApprovalRepoTest,
  type Approval,
  type ApprovalExpiryCandidate,
  type ApprovalExpiryNotifiedStamps,
} from "@repo/db";
import { MailerError, makeMailerTest, type ApprovalExpiringMail } from "@repo/mail";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { processApprovalExpiryNotifications } from "./approval-expiry-processor";

const now = new Date("2026-07-24T02:00:00.000Z");
const day = 86_400_000;
const uiOrigin = "https://app.poppynz.com";

const daysFromNow = (days: number) => new Date(now.getTime() + days * day);

const candidate = (overrides: Partial<ApprovalExpiryCandidate> = {}): ApprovalExpiryCandidate => ({
  id: "approval-1",
  userId: "provider-1",
  approvalRequestId: "request-1",
  status: "approved",
  reason: null,
  approvedBy: "admin-1",
  expiresAt: daysFromNow(20),
  notifiedExpiresInOneMonthAt: null,
  notifiedExpiresInTwoWeeksAt: null,
  notifiedExpiresInOneWeekAt: null,
  notifiedExpiresInTwoDaysAt: null,
  createdAt: new Date("2026-06-12T00:00:00.000Z"),
  updatedAt: new Date("2026-06-12T00:00:00.000Z"),
  applicant: { email: "provider@example.com", name: "Provider User" },
  ...overrides,
});

type Recorded = {
  sent: Array<ApprovalExpiringMail>;
  stamped: Array<{ id: string; stamps: ApprovalExpiryNotifiedStamps }>;
};

const makeLayer = (
  candidates: Array<ApprovalExpiryCandidate>,
  recorded: Recorded,
  options: { failMailFor?: Array<string> } = {},
) =>
  Layer.mergeAll(
    makeApprovalRepoTest({
      listExpiringForNotification: () => Effect.succeed(candidates),
      markExpiryNotified: (id, stamps) => {
        recorded.stamped.push({ id, stamps });
        return Effect.succeed({} as Approval);
      },
    }),
    makeMailerTest({
      sendApprovalExpiring: (mail) => {
        recorded.sent.push(mail);
        return options.failMailFor?.includes(mail.email)
          ? Effect.fail(new MailerError({ cause: "boom" }))
          : Effect.void;
      },
    }),
  );

const run = (
  candidates: Array<ApprovalExpiryCandidate>,
  options: { failMailFor?: Array<string> } = {},
) => {
  const recorded: Recorded = { sent: [], stamped: [] };
  return Effect.runPromise(
    processApprovalExpiryNotifications(now, uiOrigin).pipe(
      Effect.provide(makeLayer(candidates, recorded, options)),
    ),
  ).then((summary) => ({ summary, ...recorded }));
};

describe("processApprovalExpiryNotifications", () => {
  it("fires the one-month tier for an approval 20 days from expiry", async () => {
    const { summary, sent, stamped } = await run([candidate()]);

    expect(summary).toEqual({ candidates: 1, notified: 1, skipped: 0, failed: 0 });
    expect(sent).toEqual([
      {
        email: "provider@example.com",
        name: "Provider User",
        expiresAt: daysFromNow(20),
        daysRemaining: 20,
        link: uiOrigin,
      },
    ]);
    expect(stamped).toEqual([
      { id: "approval-1", stamps: { notifiedExpiresInOneMonthAt: now } },
    ]);
  });

  it("walks down the tiers as expiry approaches", async () => {
    const { sent, stamped } = await run([
      candidate({
        expiresAt: daysFromNow(10),
        notifiedExpiresInOneMonthAt: new Date("2026-07-01T02:00:00.000Z"),
      }),
    ]);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.daysRemaining).toBe(10);
    expect(stamped).toEqual([
      { id: "approval-1", stamps: { notifiedExpiresInTwoWeeksAt: now } },
    ]);
  });

  it("late-entering approval gets one mail and auto-stamps all longer tiers", async () => {
    const { sent, stamped } = await run([candidate({ expiresAt: daysFromNow(5) })]);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.daysRemaining).toBe(5);
    expect(stamped).toEqual([
      {
        id: "approval-1",
        stamps: {
          notifiedExpiresInOneWeekAt: now,
          notifiedExpiresInTwoWeeksAt: now,
          notifiedExpiresInOneMonthAt: now,
        },
      },
    ]);
  });

  it("stamps every tier once the two-days mail fires", async () => {
    const { sent, stamped } = await run([candidate({ expiresAt: daysFromNow(1) })]);

    expect(sent[0]?.daysRemaining).toBe(1);
    expect(stamped[0]?.stamps).toEqual({
      notifiedExpiresInTwoDaysAt: now,
      notifiedExpiresInOneWeekAt: now,
      notifiedExpiresInTwoWeeksAt: now,
      notifiedExpiresInOneMonthAt: now,
    });
  });

  it("is idempotent: an already-fired deepest tier sends nothing", async () => {
    const { summary, sent, stamped } = await run([
      candidate({ notifiedExpiresInOneMonthAt: new Date("2026-07-20T02:00:00.000Z") }),
    ]);

    expect(summary).toEqual({ candidates: 1, notified: 0, skipped: 1, failed: 0 });
    expect(sent).toEqual([]);
    expect(stamped).toEqual([]);
  });

  it("a failed send is not stamped and does not stop the batch", async () => {
    const { summary, stamped } = await run(
      [
        candidate({ id: "approval-1" }),
        candidate({
          id: "approval-2",
          applicant: { email: "other@example.com", name: null },
          expiresAt: daysFromNow(12),
        }),
      ],
      { failMailFor: ["provider@example.com"] },
    );

    expect(summary).toEqual({ candidates: 2, notified: 1, skipped: 0, failed: 1 });
    expect(stamped).toEqual([
      {
        id: "approval-2",
        stamps: { notifiedExpiresInTwoWeeksAt: now, notifiedExpiresInOneMonthAt: now },
      },
    ]);
  });
});
