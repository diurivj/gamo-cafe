import { describe, expect, it } from "vitest";

import { NEW_PAYMENT } from "~/shared/payment-draft";
import {
  isSaleAnswer,
  NEW_SALE,
  onlyStepChanged,
  saleAfter,
  saleBody,
  saleOutcome,
  type SaleResult,
  type SaleSnapshot,
  type SaleState,
  sameSale,
  snapshotOf,
  unitsText,
} from "~/shared/sale";

// Vender's one sale at a time (UI redesign §6.1): what each tap and each
// answer does to it. The screen renders this state and nothing else decides
// whether a sale may be sent, changed or started over.

const items = [
  { id: "agua", name: "Agua mineral", price: 1850 },
  { id: "cafe", name: "Café de olla", price: 2500 },
];

const selecting = (state: SaleState = NEW_SALE) =>
  [
    { type: "changed", itemId: "agua", by: 1 } as const,
    { type: "changed", itemId: "agua", by: 1 } as const,
    { type: "changed", itemId: "cafe", by: 1 } as const,
  ].reduce(saleAfter, state);

function frozen(state: SaleState, intent: "cobrar" | "dejar-abierta" = "cobrar", key = "llave-1"): SaleSnapshot {
  if (state.phase !== "editing") throw new Error("only a sale being edited is sent");
  const snapshot = snapshotOf({ draft: state.draft, items, billId: null, intent, key });
  if ("problem" in snapshot) throw new Error(snapshot.problem);
  return snapshot;
}

const recording = () => {
  const draft = selecting();
  const snapshot = frozen(draft);
  return { snapshot, state: saleAfter(draft, { type: "submitted", snapshot }) };
};

const result: SaleResult = {
  billId: "cuenta-1",
  customerName: null,
  total: 6200,
  owed: 0,
  state: "paid",
  canOpen: false,
};

describe("a selection", () => {
  it("adds and takes away units, and forgets an Item at zero", () => {
    const state = saleAfter(selecting(), { type: "changed", itemId: "cafe", by: -1 });

    expect(state).toMatchObject({ phase: "editing", draft: { quantities: { agua: 2 } } });
    expect(state.phase === "editing" && "cafe" in state.draft.quantities).toBe(false);
  });

  it("is emptied only when asked, and keeps the Customer, note and Payment through its changes", () => {
    const withFields = saleAfter(selecting(), {
      type: "fields",
      fields: { note: "Mesa 2", payment: { ...NEW_PAYMENT, method: "transfer" } },
    });
    const more = saleAfter(withFields, { type: "changed", itemId: "agua", by: 1 });
    expect(more).toMatchObject({ draft: { quantities: { agua: 3 }, fields: { note: "Mesa 2", payment: { method: "transfer" } } } });

    expect(saleAfter(more, { type: "cleared" })).toEqual(NEW_SALE);
  });
});

