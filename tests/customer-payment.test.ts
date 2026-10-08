import { describe, expect, it } from "vitest";

import {
  customerPaymentAfter,
  customerPaymentBody,
  customerPaymentOutcome,
  type CustomerPaymentResult,
  type CustomerPaymentSnapshot,
  type CustomerPaymentState,
  customerPaymentSnapshot,
  isCustomerPaymentAnswer,
  NEW_CUSTOMER_PAYMENT,
} from "~/shared/customer-payment";
import { NEW_PAYMENT } from "~/shared/payment-draft";
import { paymentMessages } from "~/shared/payment-messages";

// Abonar (UI redesign §5.3, §6.1): what each tap and each answer does to one
// handover across a Customer's Open Bills. The screen renders this state and
// nothing else decides whether it may be sent, changed or sent again.

const customer = {
  id: "cliente-1",
  name: "Familia Ruiz",
  owed: 8000,
  bills: [
    { id: "vieja", revision: 2 },
    { id: "nueva", revision: 0 },
  ],
};

function frozen(state: CustomerPaymentState = NEW_CUSTOMER_PAYMENT, key = "llave-1"): CustomerPaymentSnapshot {
  if (state.phase !== "editing") throw new Error("only a handover being typed is sent");
  const snapshot = customerPaymentSnapshot({ draft: state.draft, customer, key });
  if ("problem" in snapshot) throw new Error(snapshot.problem);
  return snapshot;
}

const recording = (state: CustomerPaymentState = NEW_CUSTOMER_PAYMENT) => {
  const snapshot = frozen(state);
  return { snapshot, state: customerPaymentAfter(state, { type: "submitted", snapshot }) };
};

const result: CustomerPaymentResult = { amount: 8000, bills: 2, owed: 0 };
const confirmed = { outcome: "confirmed", answer: { handover: result } } as const;

describe("a handover being typed", () => {
  it("starts as cash for everything the Customer owes, with every Bill the screen showed", () => {
    expect(frozen()).toEqual({
      key: "llave-1",
      customerId: "cliente-1",
      customerName: "Familia Ruiz",
      method: "cash",
      amount: 8000,
      handedOver: null,
      bills: [
        { billId: "vieja", revision: 2 },
        { billId: "nueva", revision: 0 },
      ],
    });
  });

  it("is sent as a smaller amount, with the cash handed over kept for the change", () => {
    const draft = { method: "cash" as const, partial: true, amountText: "60", handedText: "100" };
    expect(customerPaymentSnapshot({ draft, customer, key: "llave-2" })).toMatchObject({
      amount: 6000,
      handedOver: 10000,
    });
  });

  it("cannot be sent for more than the Customer owes, for nothing, or before the amount is typed", () => {
    const part = (amountText: string) =>
      customerPaymentSnapshot({ draft: { ...NEW_PAYMENT, partial: true, amountText }, customer, key: "llave-3" });
    expect(part("80.01")).toEqual({ problem: paymentMessages.CustomerPaymentExceedsOwed });
    expect(part("0")).toEqual({ problem: paymentMessages.PaymentNotPositive });
    expect(part("")).toEqual({ problem: "Escribe cuánto se cobra." });
  });

  it("keeps what is typed, and a change answers the last refusal", () => {
    const { snapshot, state } = recording();
    const refused = customerPaymentAfter(state, {
      type: "answered",
      key: snapshot.key,
      outcome: { outcome: "refused", answer: { error: paymentMessages.CustomerBillsChanged, changed: true } },
    });
    expect(refused).toEqual({ phase: "editing", draft: NEW_PAYMENT, refusal: paymentMessages.CustomerBillsChanged });

    const draft = { ...NEW_PAYMENT, method: "transfer" as const };
    expect(customerPaymentAfter(refused, { type: "typed", draft })).toEqual({ phase: "editing", draft, refusal: null });
  });
});

describe("a handover that was sent", () => {
  it("is frozen: nothing typed or tapped changes it until it is answered", () => {
    const { state } = recording();
    expect(state).toMatchObject({ phase: "recording", attempt: 1 });
    expect(customerPaymentAfter(state, { type: "typed", draft: { ...NEW_PAYMENT, method: "transfer" } })).toBe(state);
    expect(
      customerPaymentAfter(state, { type: "submitted", snapshot: frozen(NEW_CUSTOMER_PAYMENT, "otra") }),
    ).toBe(state);
    expect(customerPaymentAfter(state, { type: "started" })).toBe(state);
    expect(customerPaymentAfter(state, { type: "retried" })).toBe(state);
  });

  it("is confirmed only by its own answer, and keeps what the server said", () => {
    const { snapshot, state } = recording();

    expect(customerPaymentAfter(state, { type: "answered", key: "otra", outcome: confirmed })).toBe(state);
    expect(customerPaymentAfter(state, { type: "answered", key: snapshot.key, outcome: confirmed })).toEqual({
      phase: "confirmed",
      snapshot,
      result,
    });
  });

  it("starts another handover only after it was confirmed, as cash for everything again", () => {
    const transfer = customerPaymentAfter(NEW_CUSTOMER_PAYMENT, {
      type: "typed",
      draft: { ...NEW_PAYMENT, method: "transfer" },
    });
    const { snapshot, state } = recording(transfer);
    const done = customerPaymentAfter(state, { type: "answered", key: snapshot.key, outcome: confirmed });

    expect(customerPaymentAfter(done, { type: "started" })).toEqual(NEW_CUSTOMER_PAYMENT);
  });
});

