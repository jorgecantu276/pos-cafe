import { readFileSync } from 'node:fs';
import path from 'node:path';
import { validReceiptIssuer, type ReceiptIssuer } from './sale-printing';

// Issuer identity is local business configuration, not browser/customer input.
export function readReceiptIssuer(env: Record<string, string | undefined> = process.env): ReceiptIssuer | undefined {
  if (!env.POS_RECEIPT_ISSUER_FILE) return undefined;
  if (!path.isAbsolute(env.POS_RECEIPT_ISSUER_FILE)) throw new Error('Usa una ruta absoluta para los datos fiscales del emisor.');
  // Windows PowerShell 5.1 and some editors emit a UTF-8 byte-order mark.
  const value: unknown = JSON.parse(readFileSync(env.POS_RECEIPT_ISSUER_FILE, 'utf8').replace(/^\uFEFF/, ''));
  if (!value || typeof value !== 'object') throw new Error('Datos fiscales del emisor inválidos.');
  const fields = ['legalName', 'rfc', 'taxRegime', 'establishmentAddress', 'postalCode', 'city'];
  if (!fields.every(key => key in value && typeof (value as Record<string, unknown>)[key] === 'string' && String((value as Record<string, unknown>)[key]).trim().length > 0))
    throw new Error('Completa los datos fiscales del emisor.');
  const issuer = Object.fromEntries(fields.map(key => [key, String((value as Record<string, unknown>)[key]).trim()])) as unknown as ReceiptIssuer;
  issuer.rfc = issuer.rfc.toUpperCase();
  if (!validReceiptIssuer(issuer)) throw new Error('Datos fiscales del emisor incompletos o inválidos.');
  return issuer;
}
