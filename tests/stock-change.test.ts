import { describe, expect, it } from "vitest";

import type { AdjustmentReason } from "~/shared/adjustment";
import {
  adjustHref,
  adjustmentEffect,
  adjustmentProblems,
  adjustmentSnapshot,
  cancelHref,
  cancellationEffect,
  cancellationSnapshot,
  isStockChangeAnswer,
  newAdjustmentDraft,
  newStockChange,
  readAdjustmentDraft,
  stockChangeAfter,
  stockChangeBody,
  stockChangeOutcome,
  stockChangeRecordingText,
  type StockChangeSnapshot,
  type StockChangeState,
  stockStepOf,
} from "~/shared/stock-change";

// Inventario's Adjustment and its cancellation (UI redesign §6.1, §7): what
// each tap and each answer does to one change of Stock. The screen renders
// this state and nothing else decides whether it may be sent, changed or sent
// again.

const agua = { id: "agua", name: "Agua de la casa", stock: 6 };
const items = [agua, { id: "pan", name: "Pan dulce", stock: 0 }];
const typed = (unitsText: string, reason: AdjustmentReason = "restock") => ({ ...newAdjustmentDraft("agua", reason), unitsText });
const recordedEntry = { id: "ajuste-1", itemId: "agua", itemName: "Agua de la casa", reason: "restock", units: 4 } as const;

function frozen(draft = typed("4"), key = "llave-1"): StockChangeSnapshot {
  const snapshot = adjustmentSnapshot({ draft, items, key });
  if ("problem" in snapshot) throw new Error(snapshot.problem);
  return snapshot;
}

const recording = (state: StockChangeState = newStockChange(typed("4"))) => {
  if (state.phase !== "editing") throw new Error("only a change being typed is sent");
  const snapshot = frozen(state.draft);
  return { snapshot, state: stockChangeAfter(state, { type: "submitted", snapshot }) };
};

const confirmed = { outcome: "confirmed", answer: { change: { stock: 10 } } } as const;

describe("an Adjustment being typed", () => {
  it("is read as the Item and whole units of one or more", () => {
    expect(readAdjustmentDraft(typed("4"), items)).toEqual({
      item: agua,
      units: 4,
      itemProblem: null,
      unitsProblem: null,
    });
    expect(readAdjustmentDraft(typed(" 7 ", "waste"), items).units).toBe(7);
    expect(readAdjustmentDraft(typed(""), items).unitsProblem).toBe(adjustmentProblems.unitsMissing);
    for (const text of ["0", "1.5", "-2", "dos"]) {
      expect(readAdjustmentDraft(typed(text), items), text).toMatchObject({
        units: null,
        unitsProblem: adjustmentProblems.unitsInvalid,
      });
    }
    expect(readAdjustmentDraft(newAdjustmentDraft(), items).itemProblem).toBe(adjustmentProblems.itemMissing);
    expect(readAdjustmentDraft({ ...typed("1"), itemId: "ya-no" }, items).item).toBeNull();
  });

  it("says its effect before it is sent: Entrada adds, Merma and Consumo interno subtract", () => {
    expect(adjustmentEffect("restock", 4, agua)).toBe("Suma 4: Agua de la casa pasa de 6 a 10 en existencias.");
    expect(adjustmentEffect("waste", 2, agua)).toBe("Resta 2: Agua de la casa pasa de 6 a 4 en existencias.");
    expect(adjustmentEffect("internal_use", 7, agua)).toBe(
      "Resta 7: Agua de la casa pasa de 6 a -1 en existencias. Queda bajo cero.",
    );
  });

  it("is frozen with its key, its Item's name and its note trimmed, or says why it cannot be sent", () => {
    expect(frozen({ ...typed("4"), note: "  Compra semanal " })).toEqual({
      kind: "adjustment",
      key: "llave-1",
      itemId: "agua",
      itemName: "Agua de la casa",
      reason: "restock",
      units: 4,
      note: "Compra semanal",
    });
    expect(frozen()).toMatchObject({ note: null });
    expect(adjustmentSnapshot({ draft: newAdjustmentDraft(), items, key: "k" })).toEqual({
      problem: adjustmentProblems.itemMissing,
    });
    expect(adjustmentSnapshot({ draft: typed("0"), items, key: "k" })).toEqual({
      problem: adjustmentProblems.unitsInvalid,
    });
  });

  it("keeps what is typed when refused, and typing answers the refusal", () => {
    const { snapshot, state } = recording();
    const refused = stockChangeAfter(state, {
      type: "answered",
      key: snapshot.key,
      outcome: { outcome: "refused", answer: { error: "Este producto no lleva inventario." } },
    });
    expect(refused).toEqual({
      phase: "editing",
      draft: typed("4"),
      why: "",
      refusal: "Este producto no lleva inventario.",
    });
    expect(stockChangeAfter(refused, { type: "typed", draft: typed("5") })).toMatchObject({
      draft: typed("5"),
      refusal: null,
    });
  });

  it("starts over when another step is opened", () => {
    const state = stockChangeAfter(newStockChange(typed("4")), { type: "reasoned", why: "Se contó mal" });
    expect(stockChangeAfter(state, { type: "opened", draft: newAdjustmentDraft("pan", "waste") })).toEqual(
      newStockChange(newAdjustmentDraft("pan", "waste")),
    );
  });
});