describe("the snapshot a sale is sent as", () => {
  it("freezes the Lines, the total, the Payment and the key", () => {
    const draft = saleAfter(selecting(), {
      type: "fields",
      fields: { payment: { ...NEW_PAYMENT, handedText: "100" } },
    });

    expect(frozen(draft)).toEqual({
      key: "llave-1",
      intent: "cobrar",
      billId: null,
      lines: [
        { itemId: "agua", name: "Agua mineral", quantity: 2, unitPrice: 1850 },
        { itemId: "cafe", name: "Café de olla", quantity: 1, unitPrice: 2500 },
      ],
      total: 6200,
      customer: null,
      note: "",
      payment: { method: "cash", amount: 6200, handedOver: 10000 },
    });
  });

  it("carries no Payment when the Bill is left Open, and no Customer or note when it targets a Bill", () => {
    const draft = saleAfter(selecting(), {
      type: "fields",
      fields: { note: "Mesa 2", customer: { id: "ruiz", name: "Familia Ruiz" } },
    });
    if (draft.phase !== "editing") throw new Error("unreachable");

    expect(frozen(draft, "dejar-abierta")).toMatchObject({ payment: null, note: "Mesa 2", customer: { id: "ruiz" } });
    expect(
      snapshotOf({ draft: draft.draft, items, billId: "cuenta-9", intent: "dejar-abierta", key: "k" }),
    ).toMatchObject({ billId: "cuenta-9", customer: null, note: "" });
  });

  it("is not made of an empty selection or of a Payment that cannot be read", () => {
    expect(snapshotOf({ draft: NEW_SALE.draft, items, billId: null, intent: "cobrar", key: "k" })).toEqual({
      problem: "Agrega al menos un producto.",
    });

    const partial = saleAfter(selecting(), {
      type: "fields",
      fields: { payment: { ...NEW_PAYMENT, partial: true, amountText: "100" } },
    });
    if (partial.phase !== "editing") throw new Error("unreachable");
    expect(snapshotOf({ draft: partial.draft, items, billId: null, intent: "cobrar", key: "k" })).toEqual({
      problem: "El pago no puede ser mayor que el total de la selección.",
    });
    // Leaving it Open sends no Payment, so what was typed for one does not matter.
    expect("problem" in snapshotOf({ draft: partial.draft, items, billId: null, intent: "dejar-abierta", key: "k" })).toBe(false);
  });

  it("is sent as the same form every time", () => {
    const draft = saleAfter(selecting(), {
      type: "fields",
      fields: { customer: { id: "ruiz", name: "Familia Ruiz" }, payment: { ...NEW_PAYMENT, partial: true, amountText: "10" } },
    });
    const snapshot = frozen(draft);

    expect(Object.fromEntries(saleBody(snapshot))).toEqual({
      intent: "cobrar",
      selection: JSON.stringify([
        { itemId: "agua", quantity: 2 },
        { itemId: "cafe", quantity: 1 },
      ]),
      customerId: "ruiz",
      note: "",
      billId: "",
      submissionKey: "llave-1",
      method: "cash",
      amount: "$10.00",
    });
    expect(saleBody(snapshot).toString()).toBe(saleBody(snapshot).toString());
  });
});

