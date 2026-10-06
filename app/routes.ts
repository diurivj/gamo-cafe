import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

// Every route is behind the session middleware of app/root.tsx. The only
// paths answered without a session are PUBLIC_PATHS in app/session.server.ts.
export default [
  route("entrar", "routes/sign-in.tsx"),
  route("salir", "routes/resources/sign-out.ts"),
  route("healthz", "routes/resources/healthz.ts"),
  route("clientes/selector", "routes/resources/customer-picker.ts"),

  // The signed-in shell: screens go inside it.
  layout("routes/shell.tsx", [
    index("routes/home.tsx"),
    route("cuentas-abiertas", "routes/open-bills.tsx"),
    route("cuentas/:billId", "routes/bill.tsx"),
    route("clientes", "routes/customers.tsx"),
    route("clientes/:customerId", "routes/customer.tsx"),
    route("diferencias", "routes/diferencias.tsx"),
    route("inventario", "routes/inventario.tsx"),
    route("inventario/conteo", "routes/conteo.tsx"),
    route("por-cobrar", "routes/owed.tsx"),
    route("productos", "routes/productos.tsx"),
    route("productos/:itemId", "routes/producto.tsx"),
    route("usuarios", "routes/users.tsx"),
  ]),
] satisfies RouteConfig;
