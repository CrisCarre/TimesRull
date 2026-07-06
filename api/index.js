const { Client } = require('pg');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_EXPIRY = '12h';

// Tablas a las que se puede acceder por la API genérica.
// "usuarios" NUNCA está aquí: solo se consulta internamente en el login.
const ALLOWED_TABLES = new Set([
  'config', 'empleados', 'outlets', 'outlet_empleados', 'planificacion',
  'festivos', 'disponibilidad', 'plantillas', 'reglas_minimo', 'cambios_turno',
]);

// Un empleado puede LEER estas tablas (con algún filtrado de columnas/filas abajo)
const TABLAS_EMPLEADO_SELECT_OK = new Set([
  'planificacion', 'disponibilidad', 'festivos', 'outlets',
  'outlet_empleados', 'empleados', 'config', 'cambios_turno',
  'plantillas', 'reglas_minimo',
]);
// De estas, el resultado se fuerza SIEMPRE a sus propias filas (empleado_id = el suyo)
const TABLAS_EMPLEADO_SELECT_PROPIO = new Set(['cambios_turno']);

// Un empleado puede ESCRIBIR (insert/update/delete) solo en estas tablas,
// y siempre forzado a su propio empleado_id
const TABLAS_EMPLEADO_ESCRITURA = new Set(['disponibilidad', 'cambios_turno']);

// Claves de "config" que jamás deben llegar a un empleado (costes, KPIs, presupuestos)
function claveConfigSensible(clave) {
  return /^KPI_/i.test(clave) || /^PRESUPUESTO/i.test(clave) || /COSTE/i.test(clave);
}
// Columnas de "empleados" que jamás deben llegar a un empleado
const EMPLEADOS_COLUMNAS_OCULTAS = ['coste_hora'];

const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
function validarIdentificadores(obj) {
  for (const k of Object.keys(obj || {})) {
    if (!IDENT_RE.test(k)) throw new Error(`Nombre de campo no válido: ${k}`);
  }
}

