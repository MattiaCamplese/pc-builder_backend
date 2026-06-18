import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { HTTPException } from 'hono/http-exception'
import authRoute from './routes/auth.routes.js'
import userRoute from './routes/user.route.js'
import componentsRoute from './routes/components.route.js'
import buildsRoute from './routes/builds.route.js'
import statsRoute from './routes/stats.route.js'

const app = new Hono()

app.use('/api/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

app.route('/api', authRoute)
app.route('/api', userRoute)
app.route('/api', componentsRoute)
app.route('/api', buildsRoute)
app.route('/api', statsRoute)

// HTTPException defaults to a plain-text body — the frontend always expects
// JSON, so without this every thrown error (wrong password, etc.) silently
// degrades to a generic "HTTP <status>" instead of the real message.
app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ message: err.message, cause: err.cause }, err.status)
  }
  console.error(err)
  return c.json({ message: 'Errore del server' }, 500)
})

export default app
