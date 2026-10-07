import { describe, expect, it } from "vitest";

import { NEW_PAYMENT, readPaymentDraft } from "~/shared/payment-draft";

// What a Payment being typed pays (UI redesign §5.2): everything by default,
// less when asked, and the change for cash, which is only ever shown.

const TOO_MUCH = "El pago no puede ser mayor que el total de la selección.";
const read = (draft: Partial<typeof NEW_PAYMENT>, full = 6200) =>
  readPaymentDraft({ ...NEW_PAYMENT, ...draft }, full, TOO_MUCH);

describe("a Payment being typed", () => {
  it("starts as cash for everything, with nothing typed", () => {
    expect(NEW_PAYMENT).toEqual({ method: "cash", partial: false, amountText: "", handedText: "" });
    expect(read({})).toEqual({ amount: 6200, amountProblem: null, change: null, handedOver: null, handedProblem: null });
  });

  it("pays everything whatever was typed for a part before", () => {
    expect(read({ partial: false, amountText: "10" }).amount).toBe(6200);
  });

  it("pays the part that was typed", () => {
    expect(read({ partial: true, amountText: "10.50" })).toMatchObject({ amount: 1050, amountProblem: null });
  });

  it("says what is wrong with a part that cannot be paid", () => {
    expect(read({ partial: true, amountText: "" })).toMatchObject({ amount: null, amountProblem: "Escribe cuánto se cobra." });
    expect(read({ partial: true, amountText: "doce" })).toMatchObject({
      amount: null,
      amountProblem: "El monto no es válido. Escríbelo como 18.50.",
    });
    expect(read({ partial: true, amountText: "0" })).toMatchObject({
      amount: null,
      amountProblem: "El pago debe ser mayor que cero.",
    });
    expect(read({ partial: true, amountText: "62.01" })).toMatchObject({ amount: null, amountProblem: TOO_MUCH });
  });

  it("shows the change for the cash handed over, against the amount being paid", () => {
    expect(read({ handedText: "100" })).toMatchObject({ change: 3800, handedOver: 10000, handedProblem: null });
    expect(read({ partial: true, amountText: "10", handedText: "20" })).toMatchObject({ amount: 1000, change: 1000 });
    expect(read({ handedText: "62" })).toMatchObject({ change: 0 });
  });

  it("says when the cash handed over does not cover the Payment or cannot be read, and blocks nothing", () => {
    expect(read({ handedText: "50" })).toMatchObject({
      amount: 6200,
      change: null,
      handedProblem: "Lo entregado no alcanza para el pago.",
    });
    expect(read({ handedText: "mucho" })).toMatchObject({ amount: 6200, change: null, handedProblem: "Escribe un monto válido." });
  });

  it("has no change for a transfer", () => {
    expect(read({ method: "transfer", handedText: "100" })).toMatchObject({ change: null, handedOver: null, handedProblem: null });
  });
});
