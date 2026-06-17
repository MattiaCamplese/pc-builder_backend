import { Hono } from 'hono'
import authRoute from './routes/auth.routes.js'
import userRoute from './routes/user.route.js'
import componentsRoute from './routes/components.route.js'
import buildsRoute from './routes/builds.route.js'

const app = new Hono()

app.route('/api', authRoute)
app.route('/api', userRoute)
app.route('/api', componentsRoute)
app.route('/api', buildsRoute)

export default app