describe("a sale that was sent", () => {
  it("is frozen while it is being recorded: no change, no second sale, no new one", () => {
    const { state } = recording();
    expect(state.phase).toBe("recording");

    const other = frozen(selecting(), "dejar-abierta", "llave-2");
    for (const event of [
      { type: "changed", itemId: "agua", by: 1 },
      { type: "cleared" },
      { type: "fields", fields: { note: "otra" } },
      { type: "submitted", snapshot: other },
      { type: "started" },
      { type: "retried" },
    ] as const) {
      expect(saleAfter(state, event)).toBe(state);
    }
  });

  it("is confirmed by its own answer, and only then can a new one start, with nothing carried over", () => {
    const draft = saleAfter(selecting(), {
      type: "fields",
      fields: { note: "Mesa 2", payment: { ...NEW_PAYMENT, method: "transfer" } },
    });
    const snapshot = frozen(draft);
    const sent = saleAfter(draft, { type: "submitted", snapshot });

    const confirmed = saleAfter(sent, { type: "answered", key: snapshot.key, outcome: { outcome: "confirmed", answer: { sale: result } } });
    expect(confirmed).toEqual({ phase: "confirmed", snapshot, result, unavailable: [] });
    // Still frozen: the result stays until Nueva venta.
    expect(saleAfter(confirmed, { type: "changed", itemId: "agua", by: 1 })).toBe(confirmed);

    expect(saleAfter(confirmed, { type: "started" })).toEqual(NEW_SALE);
  });

  it("comes back as it was when it is refused, with the reason", () => {
    const draft = saleAfter(selecting(), { type: "fields", fields: { note: "Mesa 2" } });
    const snapshot = frozen(draft);
    const sent = saleAfter(draft, { type: "submitted", snapshot });

    const refused = saleAfter(sent, {
      type: "answered",
      key: snapshot.key,
      outcome: { outcome: "refused", answer: { error: "Ese cliente no existe o está retirado." } },
    });

    expect(refused).toEqual({ ...draft, refusal: "Ese cliente no existe o está retirado." });
    // A change answers the refusal: it is about the sale as it was sent.
    expect(saleAfter(refused, { type: "fields", fields: { note: "Mesa 3" } })).toMatchObject({ refusal: null });
    expect(saleAfter(refused, { type: "changed", itemId: "agua", by: 1 })).toMatchObject({ refusal: null });
    // Sent again as it is, the refusal is gone until the new answer.
    expect(saleAfter(refused, { type: "submitted", snapshot: frozen(refused, "cobrar", "llave-2") })).toMatchObject({
      phase: "recording",
      snapshot: { key: "llave-2" },
    });
  });

  it("drops the Items the server no longer offers, and stops offering them", () => {
    const { snapshot, state } = recording();

    const refused = saleAfter(state, {
      type: "answered",
      key: snapshot.key,
      outcome: { outcome: "refused", answer: { error: "Ya no está disponible.", unavailable: ["cafe"] } },
    });

    expect(refused).toMatchObject({ phase: "editing", draft: { quantities: { agua: 2 } }, unavailable: ["cafe"] });
    expect(refused.phase === "editing" && "cafe" in refused.draft.quantities).toBe(false);
    // A tap that was on its way adds nothing of it, and a new sale still does not offer it.
    const tapped = saleAfter(refused, { type: "changed", itemId: "cafe", by: 1 });
    expect(tapped.phase === "editing" && "cafe" in tapped.draft.quantities).toBe(false);
  });

  it("keeps its snapshot when the outcome is unknown, and retries with that very snapshot", () => {
    const { snapshot, state } = recording();

    const unknown = saleAfter(state, { type: "answered", key: snapshot.key, outcome: { outcome: "unknown" } });
    expect(unknown).toMatchObject({ phase: "unknown", snapshot });
    for (const event of [
      { type: "changed", itemId: "agua", by: 1 },
      { type: "fields", fields: { note: "otra" } },
      { type: "cleared" },
      { type: "started" },
    ] as const) {
      expect(saleAfter(unknown, event)).toBe(unknown);
    }

    const again = saleAfter(unknown, { type: "retried" });
    expect(again).toMatchObject({ phase: "recording", attempt: 2 });
    expect(again.phase === "recording" && again.snapshot).toBe(snapshot);
    expect(saleAfter(again, { type: "answered", key: snapshot.key, outcome: { outcome: "confirmed", answer: { sale: result } } })).toMatchObject({
      phase: "confirmed",
      result,
    });
  });

  it("is still of unknown outcome when a retry finds the session ended: an earlier attempt may have been recorded", () => {
    const { snapshot, state } = recording();
    const ended = { outcome: "refused", answer: { error: "Tu sesión terminó.", sessionEnded: true } } as const;

    // The first attempt: Entrar answered before any action ran, so nothing was recorded.
    expect(saleAfter(state, { type: "answered", key: snapshot.key, outcome: ended })).toMatchObject({
      phase: "editing",
      refusal: "Tu sesión terminó.",
    });

    const unknown = saleAfter(state, { type: "answered", key: snapshot.key, outcome: { outcome: "unknown" } });
    expect(unknown).toMatchObject({ phase: "unknown", sessionEnded: false });
    const retried = saleAfter(saleAfter(unknown, { type: "retried" }), { type: "answered", key: snapshot.key, outcome: ended });
    expect(retried).toMatchObject({ phase: "unknown", sessionEnded: true, attempt: 2 });
    expect(retried.phase === "unknown" && retried.snapshot).toBe(snapshot);
    // A rule's refusal on a retry is evidence: a recorded sale would have been answered as its repeat.
    const refused = saleAfter(saleAfter(unknown, { type: "retried" }), {
      type: "answered",
      key: snapshot.key,
      outcome: { outcome: "refused", answer: { error: "Ese cliente no existe o está retirado." } },
    });
    expect(refused).toMatchObject({ phase: "editing" });
  });

  it("ignores an answer that is not this sale's", () => {
    const { state } = recording();

    expect(saleAfter(state, { type: "answered", key: "otra-llave", outcome: { outcome: "unknown" } })).toBe(state);
    expect(saleAfter(NEW_SALE, { type: "answered", key: "llave-1", outcome: { outcome: "unknown" } })).toBe(NEW_SALE);
  });
});

