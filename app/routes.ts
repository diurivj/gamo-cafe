import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

// Every route is behind the session middleware of app/root.tsx. The only
// paths answered without a session are PUBLIC_PATHS in app/session.server.ts.
export default [
  route("entrar", "routes/sign-in.tsx"),
  route("salir", "routes/resources/sign-out.ts"),
  route("healthz", "routes/resources/healthz.ts"),
  route("clientes/selector", "routes/resources/customer-picker.ts"),
  route("vender/registrar", "routes/resources/record-sale.ts"),
  route("cuentas/:billId/cobrar", "routes/resources/record-payment.ts"),

  // The signed-in shell: screens go inside it.
  layout("routes/shell.tsx", [
    // Where a screen's failure stops, with the shell still around it.
    layout("routes/screen.tsx", [
      route("inicio", "routes/inicio.tsx"),
      // Vender, inside the layout that holds its Items.
      layout("routes/sell-items.tsx", [index("routes/home.tsx")]),
      route("cuentas-abiertas", "routes/open-bills.tsx"),
      route("cuentas", "routes/cuentas.tsx"),
      route("cuentas/:billId", "routes/bill.tsx"),
      route("clientes", "routes/customers.tsx"),
      route("clientes/:customerId", "routes/customer.tsx"),
      route("mi-dia", "routes/mi-dia.tsx"),
      route("dia", "routes/dia.tsx"),
      route("diferencias", "routes/diferencias.tsx"),
      route("historial", "routes/historial.tsx"),
      route("inventario", "routes/inventario.tsx"),
      route("inventario/conteo", "routes/conteo.tsx"),
      route("por-cobrar", "routes/owed.tsx"),
      route("productos", "routes/productos.tsx"),
      route("productos/:itemId", "routes/producto.tsx"),
      route("usuarios", "routes/users.tsx"),
      route("mas", "routes/mas.tsx"),
    ]),
  ]),
] satisfies RouteConfig;
