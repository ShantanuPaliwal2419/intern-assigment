import type { Context } from 'hono'
import { HttpError } from './errors'

export async function readJsonBody<T>(c: Context): Promise<T> {
  try {
    return (await c.req.json()) as T
  } catch {
    throw new HttpError(400, 'Invalid JSON body')
  }
}

export function requireNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new HttpError(400, `${fieldName} is required`)
  }
  return value.trim()
}

export function validateTotalCents(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new HttpError(422, 'totalCents must be a positive integer')
  }
  return value
}

export function requireHeader(c: Context, headerName: string): string {
  const value = c.req.header(headerName)
  if (!value || value.trim().length === 0) {
    throw new HttpError(400, `${headerName} header is required`)
  }
  return value.trim()
}
