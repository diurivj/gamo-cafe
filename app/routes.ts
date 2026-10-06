import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("healthz", "routes/resources/healthz.ts"),
] satisfies RouteConfig;
