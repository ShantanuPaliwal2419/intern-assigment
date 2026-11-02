import { Hono } from 'hono'
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
