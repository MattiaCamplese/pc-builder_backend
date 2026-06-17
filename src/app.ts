import { Hono } from 'hono'
import { cors } from 'hono/cors'
import authRoute from './routes/auth.routes.js'
import userRoute from './routes/user.route.js'
import componentsRoute from './routes/components.route.js'
import buildsRoute from './routes/builds.route.js'

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

export default app
