import { defineConfig } from 'drizzle-kit'
// import dotenv from 'dotenv'
// dotenv.config()

const url = process.env.DATABASE_URL
if (!url) {
	throw new Error('DATABASE_URL env var not defined')
}

export default defineConfig({
	out: './src/migrations',
	schema: './src/schema.ts',
	dialect: 'postgresql',
	dbCredentials: { url },
	casing: 'snake_case',
	migrations: {
		// use separate schema/table for tracking of migration progress in this package to avoid
		// having migration conflicts between db and freeradius-db packages.
		table: '__drizzle_migrations_app',
		schema: 'drizzle_app_db'
	}
})
