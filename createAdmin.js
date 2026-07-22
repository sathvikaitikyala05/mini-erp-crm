require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

async function createAdmin() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    });

    const name = 'Admin User';
    const email = 'admin@erp.com';
    const plainPassword = 'admin123';
    const role = 'admin';

    const hashedPassword = await bcrypt.hash(plainPassword, 10);

    try {
        await connection.query(
            'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
            [name, email, hashedPassword, role]
        );
        console.log('✅ Admin user created!');
        console.log('Login with email:', email, '| password:', plainPassword);
    } catch (err) {
        console.error('❌ Error:', err.message);
    } finally {
        await connection.end();
    }
}

createAdmin();