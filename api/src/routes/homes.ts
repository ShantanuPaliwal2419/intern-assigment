import { Hono } from 'hono'
import { HttpError } from '../errors'
import { splitCents } from '../split'
import {
  readJsonBody,
  requireNonEmptyString,
  validateTotalCents,
} from '../validation'

export const homesRoute = new Hono<{ Bindings: Env }>()

homesRoute.post('/', async (c) => {
  const body = await readJsonBody<{ name?: unknown }>(c)
  const name = requireNonEmptyString(body.name, 'Home name')
  const id = crypto.randomUUID()
  const createdAt = new Date().toISOString()

  await c.env.DB.prepare(
    'INSERT INTO homes (id, name, created_at) VALUES (?, ?, ?)',
  )
    .bind(id, name, createdAt)
    .run()

  return c.json({ id, name }, 201)
})

homesRoute.post('/:homeId/members', async (c) => {
  const homeId = c.req.param('homeId')
  const body = await readJsonBody<{ name?: unknown }>(c)
  const name = requireNonEmptyString(body.name, 'Member name')

  // Verify home existence
  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<{ id: string }>()

  if (!home) {
    throw new HttpError(404, 'Home not found')
  }

  // Calculate next sequential insertion rank for this home
  const seqResult = await c.env.DB.prepare(
    'SELECT COALESCE(MAX(seq), 0) + 1 AS nextSeq FROM members WHERE home_id = ?',
  )
    .bind(homeId)
    .first<{ nextSeq: number }>()

  const seq = seqResult?.nextSeq ?? 1
  const id = crypto.randomUUID()
  const createdAt = new Date().toISOString()

  await c.env.DB.prepare(
    'INSERT INTO members (id, home_id, name, seq, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(id, homeId, name, seq, createdAt)
    .run()

  return c.json({ id, homeId, name }, 201)
})

homesRoute.post('/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')
  const body = await readJsonBody<{
    title?: unknown
    totalCents?: unknown
  }>(c)

  // Validate totalCents: positive integer
  const totalCents = validateTotalCents(body.totalCents)
  const title = requireNonEmptyString(body.title, 'Bill title')

  // Verify home existence
  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<{ id: string }>()

  if (!home) {
    throw new HttpError(404, 'Home not found')
  }

  // Load members ordered by their insertion rank
  const { results: members } = await c.env.DB.prepare(
    'SELECT id, name, seq FROM members WHERE home_id = ? ORDER BY seq ASC',
  )
    .bind(homeId)
    .all<{ id: string; name: string; seq: number }>()

  if (!members || members.length === 0) {
    throw new HttpError(422, 'Cannot create bill for home with no members')
  }

  // Calculate split amounts using the pure algorithm
  const calculatedShares = splitCents(totalCents, members)

  const billId = crypto.randomUUID()
  const createdAt = new Date().toISOString()

  const insertBillStmt = c.env.DB.prepare(
    'INSERT INTO bills (id, home_id, title, total_cents, created_at) VALUES (?, ?, ?, ?, ?)',
  ).bind(billId, homeId, title, totalCents, createdAt)

  interface ShareResponse {
    id: string
    memberId: string
    amountCents: number
    paidAt: string | null
  }

  const responseShares: ShareResponse[] = []
  const insertShareStmts = calculatedShares.map((share) => {
    const shareId = crypto.randomUUID()
    responseShares.push({
      id: shareId,
      memberId: share.memberId,
      amountCents: share.amountCents,
      paidAt: null,
    })

    return c.env.DB.prepare(
      'INSERT INTO shares (id, bill_id, member_id, amount_cents, paid_at, idempotency_key, created_at) VALUES (?, ?, ?, ?, NULL, NULL, ?)',
    ).bind(shareId, billId, share.memberId, share.amountCents, createdAt)
  })

  // Atomically write the bill and all shares in a single transaction
  await c.env.DB.batch([insertBillStmt, ...insertShareStmts])

  return c.json(
    {
      id: billId,
      homeId,
      title,
      totalCents,
      shares: responseShares,
    },
    201,
  )
})
