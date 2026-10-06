# Gamo Cafe

Sales and stock tracking for a single cafeteria, used only by its staff: what was sold, who recorded it, what is owed, and whether the shelf matches the records. Staff see the app in Spanish, so each term notes the word shown on screen.

## Language

### People

**User**:
A member of staff who signs in to the app. Every User is either an Admin or a Worker.
_Avoid_: Account, employee
_On screen_: Usuario

**Admin**:
A User who, besides everything a Worker does, manages Items and Stock and sees what every User recorded.
_On screen_: Administrador

**Worker**:
A User limited to recording Bills, taking Payments and adding Customers.
_Avoid_: Employee, cashier
_On screen_: Empleado

**Customer**:
Whoever settles Bills, a person or a family, saved by name so that their Bills can be found again and what they owe added up. A Customer never uses the app.
_Avoid_: Client, buyer, account
_On screen_: Cliente

### Selling

**Item**:
A thing the cafeteria sells, with one price. An Item is either stock-tracked (sold as-is, its units counted) or not (prepared to order).
_Avoid_: Product, article
_On screen_: Producto

**Category**:
A named group of Items, such as Bebidas or Snacks, used to arrange them for selling.
_On screen_: Categoría

**Bill**:
What one Customer consumed in one day, or one buyer with no Customer on one occasion, and what is owed for it: its Lines, their total, and the Payments received against it. A Bill has no owner: each Line and each Payment carries its own author.
_Avoid_: Account, tab, order, ticket, check
_On screen_: Cuenta

**Line**:
One Item and a quantity, added to a Bill by one User at one moment.
_Avoid_: Sale, order line

**Payment**:
An amount of money received toward one Bill by one User at one moment, in cash or by transfer, never more than the Bill still owes. Money handed over for several Bills becomes one Payment per Bill, oldest Bill first.
_Avoid_: Transaction, charge
_On screen_: Pago, or Abono when it leaves the Bill Partially paid. Cash is Efectivo and transfer is Transferencia.

**Open**:
The state of a Bill that has not been fully paid. More Lines can still be added to it.
_On screen_: Abierta

**Partially paid**:
An Open Bill whose Payments add up to more than nothing and less than its total.
_On screen_: Pago parcial

**Paid**:
The state of a Bill whose Payments add up to its total.
_On screen_: Pagada

**Voided**:
The state of a Bill cancelled by an Admin, with a reason. A Voided Bill stays on record but counts toward nothing.
_Avoid_: Deleted
_On screen_: Cancelada

### Reporting

**Day**:
The cafeteria's local calendar day on which a Line, a Payment or any other record was made.
_On screen_: Día

**History**:
The list of every correction and Adjustment, with who made it, when and why: removed Lines, removed Payments, Voided Bills, changes to a Bill's Customer or note, and cancelled Adjustments.
_Avoid_: Audit log, activity
_On screen_: Historial

**Sold**:
The value of the Lines added on a given day, whether or not they have been paid for.
_On screen_: Vendido

**Collected**:
The money received in Payments on a given day, split into cash and transfer.
_On screen_: Cobrado

**Owed**:
The unpaid remainder of Open Bills, for one Customer or for the whole cafeteria.
_On screen_: Por cobrar

### Stock

**Stock**:
The number of units of a stock-tracked Item that the records say are on hand. A unit leaves Stock when it is added to a Bill, paid for or not.
_Avoid_: Inventory
_On screen_: Existencias, on a screen titled Inventario

**Minimum**:
The Stock level, set per Item by an Admin, at or below which the Item is flagged for restocking.
_On screen_: Mínimo

**Adjustment**:
A change to an Item's Stock made by an Admin outside of selling, for one of three reasons: Restock, Waste, or Internal use.
_On screen_: Ajuste

**Restock**:
An Adjustment that adds units bought or delivered.
_On screen_: Entrada

**Waste**:
An Adjustment that removes units that expired, broke or were otherwise lost.
_On screen_: Merma

**Internal use**:
An Adjustment that removes units consumed by staff or given away.
_On screen_: Consumo interno

**Count**:
A physical tally by an Admin of the units of an Item actually on the shelf. After a Count, Stock takes the counted value.
_Avoid_: Inventory, audit
_On screen_: Conteo

**Discrepancy**:
The difference between a Count and the Stock it replaced: units that are unaccounted for, or that appeared.
_On screen_: Diferencia, shown as Faltante when units are missing and Sobrante when there are extra