describe("a handover nobody answered", () => {
  const unanswered = () => {
    const { snapshot, state } = recording();
    return {
      snapshot,
      state: customerPaymentAfter(state, { type: "answered", key: snapshot.key, outcome: { outcome: "unknown" } }),
    };
  };

  it("is unknown, never refused, and only the same snapshot can be sent again", () => {
    const { snapshot, state } = unanswered();
    expect(state).toMatchObject({ phase: "unknown", snapshot, sessionEnded: false });
    expect(customerPaymentAfter(state, { type: "typed", draft: { ...NEW_PAYMENT, method: "transfer" } })).toBe(state);
    expect(customerPaymentAfter(state, { type: "started" })).toBe(state);

    const again = customerPaymentAfter(state, { type: "retried" });
    expect(again).toMatchObject({ phase: "recording", attempt: 2 });
    expect(again.phase === "recording" && again.snapshot).toBe(snapshot);
  });

  it("stays unknown when a retry finds the session ended: the first attempt may have been recorded", () => {
    const { snapshot, state } = unanswered();
    const again = customerPaymentAfter(state, { type: "retried" });
    const ended = customerPaymentAfter(again, {
      type: "answered",
      key: snapshot.key,
      outcome: { outcome: "refused", answer: { error: "Tu sesión terminó.", sessionEnded: true } },
    });
    expect(ended).toMatchObject({ phase: "unknown", snapshot, sessionEnded: true });
  });

  it("is refused as nothing recorded when the session ended on the first attempt", () => {
    const { snapshot, state } = recording();
    const ended = customerPaymentAfter(state, {
      type: "answered",
      key: snapshot.key,
      outcome: { outcome: "refused", answer: { error: "Tu sesión terminó.", sessionEnded: true } },
    });
    expect(ended).toEqual({ phase: "editing", draft: NEW_PAYMENT, refusal: "Tu sesión terminó." });
  });
});

describe("how a handover is sent", () => {
  it("carries the same fields in the same order every time, one `bill` per Bill", () => {
    const body = customerPaymentBody(frozen());
    expect([...body]).toEqual([
      ["method", "cash"],
      ["amount", "$80.00"],
      ["submissionKey", "llave-1"],
      ["bill", "vieja:2"],
      ["bill", "nueva:0"],
    ]);
    expect(customerPaymentBody(frozen()).toString()).toBe(body.toString());
  });

  it("is confirmed only by an answer that carries the handover", () => {
    expect(isCustomerPaymentAnswer({ handover: result })).toBe(true);
    expect(isCustomerPaymentAnswer({ notice: "Abono registrado." })).toBe(false);
    expect(isCustomerPaymentAnswer({ handover: null })).toBe(false);
  });
});

describe("what a confirmed handover says", () => {
  const sent = (draft = NEW_PAYMENT) => {
    const snapshot = customerPaymentSnapshot({ draft, customer, key: "llave-4" });
    if ("problem" in snapshot) throw new Error(snapshot.problem);
    return snapshot;
  };

  it("says what was recorded, how many Bills it reached and that nothing is owed", () => {
    expect(customerPaymentOutcome(sent(), result)).toEqual({
      title: "Abono registrado",
      details: "$80.00 en efectivo, en 2 cuentas. Familia Ruiz ya no debe nada.",
      change: null,
    });
  });

  it("says what the Customer still owes after a part, and the change for the cash handed over", () => {
    const draft = { method: "cash" as const, partial: true, amountText: "30", handedText: "50" };
    expect(customerPaymentOutcome(sent(draft), { amount: 3000, bills: 1, owed: 5000 })).toEqual({
      title: "Abono registrado",
      details: "$30.00 en efectivo, en 1 cuenta. Familia Ruiz todavía debe $50.00.",
      change: "$20.00",
    });
  });

  it("offers no change for a transfer", () => {
    const draft = { method: "transfer" as const, partial: false, amountText: "", handedText: "100" };
    expect(customerPaymentOutcome(sent(draft), result)).toMatchObject({
      details: "$80.00 por transferencia, en 2 cuentas. Familia Ruiz ya no debe nada.",
      change: null,
    });
  });
});