describe("a cancellation", () => {
  it("needs its reason, and is frozen with the Adjustment as it was recorded", () => {
    expect(cancellationSnapshot({ adjustment: recordedEntry, why: "   ", key: "k" })).toEqual({
      problem: adjustmentProblems.whyMissing,
    });
    expect(cancellationSnapshot({ adjustment: recordedEntry, why: " Se contó dos veces ", key: "k" })).toEqual({
      kind: "cancellation",
      key: "k",
      adjustmentId: "ajuste-1",
      itemName: "Agua de la casa",
      reason: "restock",
      units: 4,
      why: "Se contó dos veces",
    });
  });

  it("says that it reverses what the Adjustment did", () => {
    expect(cancellationEffect(recordedEntry, agua)).toBe("Resta 4: Agua de la casa pasa de 6 a 2 en existencias.");
    expect(cancellationEffect({ ...recordedEntry, reason: "waste" }, agua)).toBe(
      "Suma 4: Agua de la casa pasa de 6 a 10 en existencias.",
    );
    // An Item that no longer counts its units has no Stock on screen.
    expect(cancellationEffect(recordedEntry, null)).toBe("Resta 4 a las existencias de Agua de la casa.");
  });
});

describe("a change that was sent", () => {
  it("is frozen: nothing typed or tapped changes it until it is answered", () => {
    const { state } = recording();
    expect(state).toMatchObject({ phase: "recording", attempt: 1 });
    expect(stockChangeAfter(state, { type: "typed", draft: typed("9") })).toBe(state);
    expect(stockChangeAfter(state, { type: "reasoned", why: "otro" })).toBe(state);
    expect(stockChangeAfter(state, { type: "opened", draft: newAdjustmentDraft() })).toBe(state);
    expect(stockChangeAfter(state, { type: "submitted", snapshot: frozen(typed("9"), "otra") })).toBe(state);
    expect(stockChangeAfter(state, { type: "started", draft: newAdjustmentDraft() })).toBe(state);
    expect(stockChangeAfter(state, { type: "retried" })).toBe(state);
  });

  it("is confirmed only by its own answer, and keeps the Stock the server said", () => {
    const { snapshot, state } = recording();
    expect(stockChangeAfter(state, { type: "answered", key: "otra", outcome: confirmed })).toBe(state);
    expect(stockChangeAfter(state, { type: "answered", key: snapshot.key, outcome: confirmed })).toEqual({
      phase: "confirmed",
      snapshot,
      result: { stock: 10 },
    });
  });

  it("starts another only after it was confirmed, and not because another step was opened", () => {
    const { snapshot, state } = recording();
    const done = stockChangeAfter(state, { type: "answered", key: snapshot.key, outcome: confirmed });
    expect(stockChangeAfter(done, { type: "opened", draft: newAdjustmentDraft() })).toBe(done);
    expect(stockChangeAfter(done, { type: "started", draft: newAdjustmentDraft("", "waste") })).toEqual(
      newStockChange(newAdjustmentDraft("", "waste")),
    );
  });
});

