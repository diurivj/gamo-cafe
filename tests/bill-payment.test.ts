import { describe, expect, it } from "vitest";

import {
  billPaymentAfter,
  billPaymentBody,
  billPaymentOutcome,
  type BillPaymentResult,
  type BillPaymentSnapshot,
  type BillPaymentState,
  billPaymentSnapshot,
  isBillPaymentAnswer,
  NEW_BILL_PAYMENT,
} from "~/shared/bill-payment";
import { NEW_PAYMENT } from "~/shared/payment-draft";
import { paymentMessages } from "~/shared/payment-messages";

// Cuenta's Payment (UI redesign §5.3, §6.1): what each tap and each answer
// does to it. The screen renders this state and nothing else decides whether
// a Payment may be sent, changed or sent again.

const bill = { id: "cuenta-1", revision: 3, owed: 2500, customerName: "Familia Ruiz" };

function frozen(state: BillPaymentState = NEW_BILL_PAYMENT, key = "llave-1"): BillPaymentSnapshot {
  if (state.phase !== "editing") throw new Error("only a Payment being typed is sent");
  const snapshot = billPaymentSnapshot({ draft: state.draft, bill, key });
  if ("problem" in snapshot) throw new Error(snapshot.problem);
  return snapshot;
}

const recording = (state: BillPaymentState = NEW_BILL_PAYMENT) => {
  const snapshot = frozen(state);
  return { snapshot, state: billPaymentAfter(state, { type: "submitted", snapshot }) };
};

const result: BillPaymentResult = { amount: 2500, total: 4000, owed: 0, paid: true, canOpen: false };

describe("a Payment being typed", () => {
  it("starts as cash for everything the Bill owes", () => {
    expect(frozen()).toEqual({
      key: "llave-1",
      billId: "cuenta-1",
      revision: 3,
      customerName: "Familia Ruiz",
      method: "cash",
      amount: 2500,
      handedOver: null,
    });
  });

  it("keeps what is typed, and a change answers the last refusal", () => {
    const { snapshot, state } = recording();
    const refused = billPaymentAfter(state, {
      type: "answered",
      key: snapshot.key,
      outcome: { outcome: "refused", answer: { error: paymentMessages.PaymentNotPositive } },
    });
    expect(refused).toMatchObject({ phase: "editing", refusal: paymentMessages.PaymentNotPositive });

    const draft = { ...NEW_PAYMENT, method: "transfer" as const };
    expect(billPaymentAfter(refused, { type: "typed", draft })).toEqual({ phase: "editing", draft, refusal: null });
  });

  it("is sent as a part, with the cash handed over kept for the change", () => {
    const draft = { method: "cash" as const, partial: true, amountText: "10", handedText: "20" };
    const snapshot = billPaymentSnapshot({ draft, bill, key: "llave-2" });
    expect(snapshot).toMatchObject({ amount: 1000, handedOver: 2000 });
  });

  it("cannot be sent for more than the Bill owes, or before a part is typed", () => {
    const part = (amountText: string) =>
      billPaymentSnapshot({ draft: { ...NEW_PAYMENT, partial: true, amountText }, bill, key: "llave-3" });
    expect(part("25.01")).toEqual({ problem: paymentMessages.PaymentExceedsOwed });
    expect(part("")).toEqual({ problem: "Escribe cuánto se cobra." });
    expect(part("0")).toEqual({ problem: paymentMessages.PaymentNotPositive });
  });
});

describe("a Payment that was sent", () => {
  it("is frozen: nothing typed or tapped changes it until it is answered", () => {
    const { state } = recording();
    expect(state).toMatchObject({ phase: "recording", attempt: 1 });
    expect(billPaymentAfter(state, { type: "typed", draft: { ...NEW_PAYMENT, method: "transfer" } })).toBe(state);
    expect(billPaymentAfter(state, { type: "submitted", snapshot: frozen(NEW_BILL_PAYMENT, "otra") })).toBe(state);
    expect(billPaymentAfter(state, { type: "started" })).toBe(state);
    expect(billPaymentAfter(state, { type: "retried" })).toBe(state);
  });

  it("is confirmed only by its own answer, and keeps what the server said", () => {
    const { snapshot, state } = recording();
    const confirmed = { outcome: "confirmed", answer: { payment: result } } as const;

    expect(billPaymentAfter(state, { type: "answered", key: "otra", outcome: confirmed })).toBe(state);
    expect(billPaymentAfter(state, { type: "answered", key: snapshot.key, outcome: confirmed })).toEqual({
      phase: "confirmed",
      snapshot,
      result,
    });
  });

  it("starts another Payment only after it was confirmed", () => {
    const { snapshot, state } = recording();
    const confirmed = billPaymentAfter(state, {
      type: "answered",
      key: snapshot.key,
      outcome: { outcome: "confirmed", answer: { payment: result } },
    });
    expect(billPaymentAfter(confirmed, { type: "started" })).toEqual(NEW_BILL_PAYMENT);
  });

  it("comes back as it was typed when a rule refuses it", () => {
    const typed = billPaymentAfter(NEW_BILL_PAYMENT, {
      type: "typed",
      draft: { method: "transfer", partial: true, amountText: "10", handedText: "" },
    });
    const { snapshot, state } = recording(typed);
    const refused = billPaymentAfter(state, {
      type: "answered",
      key: snapshot.key,
      outcome: { outcome: "refused", answer: { error: paymentMessages.BillChanged, changed: { canOpen: true } } },
    });
    expect(refused).toEqual({
      phase: "editing",
      draft: { method: "transfer", partial: true, amountText: "10", handedText: "" },
      refusal: paymentMessages.BillChanged,
    });
  });

  it("ends when the Bill it was for can no longer be opened by this User", () => {
    const { snapshot, state } = recording();
    const gone = billPaymentAfter(state, {
      type: "answered",
      key: snapshot.key,
      outcome: { outcome: "refused", answer: { error: paymentMessages.BillChanged, changed: { canOpen: false } } },
    });
    expect(gone).toEqual({ phase: "gone", snapshot });
    // Nothing brings the form back: the Bill is not this User's to pay any more.
    expect(billPaymentAfter(gone, { type: "started" })).toBe(gone);
    expect(billPaymentAfter(gone, { type: "retried" })).toBe(gone);
  });
});

