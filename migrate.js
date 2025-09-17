import 'dotenv/config';
import { Client } from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database configuration
const config = {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: String(process.env.DB_PASSWORD || ''),
};

async function runMigrations() {
    const client = new Client(config);
    
    try {
        await client.connect();
        console.log('✅ Connected to database');

        // Read and execute migration files in order
        const migrations = [
            'payment_service_schema.sql',
            'sample_data_fixed.sql'
        ];

        for (const migration of migrations) {
            const filePath = path.join(__dirname, 'db', 'migrations', migration);
            
            if (!fs.existsSync(filePath)) {
                console.log(`⚠️  Migration file not found: ${migration}`);
                continue;
            }

            const sql = fs.readFileSync(filePath, 'utf8');
            
            await client.query(sql);
        }

        console.log('🎉 All migrations completed successfully!');

    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        process.exit(1);
    } finally {
        await client.end();
        console.log('🔌 Database connection closed');
    }
}

// Run migrations
runMigrations();
