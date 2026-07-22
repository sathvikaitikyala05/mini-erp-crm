const fs = require('fs');
const mysql = require('mysql2/promise');
require('dotenv').config();

async function runSchema() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        multipleStatements: true
    });

    const schema = fs.readFileSync('./schema.sql', 'utf8');

    try {
        await connection.query(schema);
        console.log('✅ All tables created successfully!');
    } catch (err) {
        console.error('❌ Error creating tables:', err.message);
    } finally {
        await connection.end();
    }
}

runSchema();