describe("what a confirmed sale says", () => {
  const { snapshot } = recording();
  const withChange: SaleSnapshot = { ...snapshot, payment: { method: "cash", amount: 6200, handedOver: 10000 } };

  it("says the Payment, its method, the change and that the Bill is Paid", () => {
    expect(saleOutcome(withChange, result)).toEqual({
      title: "Pago registrado",
      details: "$62.00 en efectivo. Cuenta pagada.",
      change: "$38.00",
    });
  });

  it("says what a partly paid Bill still owes, and never that it is Paid", () => {
    const partial: SaleSnapshot = { ...snapshot, payment: { method: "transfer", amount: 1000, handedOver: null } };

    expect(saleOutcome(partial, { ...result, owed: 5200, state: "partial", customerName: "Familia Ruiz" })).toEqual({
      title: "Pago registrado",
      details: "$10.00 por transferencia. La cuenta de Familia Ruiz todavía debe $52.00.",
      change: null,
    });
  });

  it("says a Customer's earlier debt is still owed when only the new selection was paid", () => {
    const outcome = saleOutcome(snapshot, { ...result, total: 10200, owed: 4000, state: "partial", customerName: "Lupita" });

    expect(outcome.details).toBe("$62.00 en efectivo. La cuenta de Lupita todavía debe $40.00.");
  });

  it("says a Bill left Open took no Payment", () => {
    const open: SaleSnapshot = { ...snapshot, intent: "dejar-abierta", payment: null };

    expect(saleOutcome(open, { ...result, owed: 6200, state: "open", canOpen: true })).toEqual({
      title: "Cuenta abierta",
      details: "No se registró ningún pago. La cuenta debe $62.00.",
      change: null,
    });
  });

  it("says Items were added to the Bill it targeted", () => {
    const added: SaleSnapshot = { ...snapshot, intent: "dejar-abierta", payment: null, billId: "cuenta-9" };

    expect(
      saleOutcome(added, { ...result, total: 9900, owed: 9900, state: "open", customerName: "Lupita", canOpen: true }),
    ).toEqual({
      title: "Productos agregados",
      details: "No se registró ningún pago. La cuenta de Lupita debe $99.00.",
      change: null,
    });
  });
});

it("counts units in words", () => {
  expect([unitsText(1), unitsText(3)]).toEqual(["1 producto", "3 productos"]);
});

it("takes for a sale's answer only what carries the Bill", () => {
  expect(isSaleAnswer({ sale: result })).toBe(true);
  expect(isSaleAnswer({})).toBe(false);
  expect(isSaleAnswer({ sale: null })).toBe(false);
});

describe("the two steps of one sale", () => {
  const at = (path: string) => new URL(path, "https://app.invalid");

  it("are the same sale at the same screen and target Bill, whichever step is on", () => {
    expect(sameSale(at("/"), at("/?paso=cobrar"))).toBe(true);
    expect(sameSale(at("/?billId=b1&paso=cobrar"), at("/?billId=b1"))).toBe(true);
    expect(sameSale(at("/?billId=b1"), at("/"))).toBe(false);
    expect(sameSale(at("/?paso=cobrar"), at("/mi-dia"))).toBe(false);
  });

  it("change nothing a loader reads when only the step moved", () => {
    expect(onlyStepChanged(at("/"), at("/?paso=cobrar"))).toBe(true);
    expect(onlyStepChanged(at("/?billId=b1&paso=cobrar"), at("/?billId=b1"))).toBe(true);
    // Vender tapped again, or opened from elsewhere: read as usual.
    expect(onlyStepChanged(at("/"), at("/"))).toBe(false);
    expect(onlyStepChanged(at("/inicio"), at("/"))).toBe(false);
    expect(onlyStepChanged(at("/?billId=b1"), at("/?paso=cobrar"))).toBe(false);
  });
});
