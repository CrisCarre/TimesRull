const { Client } = require('pg');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

module.exports = async (req, res) => {
  // CORS preflight
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
      const hash = require('crypto').createHash('sha256').update(password).digest('hex');
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

    // INSERT
    if (action === 'insert') {
      const keys = Object.keys(data);
      const vals = Object.values(data);
      const placeholders = keys.map((_, i) => `$${i+1}`);
      const query = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${placeholders.join(',')}) RETURNING *`;
      const result = await client.query(query, vals);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: result.rows[0] }));
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

    // DELETE
    if (action === 'delete') {
      const query = `DELETE FROM ${table} WHERE id=$1`;
      await client.query(query, [data.id]);
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