describe("a Payment of unknown outcome", () => {
  const unknown = () => {
    const { snapshot, state } = recording();
    return {
      snapshot,
      state: billPaymentAfter(state, { type: "answered", key: snapshot.key, outcome: { outcome: "unknown" } }),
    };
  };

  it("is neither failed nor recorded, and is retried as the very same Payment", () => {
    const { snapshot, state } = unknown();
    expect(state).toMatchObject({ phase: "unknown", snapshot, sessionEnded: false });
    expect(billPaymentAfter(state, { type: "typed", draft: NEW_PAYMENT })).toBe(state);
    expect(billPaymentAfter(state, { type: "started" })).toBe(state);

    const retried = billPaymentAfter(state, { type: "retried" });
    expect(retried).toMatchObject({ phase: "recording", attempt: 2 });
    expect(retried.phase === "recording" && retried.snapshot).toBe(snapshot);
  });

  it("stays unknown when a retry finds the session ended: the first attempt may have been recorded", () => {
    const { snapshot, state } = unknown();
    const signedOut = { outcome: "refused", answer: { error: "Tu sesión terminó.", sessionEnded: true } } as const;

    const retried = billPaymentAfter(state, { type: "retried" });
    expect(billPaymentAfter(retried, { type: "answered", key: snapshot.key, outcome: signedOut })).toMatchObject({
      phase: "unknown",
      snapshot,
      sessionEnded: true,
    });

    // On a first attempt Entrar answered before any action ran: nothing was recorded.
    const first = recording();
    expect(billPaymentAfter(first.state, { type: "answered", key: first.snapshot.key, outcome: signedOut })).toMatchObject({
      phase: "editing",
      refusal: "Tu sesión terminó.",
    });
  });
});

describe("what a Payment is sent as", () => {
  it("is the same form every time: the amount it said, the revision it saw and its key", () => {
    const snapshot = frozen();
    expect(Object.fromEntries(billPaymentBody(snapshot))).toEqual({
      method: "cash",
      amount: "$25.00",
      revision: "3",
      submissionKey: "llave-1",
    });
    expect(billPaymentBody(snapshot).toString()).toBe(billPaymentBody(snapshot).toString());
  });

  it("takes for its answer only what the route says it recorded", () => {
    expect(isBillPaymentAnswer({ payment: result })).toBe(true);
    expect(isBillPaymentAnswer({ sale: {} })).toBe(false);
    expect(isBillPaymentAnswer({ payment: null })).toBe(false);
  });
});

describe("what a confirmed Payment says", () => {
  it("says the Bill is Paid only when the server says nothing is owed", () => {
    expect(billPaymentOutcome(frozen(), result)).toEqual({
      title: "Pago registrado",
      details: "$25.00 en efectivo. Cuenta pagada.",
      change: null,
    });
  });

  it("says what the Bill still owes after a part, by transfer, and whose it is", () => {
    const draft = { method: "transfer" as const, partial: true, amountText: "10", handedText: "50" };
    const snapshot = billPaymentSnapshot({ draft, bill, key: "llave-4" }) as BillPaymentSnapshot;
    const partial = { amount: 1000, total: 4000, owed: 1500, paid: false, canOpen: true };
    expect(billPaymentOutcome(snapshot, partial)).toEqual({
      title: "Pago registrado",
      details: "$10.00 por transferencia. La cuenta de Familia Ruiz todavía debe $15.00.",
      // Cash handed over is only read for a cash Payment.
      change: null,
    });
    expect(billPaymentOutcome({ ...snapshot, customerName: null }, partial).details).toBe(
      "$10.00 por transferencia. La cuenta todavía debe $15.00.",
    );
  });

  it("keeps the change of the cash that was handed over", () => {
    const draft = { ...NEW_PAYMENT, handedText: "30" };
    const snapshot = billPaymentSnapshot({ draft, bill, key: "llave-5" }) as BillPaymentSnapshot;
    expect(billPaymentOutcome(snapshot, result).change).toBe("$5.00");
  });

  it("says what the server recorded, not what the screen asked for", () => {
    expect(billPaymentOutcome(frozen(), { ...result, amount: 2400, owed: 100, paid: false }).details).toBe(
      "$24.00 en efectivo. La cuenta de Familia Ruiz todavía debe $1.00.",
    );
  });
});
