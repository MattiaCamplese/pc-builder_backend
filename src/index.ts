import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import authRoute from './routes/auth.routes.js'

const app = new Hono()

app.route('/api', authRoute)

serve({
  fetch: app.fetch,
  port: 3000
}, (info) => {
  console.log(`Server is running on http://localhost:${info.port}`)
})