function verificarToken(req) {
  const auth = req.headers['authorization'] || '';
  const m = auth.match(/^Bearer (.+)$/);
  if (!m) return null;
  try { return jwt.verify(m[1], JWT_SECRET); } catch (e) { return null; }
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, corsHeaders);
    res.end();
    return;
  }
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));

  if (!JWT_SECRET) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Falta configurar JWT_SECRET en el servidor' }));
    return;
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const fail = (code, msg) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: msg }));
  };
  const cerrar = async () => { try { await client.end(); } catch (_) { } };

  try {
    await client.connect();
    const { action, table, data, where } = req.body || {};

    // ---------- LOGIN (sin token) ----------
    if (action === 'login') {
      const { email, password } = data || {};
      if (!email || !password) { await cerrar(); return fail(400, 'Faltan credenciales'); }
      const hash = crypto.createHash('sha256').update(password).digest('hex');
      const result = await client.query(
        'SELECT id, email, rol, empleado_id FROM usuarios WHERE email=$1 AND password_hash=$2 AND activo=true',
        [email, hash]
      );
      if (result.rows.length === 0) { await cerrar(); return fail(401, 'Email o contraseña incorrectos'); }
      const user = result.rows[0];
      const token = jwt.sign({ id: user.id, rol: user.rol, empleado_id: user.empleado_id }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
      await cerrar();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ user, token }));
      return;
    }

    // ---------- Todo lo demás requiere token válido ----------
    const auth = verificarToken(req);
    if (!auth) { await cerrar(); return fail(401, 'Sesión no válida, vuelve a iniciar sesión'); }
    const esEmpleado = auth.rol === 'empleado';

    if (!table || !ALLOWED_TABLES.has(table)) { await cerrar(); return fail(403, 'Tabla no permitida'); }

    if (esEmpleado) {
      if (action === 'select' && !TABLAS_EMPLEADO_SELECT_OK.has(table)) { await cerrar(); return fail(403, 'No autorizado'); }
      if ((action === 'insert' || action === 'update' || action === 'delete') && !TABLAS_EMPLEADO_ESCRITURA.has(table)) { await cerrar(); return fail(403, 'No autorizado'); }
      if (action === 'upsert') { await cerrar(); return fail(403, 'No autorizado'); }
    }

    // ---------- SELECT ----------
    if (action === 'select') {
      let effectiveWhere = { ...(where || {}) };
      if (esEmpleado && TABLAS_EMPLEADO_SELECT_PROPIO.has(table)) {
        effectiveWhere = { ...effectiveWhere, empleado_id: auth.empleado_id };
      }
      validarIdentificadores(effectiveWhere);
      const conds = Object.entries(effectiveWhere);
      let query = `SELECT * FROM ${table}`;
      const values = [];
      if (conds.length) {
        query += ' WHERE ' + conds.map(([k], i) => `${k}=$${i + 1}`).join(' AND ');
        conds.forEach(([, v]) => values.push(v));
      }
      const result = await client.query(query, values);
      let rows = result.rows;

      if (esEmpleado && table === 'config') rows = rows.filter(r => !claveConfigSensible(r.clave));
      if (esEmpleado && table === 'empleados') {
        rows = rows.map(r => { const c = { ...r }; EMPLEADOS_COLUMNAS_OCULTAS.forEach(k => delete c[k]); return c; });
      }

      await cerrar();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: rows }));
      return;
    }

    // ---------- INSERT ----------
    if (action === 'insert') {
      let rows = Array.isArray(data) ? data : [data];
      if (esEmpleado) {
        rows = rows.map(row => {
          const r = { ...row, empleado_id: auth.empleado_id }; // nunca confiar en el empleado_id que mande el cliente
          if (table === 'cambios_turno') {
            r.estado = 'pendiente';
            if (!['modificar', 'eliminar'].includes(r.tipo)) r.tipo = 'modificar';
          }
          return r;
        });
      }
      const inserted = [];
      for (const row of rows) {
        validarIdentificadores(row);
        const keys = Object.keys(row);
        const vals = Object.values(row);
        const placeholders = keys.map((_, i) => `$${i + 1}`);
        const query = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${placeholders.join(',')}) RETURNING *`;
        const result = await client.query(query, vals);
        inserted.push(result.rows[0]);
      }
      await cerrar();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: inserted.length === 1 ? inserted[0] : inserted }));
      return;
    }

    // ---------- UPDATE ----------
    if (action === 'update') {
      const { id, ...fields } = data;
      if (esEmpleado && table === 'cambios_turno') { delete fields.estado; delete fields.empleado_id; }
      validarIdentificadores(fields);
      const keys = Object.keys(fields);
      const vals = Object.values(fields);
      const sets = keys.map((k, i) => `${k}=$${i + 1}`);
      vals.push(id);
      let query = `UPDATE ${table} SET ${sets.join(',')} WHERE id=$${vals.length}`;
      if (esEmpleado && TABLAS_EMPLEADO_ESCRITURA.has(table)) {
        vals.push(auth.empleado_id);
        query += ` AND empleado_id=$${vals.length}`;
      }
      query += ' RETURNING *';
      const result = await client.query(query, vals);
      if (result.rows.length === 0) { await cerrar(); return fail(403, 'No autorizado o registro no encontrado'); }
      await cerrar();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: result.rows[0] }));
      return;
    }

    // ---------- DELETE ----------
    if (action === 'delete') {
      let effectiveWhere;
      if (where) effectiveWhere = { ...where };
      else if (data && data.id) effectiveWhere = { id: data.id };
      else effectiveWhere = { ...data };

      if (esEmpleado && TABLAS_EMPLEADO_ESCRITURA.has(table)) {
        effectiveWhere = { ...effectiveWhere, empleado_id: auth.empleado_id };
      }
      validarIdentificadores(effectiveWhere);
      const conds = Object.entries(effectiveWhere);
      const query = `DELETE FROM ${table} WHERE ${conds.map(([k], i) => `${k}=$${i + 1}`).join(' AND ')}`;
      const values = conds.map(([, v]) => v);
      await client.query(query, values);
      await cerrar();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
      return;
    }

    // ---------- UPSERT (solo director, config) ----------
    if (action === 'upsert') {
      const rows = Array.isArray(data) ? data : [data];
      for (const row of rows) {
        const { clave, valor, comentario } = row;
        await client.query(
          `INSERT INTO config (clave, valor, comentario) VALUES ($1, $2, $3) ON CONFLICT (clave) DO UPDATE SET valor=$2, comentario=$3`,
          [clave, valor, comentario || null]
        );
      }
      await cerrar();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
      return;
    }

    await cerrar();
    fail(400, 'Acción no reconocida');

  } catch (e) {
    console.error(e);
    await cerrar();
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  }
};