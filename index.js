require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

app.post('/auth/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }

    try {
        const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);

        if (rows.length === 0) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const user = rows[0];
        const passwordMatches = await bcrypt.compare(password, user.password);

        if (!passwordMatches) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const token = jwt.sign(
            { id: user.id, role: user.role, name: user.name },
            process.env.JWT_SECRET,
            { expiresIn: '8h' }
        );

        res.json({
            token,
            user: { id: user.id, name: user.name, email: user.email, role: user.role }
        });

    } catch (err) {
        res.status(500).json({ error: 'Server error', details: err.message });
    }
});
// Middleware to verify JWT token
function verifyToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return res.status(401).json({ error: 'No token provided' });

    const token = authHeader.split(' ')[1];
    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) return res.status(401).json({ error: 'Invalid or expired token' });
        req.user = decoded;
        next();
    });
}

// GET all customers (with search + pagination)
app.get('/customers', verifyToken, async (req, res) => {
    const { search = '', page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    try {
        const [rows] = await pool.query(
            `SELECT * FROM customers WHERE name LIKE ? OR mobile LIKE ? OR business_name LIKE ?
             ORDER BY created_at DESC LIMIT ? OFFSET ?`,
            [`%${search}%`, `%${search}%`, `%${search}%`, Number(limit), Number(offset)]
        );
        const [[{ total }]] = await pool.query(
            `SELECT COUNT(*) as total FROM customers WHERE name LIKE ? OR mobile LIKE ? OR business_name LIKE ?`,
            [`%${search}%`, `%${search}%`, `%${search}%`]
        );
        res.json({ data: rows, total, page: Number(page), limit: Number(limit) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET single customer + their notes
app.get('/customers/:id', verifyToken, async (req, res) => {
    try {
        const [customer] = await pool.query('SELECT * FROM customers WHERE id = ?', [req.params.id]);
        if (customer.length === 0) return res.status(404).json({ error: 'Customer not found' });

        const [notes] = await pool.query('SELECT * FROM customer_notes WHERE customer_id = ? ORDER BY created_at DESC', [req.params.id]);
        res.json({ ...customer[0], notes });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST create customer
app.post('/customers', verifyToken, async (req, res) => {
    const { name, mobile, email, business_name, gst_number, customer_type, address, status, follow_up_date } = req.body;
    if (!name || !mobile || !customer_type) {
        return res.status(400).json({ error: 'name, mobile, and customer_type are required' });
    }
    try {
        const [result] = await pool.query(
            `INSERT INTO customers (name, mobile, email, business_name, gst_number, customer_type, address, status, follow_up_date, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [name, mobile, email || null, business_name || null, gst_number || null, customer_type, address || null, status || 'lead', follow_up_date || null, req.user.id]
        );
        res.status(201).json({ id: result.insertId, message: 'Customer created' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT update customer
app.put('/customers/:id', verifyToken, async (req, res) => {
    const { name, mobile, email, business_name, gst_number, customer_type, address, status, follow_up_date } = req.body;
    try {
        const [result] = await pool.query(
            `UPDATE customers SET name=?, mobile=?, email=?, business_name=?, gst_number=?, customer_type=?, address=?, status=?, follow_up_date=? WHERE id=?`,
            [name, mobile, email, business_name, gst_number, customer_type, address, status, follow_up_date, req.params.id]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Customer not found' });
        res.json({ message: 'Customer updated' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST add follow-up note
app.post('/customers/:id/notes', verifyToken, async (req, res) => {
    const { note } = req.body;
    if (!note) return res.status(400).json({ error: 'note is required' });
    try {
        await pool.query(
            'INSERT INTO customer_notes (customer_id, note, created_by) VALUES (?, ?, ?)',
            [req.params.id, note, req.user.id]
        );
        res.status(201).json({ message: 'Note added' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// Role-check middleware factory
function requireRole(...allowedRoles) {
    return (req, res, next) => {
        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Access denied for your role' });
        }
        next();
    };
}

// ---------- PRODUCTS ----------

app.get('/products', verifyToken, async (req, res) => {
    const { search = '', page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;
    try {
        const [rows] = await pool.query(
            `SELECT * FROM products WHERE name LIKE ? OR sku LIKE ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
            [`%${search}%`, `%${search}%`, Number(limit), Number(offset)]
        );
        const [[{ total }]] = await pool.query(
            `SELECT COUNT(*) as total FROM products WHERE name LIKE ? OR sku LIKE ?`,
            [`%${search}%`, `%${search}%`]
        );
        res.json({ data: rows, total, page: Number(page), limit: Number(limit) });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/products', verifyToken, requireRole('admin', 'warehouse'), async (req, res) => {
    const { name, sku, category, unit_price, current_stock, min_stock_alert, location } = req.body;
    if (!name || !sku || !unit_price) {
        return res.status(400).json({ error: 'name, sku, and unit_price are required' });
    }
    try {
        const [result] = await pool.query(
            `INSERT INTO products (name, sku, category, unit_price, current_stock, min_stock_alert, location)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [name, sku, category || null, unit_price, current_stock || 0, min_stock_alert || 0, location || null]
        );
        res.status(201).json({ id: result.insertId, message: 'Product created' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/products/:id', verifyToken, requireRole('admin', 'warehouse'), async (req, res) => {
    const { name, sku, category, unit_price, min_stock_alert, location } = req.body;
    try {
        const [result] = await pool.query(
            `UPDATE products SET name=?, sku=?, category=?, unit_price=?, min_stock_alert=?, location=? WHERE id=?`,
            [name, sku, category, unit_price, min_stock_alert, location, req.params.id]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Product not found' });
        res.json({ message: 'Product updated' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Manual stock adjustment (IN/OUT) with movement log
app.post('/products/:id/stock', verifyToken, requireRole('admin', 'warehouse'), async (req, res) => {
    const { quantity_changed, movement_type, reason } = req.body;
    if (!quantity_changed || !['IN', 'OUT'].includes(movement_type)) {
        return res.status(400).json({ error: 'quantity_changed and valid movement_type (IN/OUT) are required' });
    }
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const [[product]] = await conn.query('SELECT current_stock FROM products WHERE id = ? FOR UPDATE', [req.params.id]);
        if (!product) { await conn.rollback(); return res.status(404).json({ error: 'Product not found' }); }

        const newStock = movement_type === 'IN'
            ? product.current_stock + Number(quantity_changed)
            : product.current_stock - Number(quantity_changed);

        if (newStock < 0) {
            await conn.rollback();
            return res.status(400).json({ error: 'Stock cannot go negative' });
        }

        await conn.query('UPDATE products SET current_stock = ? WHERE id = ?', [newStock, req.params.id]);
        await conn.query(
            'INSERT INTO stock_movements (product_id, quantity_changed, movement_type, reason, created_by) VALUES (?, ?, ?, ?, ?)',
            [req.params.id, quantity_changed, movement_type, reason || null, req.user.id]
        );
        await conn.commit();
        res.json({ message: 'Stock updated', new_stock: newStock });
    } catch (err) {
        await conn.rollback();
        res.status(500).json({ error: err.message });
    } finally {
        conn.release();
    }
});

// ---------- SALES CHALLANS ----------

// Create challan (Draft or Confirmed)
app.post('/challans', verifyToken, requireRole('admin', 'sales'), async (req, res) => {
    const { customer_id, items, status } = req.body; // items = [{product_id, quantity}]
    if (!customer_id || !items || items.length === 0) {
        return res.status(400).json({ error: 'customer_id and at least one item are required' });
    }
    const finalStatus = status === 'confirmed' ? 'confirmed' : 'draft';

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        // Auto-generate challan number
        const [[{ count }]] = await conn.query('SELECT COUNT(*) as count FROM challans');
        const challanNumber = `CH-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`;

        let totalQuantity = 0;
        const snapshotItems = [];

        // Validate stock and build snapshots BEFORE inserting anything
        for (const item of items) {
            const [[product]] = await conn.query('SELECT * FROM products WHERE id = ? FOR UPDATE', [item.product_id]);
            if (!product) { await conn.rollback(); return res.status(404).json({ error: `Product ${item.product_id} not found` }); }

            if (finalStatus === 'confirmed' && product.current_stock < item.quantity) {
                await conn.rollback();
                return res.status(400).json({ error: `Insufficient stock for ${product.name}. Available: ${product.current_stock}` });
            }
            totalQuantity += Number(item.quantity);
            snapshotItems.push({
                product_id: product.id,
                product_name_snapshot: product.name,
                price_snapshot: product.unit_price,
                quantity: item.quantity
            });
        }

        const [challanResult] = await conn.query(
            `INSERT INTO challans (challan_number, customer_id, total_quantity, status, created_by) VALUES (?, ?, ?, ?, ?)`,
            [challanNumber, customer_id, totalQuantity, finalStatus, req.user.id]
        );
        const challanId = challanResult.insertId;

        for (const item of snapshotItems) {
            await conn.query(
                `INSERT INTO challan_items (challan_id, product_id, product_name_snapshot, price_snapshot, quantity) VALUES (?, ?, ?, ?, ?)`,
                [challanId, item.product_id, item.product_name_snapshot, item.price_snapshot, item.quantity]
            );

            // If confirmed, reduce stock + log movement
            if (finalStatus === 'confirmed') {
                await conn.query('UPDATE products SET current_stock = current_stock - ? WHERE id = ?', [item.quantity, item.product_id]);
                await conn.query(
                    'INSERT INTO stock_movements (product_id, quantity_changed, movement_type, reason, created_by) VALUES (?, ?, ?, ?, ?)',
                    [item.product_id, item.quantity, 'OUT', `Challan ${challanNumber}`, req.user.id]
                );
            }
        }

        await conn.commit();
        res.status(201).json({ id: challanId, challan_number: challanNumber, status: finalStatus, message: 'Challan created' });

    } catch (err) {
        await conn.rollback();
        res.status(500).json({ error: err.message });
    } finally {
        conn.release();
    }
});

// Get all challans
app.get('/challans', verifyToken, async (req, res) => {
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;
    try {
        const [rows] = await pool.query(
            `SELECT c.*, cu.name as customer_name FROM challans c JOIN customers cu ON c.customer_id = cu.id
             ORDER BY c.created_at DESC LIMIT ? OFFSET ?`,
            [Number(limit), Number(offset)]
        );
        res.json({ data: rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get one challan with items
app.get('/challans/:id', verifyToken, async (req, res) => {
    try {
        const [[challan]] = await pool.query(
            `SELECT c.*, cu.name as customer_name FROM challans c JOIN customers cu ON c.customer_id = cu.id WHERE c.id = ?`,
            [req.params.id]
        );
        if (!challan) return res.status(404).json({ error: 'Challan not found' });
        const [items] = await pool.query('SELECT * FROM challan_items WHERE challan_id = ?', [req.params.id]);
        res.json({ ...challan, items });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Confirm a draft challan (reduces stock at this point)
app.put('/challans/:id/confirm', verifyToken, requireRole('admin', 'sales'), async (req, res) => {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const [[challan]] = await conn.query('SELECT * FROM challans WHERE id = ? FOR UPDATE', [req.params.id]);
        if (!challan) { await conn.rollback(); return res.status(404).json({ error: 'Challan not found' }); }
        if (challan.status !== 'draft') { await conn.rollback(); return res.status(400).json({ error: 'Only draft challans can be confirmed' }); }

        const [items] = await conn.query('SELECT * FROM challan_items WHERE challan_id = ?', [req.params.id]);

        for (const item of items) {
            const [[product]] = await conn.query('SELECT current_stock FROM products WHERE id = ? FOR UPDATE', [item.product_id]);
            if (product.current_stock < item.quantity) {
                await conn.rollback();
                return res.status(400).json({ error: `Insufficient stock for ${item.product_name_snapshot}` });
            }
        }

        for (const item of items) {
            await conn.query('UPDATE products SET current_stock = current_stock - ? WHERE id = ?', [item.quantity, item.product_id]);
            await conn.query(
                'INSERT INTO stock_movements (product_id, quantity_changed, movement_type, reason, created_by) VALUES (?, ?, ?, ?, ?)',
                [item.product_id, item.quantity, 'OUT', `Challan ${challan.challan_number}`, req.user.id]
            );
        }

        await conn.query('UPDATE challans SET status = ? WHERE id = ?', ['confirmed', req.params.id]);
        await conn.commit();
        res.json({ message: 'Challan confirmed, stock updated' });
    } catch (err) {
        await conn.rollback();
        res.status(500).json({ error: err.message });
    } finally {
        conn.release();
    }
});
app.get('/', (req, res) => {
    res.json({ message: 'Mini ERP + CRM API is running' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});