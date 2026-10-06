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
    route("clientes", "routes/customers.tsx"),
    route("clientes/:customerId", "routes/customer.tsx"),  ]),
] satisfies RouteConfig;
