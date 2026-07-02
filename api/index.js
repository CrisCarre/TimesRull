const { Client } = require('pg');
const crypto = require('crypto');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, corsHeaders);
    res.end();
    return;
  }
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));

  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();
    const { action, table, data, where } = req.body || {};

    // LOGIN
    if (action === 'login') {
      const { email, password } = data;
      const hash = crypto.createHash('sha256').update(password).digest('hex');
      const result = await client.query(
        'SELECT id, email, rol, empleado_id FROM usuarios WHERE email=$1 AND password_hash=$2 AND activo=true',
        [email, hash]
      );
      if (result.rows.length === 0) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Email o contraseña incorrectos' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ user: result.rows[0] }));
      return;
    }

    // SELECT
    if (action === 'select') {
      let query = `SELECT * FROM ${table}`;
      const values = [];
      if (where) {
        const conditions = Object.entries(where).map(([k, v], i) => `${k}=$${i+1}`);
        query += ' WHERE ' + conditions.join(' AND ');
        Object.values(where).forEach(v => values.push(v));
      }
      const result = await client.query(query, values);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: result.rows }));
      return;
    }

    // INSERT (simple o múltiple)
    if (action === 'insert') {
      const rows = Array.isArray(data) ? data : [data];
      const results = [];
      for (const row of rows) {
        const keys = Object.keys(row);
        const vals = Object.values(row);
        const placeholders = keys.map((_, i) => `$${i+1}`);
        const query = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${placeholders.join(',')}) RETURNING *`;
        const result = await client.query(query, vals);
        results.push(result.rows[0]);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: results.length === 1 ? results[0] : results }));
      return;
    }

    // UPDATE
    if (action === 'update') {
      const { id, ...fields } = data;
      const keys = Object.keys(fields);
      const vals = Object.values(fields);
      const sets = keys.map((k, i) => `${k}=$${i+1}`);
      vals.push(id);
      const query = `UPDATE ${table} SET ${sets.join(',')} WHERE id=$${vals.length} RETURNING *`;
      const result = await client.query(query, vals);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: result.rows[0] }));
      return;
    }

    // DELETE — por id o por where arbitrario
    if (action === 'delete') {
      let query, values;
      if (where) {
        const conditions = Object.entries(where).map(([k, v], i) => `${k}=$${i+1}`);
        query = `DELETE FROM ${table} WHERE ${conditions.join(' AND ')}`;
        values = Object.values(where);
      } else if (data && data.id) {
        query = `DELETE FROM ${table} WHERE id=$1`;
        values = [data.id];
      } else {
        throw new Error('delete requiere id o where');
      }
      await client.query(query, values);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
      return;
    }

    // UPSERT (config)
    if (action === 'upsert') {
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        const { clave, valor, comentario } = item;
        await client.query(
          `INSERT INTO config (clave, valor, comentario) VALUES ($1, $2, $3) ON CONFLICT (clave) DO UPDATE SET valor=$2, comentario=$3`,
          [clave, valor, comentario || null]
        );
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
      return;
    }

    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Acción no reconocida' }));

  } catch (e) {
    console.error(e);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  } finally {
    await client.end();
  }
};
