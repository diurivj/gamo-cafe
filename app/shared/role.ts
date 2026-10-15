/** What the screen calls each role. */
export const roleLabel = { admin: "Administrador", worker: "Empleado" } as const;

/** What each role may do, as Usuarios says it where a role is chosen. */
export const roleMeans = {
  worker: "Vende, cobra, registra el consumo interno y ve su propio día.",
  admin: "Además ve el día de todos, todas las cuentas y el inventario, y administra productos y usuarios.",
} as const;
