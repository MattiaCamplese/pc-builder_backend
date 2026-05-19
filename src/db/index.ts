import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';
import * as relations from './relations.js';

const db = drizzle(process.env.DATABASE_URL!, { schema: { ...schema, ...relations } });

export default db;
