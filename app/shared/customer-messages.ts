/**
 * What the screen says when a Customer's name is refused. Every route that
 * adds or renames a Customer answers with these.
 */
export const customerNameMessages = {
  CustomerNameRequired: "Escribe el nombre del cliente.",
  CustomerNameTaken: "Ya hay un cliente con ese nombre.",
} as const;
