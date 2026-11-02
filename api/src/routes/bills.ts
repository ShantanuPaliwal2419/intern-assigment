import { Hono } from 'hono'
import { HttpError } from '../errors'
import { requireHeader } from '../validation'

interface ShareRow {
  id: string
  bill_id: string
  member_id: string
  amount_cents: number
  paid_at: string | null
  idempotency_key: string | null
}

export const billsRoute = new Hono<{ Bindings: Env }>()

billsRoute.post('/:billId/shares/:shareId/pay', async (c) => {
  // Validate presence of Idempotency-Key header (returns 400 if missing)
  const key = requireHeader(c, 'Idempotency-Key')
  const billId = c.req.param('billId')
  const shareId = c.req.param('shareId')

  // Verify share exists and belongs to the specified bill
  const share = await c.env.DB.prepare(
    'SELECT id, bill_id, member_id, amount_cents, paid_at, idempotency_key FROM shares WHERE id = ? AND bill_id = ?',
  )
    .bind(shareId, billId)
    .first<ShareRow>()

  if (!share) {
    throw new HttpError(404, 'Share not found')
  }

  // Handle share already paid
  if (share.paid_at !== null) {
    if (share.idempotency_key === key) {
      // Idempotent replay: return identical payload with original paidAt
      return c.json(
        {
          id: share.id,
          memberId: share.member_id,
          amountCents: share.amount_cents,
          paidAt: share.paid_at,
        },
        200,
      )
    }
    // Conflict: already paid with a different idempotency key
    throw new HttpError(409, 'Share has already been paid')
  }

  // Atomic conditional update: only succeeds if paid_at is still NULL
  const now = new Date().toISOString()
  const updateResult = await c.env.DB.prepare(
    'UPDATE shares SET paid_at = ?, idempotency_key = ? WHERE id = ? AND bill_id = ? AND paid_at IS NULL',
  )
    .bind(now, key, shareId, billId)
    .run()

  if (updateResult.meta.changes === 1) {
    return c.json(
      {
        id: share.id,
        memberId: share.member_id,
        amountCents: share.amount_cents,
        paidAt: now,
      },
      200,
    )
  }

  // If updateResult.meta.changes === 0, a concurrent request completed first
  const updatedShare = await c.env.DB.prepare(
    'SELECT id, bill_id, member_id, amount_cents, paid_at, idempotency_key FROM shares WHERE id = ? AND bill_id = ?',
  )
    .bind(shareId, billId)
    .first<ShareRow>()

  if (updatedShare && updatedShare.paid_at !== null) {
    if (updatedShare.idempotency_key === key) {
      return c.json(
        {
          id: updatedShare.id,
          memberId: updatedShare.member_id,
          amountCents: updatedShare.amount_cents,
          paidAt: updatedShare.paid_at,
        },
        200,
      )
    }
    throw new HttpError(409, 'Share has already been paid')
  }

  throw new HttpError(404, 'Share not found')
})