describe("a change nobody answered", () => {
  const unanswered = () => {
    const { snapshot, state } = recording();
    return {
      snapshot,
      state: stockChangeAfter(state, { type: "answered", key: snapshot.key, outcome: { outcome: "unknown" } }),
    };
  };

  it("is unknown, never refused, and only the same snapshot can be sent again", () => {
    const { snapshot, state } = unanswered();
    expect(state).toMatchObject({ phase: "unknown", snapshot, sessionEnded: false });
    expect(stockChangeAfter(state, { type: "typed", draft: typed("9") })).toBe(state);
    expect(stockChangeAfter(state, { type: "started", draft: newAdjustmentDraft() })).toBe(state);

    const again = stockChangeAfter(state, { type: "retried" });
    expect(again).toMatchObject({ phase: "recording", attempt: 2 });
    expect(again.phase === "recording" && again.snapshot).toBe(snapshot);
  });

  it("stays unknown when a retry finds the session ended, and is refused when the first attempt does", () => {
    const ended = { outcome: "refused", answer: { error: "Tu sesión terminó.", sessionEnded: true } } as const;
    const { snapshot, state } = unanswered();
    const again = stockChangeAfter(state, { type: "retried" });
    expect(stockChangeAfter(again, { type: "answered", key: snapshot.key, outcome: ended })).toMatchObject({
      phase: "unknown",
      snapshot,
      sessionEnded: true,
    });

    const first = recording();
    expect(stockChangeAfter(first.state, { type: "answered", key: first.snapshot.key, outcome: ended })).toMatchObject({
      phase: "editing",
      refusal: "Tu sesión terminó.",
    });
  });
});

describe("how a change is sent and said", () => {
  it("carries the same fields in the same order every time", () => {
    const body = stockChangeBody(frozen({ ...typed("4"), note: "Compra" }));
    expect([...body]).toEqual([
      ["intent", "registrar"],
      ["itemId", "agua"],
      ["reason", "restock"],
      ["units", "4"],
      ["note", "Compra"],
      ["submissionKey", "llave-1"],
    ]);
    const cancellation = cancellationSnapshot({ adjustment: recordedEntry, why: "Se contó dos veces", key: "k" });
    if ("problem" in cancellation) throw new Error(cancellation.problem);
    expect([...stockChangeBody(cancellation)]).toEqual([
      ["intent", "cancelar"],
      ["adjustmentId", "ajuste-1"],
      ["reason", "Se contó dos veces"],
    ]);
  });

  it("is confirmed only by an answer that carries the Stock", () => {
    expect(isStockChangeAnswer({ change: { stock: 0 } })).toBe(true);
    expect(isStockChangeAnswer({ change: null })).toBe(false);
    expect(isStockChangeAnswer({ notice: "Listo" })).toBe(false);
  });

  it("says what is on its way and what the server confirmed", () => {
    expect(stockChangeRecordingText(frozen(typed("2", "waste")))).toBe("Registrando merma de 2…");
    expect(stockChangeOutcome(frozen(), { stock: 10 })).toEqual({
      title: "Entrada registrada",
      details: "+4 de Agua de la casa. Existencias: 10.",
    });
    expect(stockChangeOutcome(frozen(typed("1", "internal_use")), { stock: 5 }).title).toBe("Consumo interno registrado");

    const cancellation = cancellationSnapshot({ adjustment: recordedEntry, why: "Error", key: "k" });
    if ("problem" in cancellation) throw new Error(cancellation.problem);
    expect(stockChangeRecordingText(cancellation)).toBe("Cancelando ajuste…");
    expect(stockChangeOutcome(cancellation, { stock: 2 })).toEqual({
      title: "Ajuste cancelado",
      details: "Ya no cuenta: Entrada +4 de Agua de la casa. Existencias: 2.",
    });
  });
});

describe("the address of a step", () => {
  const step = (search: string) => stockStepOf(new URLSearchParams(search));

  it("names the step, with the Item and the reason a link carried", () => {
    expect(step("")).toEqual({ name: "stock" });
    expect(step(adjustHref().split("?")[1]!)).toEqual({ name: "adjust", itemId: "", reason: "restock" });
    expect(step(adjustHref({ itemId: "agua", reason: "waste" }).split("?")[1]!)).toEqual({
      name: "adjust",
      itemId: "agua",
      reason: "waste",
    });
    expect(step("paso=ajustar&motivo=regalo")).toMatchObject({ reason: "restock" });
    expect(step("paso=ajustes")).toEqual({ name: "adjustments" });
    expect(step(cancelHref("ajuste-1").split("?")[1]!)).toEqual({ name: "cancel", adjustmentId: "ajuste-1" });
    expect(step("paso=cancelar")).toEqual({ name: "adjustments" });
    expect(step("paso=otra-cosa")).toEqual({ name: "stock" });
  });
});
