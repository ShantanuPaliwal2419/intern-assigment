import { Hono } from 'hono'
import { HttpError } from '../errors'
import { readJsonBody, requireNonEmptyString } from '../validation'

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
