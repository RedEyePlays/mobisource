// Duplicated from functions/src/lib/supplierSkuMapId.ts — same reasoning as
// src/types.ts (the frontend and functions bundles deploy independently).
// Must stay byte-for-byte identical, or the client's auto-resolve lookup
// would compute a different doc ID than the callable actually writes to.
export function supplierSkuMapId(supplier: string, supplierSku: string): string {
  const slug = (value: string) =>
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')

  const supplierSlug = slug(supplier)
  const supplierSkuSlug = slug(supplierSku)
  if (!supplierSlug || !supplierSkuSlug) {
    throw new Error('supplier and supplierSku must both contain at least one alphanumeric character.')
  }
  return `${supplierSlug}__${supplierSkuSlug}`
}
