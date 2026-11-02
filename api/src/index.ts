import { Hono } from 'hono'
import { HttpError } from './errors'
import { homesRoute } from './routes/homes'

const app = new Hono<{ Bindings: Env }>()

// Global error handler ensuring all failures return standard JSON
app.onError((err, c) => {
  if (err instanceof HttpError) {
    return c.json({ error: err.message }, err.status)
  }
  console.error('Unhandled server error:', err)
  return c.json({ error: 'Internal server error' }, 500)
})

// Catch-all 404 handler returning standard JSON
app.notFound((c) => c.json({ error: 'Not found' }, 404))

app.get('/api/health', (c) => c.json({ status: 'ok' }))
app.route('/api/homes', homesRoute)

export default app

