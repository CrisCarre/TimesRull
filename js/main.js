/**
 * Planificación Hotel — main.js
 * Punto de entrada único. Contiene todos los módulos en orden de dependencia:
 *
 *  1. config.js          — Supabase, estado global, constantes de turnos
 *  2. helpers.js         — Arranque, login, carga de datos, utilidades, avisos, toast
 *  3. render.js          — Render principal (topbar, routing)
 *  4. views-calendar.js  — Vista overview, calendario mensual, modal de día
 *  5. views-week.js      — Vista semanal
 *  6. views-reports.js   — Resumen mensual
 *  7. views-staff.js     — Empleados, disponibilidad, plantillas, reglas
 *  8. views-outlets.js   — Gestión de locales (outlets) y configuración global
 *  9. export.js          — Exportación PDF / Excel / CSV
 *
 * Para separar en módulos ES con import/export en el futuro, cada sección
 * delimitada por los comentarios /* === ... === * / es un módulo independiente.
 */


/* =====================================================================
   CONFIGURACIÓN API
   ===================================================================== */
const API_URL = 'https://times-rull.vercel.app/api';

async function apiCall(body) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(json.error || 'Error de API');
  return json;
}

// Capa de compatibilidad con la sintaxis de Supabase
const supabase = {
  auth: {
    getSession: async () => {
      const user = sessionStorage.getItem('timesrull_user');
      return { data: { session: user ? { user: JSON.parse(user) } : null } };
    },
    signInWithPassword: async ({ email, password }) => {
      try {
        const json = await apiCall({ action: 'login', data: { email, password } });
        if (json.user) {
          sessionStorage.setItem('timesrull_user', JSON.stringify(json.user));
          return { data: { user: json.user }, error: null };
        }
        return { data: null, error: { message: json.error || 'Email o contraseña incorrectos' } };
      } catch (e) {
        return { data: null, error: { message: 'Email o contraseña incorrectos' } };
      }
    },
    signOut: async () => {
      sessionStorage.removeItem('timesrull_user');
      return { error: null };
    },
  },
  from: (table) => ({
    select: (cols) => ({
      eq: (col, val) => ({
        order: (ord) => apiCall({ action: 'select', table, where: { [col]: val } }),
        then: (fn) => apiCall({ action: 'select', table, where: { [col]: val } }).then(r => fn({ data: r.data, error: null })).catch(e => fn({ data: null, error: e })),
      }),
      order: (ord) => apiCall({ action: 'select', table }).then(r => ({ data: r.data, error: null })).catch(e => ({ data: null, error: e })),
      then: (fn) => apiCall({ action: 'select', table }).then(r => fn({ data: r.data, error: null })).catch(e => fn({ data: null, error: e })),
    }),
    insert: (rows) => ({
      select: () => ({
        single: () => apiCall({ action: 'insert', table, data: rows[0] }).then(r => ({ data: r.data, error: null })).catch(e => ({ data: null, error: e })),
        then: (fn) => apiCall({ action: 'insert', table, data: rows[0] }).then(r => fn({ data: [r.data], error: null })).catch(e => fn({ data: null, error: e })),
      }),
      then: (fn) => {
        const payload = Array.isArray(rows) ? rows : [rows[0]];
        return apiCall({ action: 'insert', table, data: payload }).then(r => fn({ data: r.data, error: null })).catch(e => fn({ data: null, error: e }));
      },
    }),
    update: (data) => ({
      eq: (col, val) => ({
        select: () => ({
          single: () => apiCall({ action: 'update', table, data: { ...data, id: val } }).then(r => ({ data: r.data, error: null })).catch(e => ({ data: null, error: e })),
        }),
        then: (fn) => apiCall({ action: 'update', table, data: { ...data, id: val } }).then(r => fn({ data: r.data, error: null })).catch(e => fn({ data: null, error: e })),
      }),
    }),
    delete: () => ({
      eq: (col, val) => ({
        then: (fn) => apiCall({ action: 'delete', table, where: { [col]: val } }).then(r => fn({ error: null })).catch(e => fn({ error: e })),
      }),
    }),
    upsert: (rows, opts) => ({
      then: (fn) => {
        const items = Array.isArray(rows) ? rows : [rows];
        Promise.all(items.map(item => apiCall({ action: 'upsert', table, data: item })))
          .then(() => fn({ error: null }))
          .catch(e => fn({ error: e }));
      },
    }),
  }),
};

/* =====================================================================
   ESTADO GLOBAL
   ===================================================================== */
const state = {
  user: null,
  rol: null,  // 'director' | 'empleado'
  config: {},
  /* NEW: outlets */
  outlets: [],           // [{id, nombre, icono, activo}]
  outletEmpleados: [],   // [{id, empleado_id, outlet_id, departamento}]  departamento: 'FOH'|'BOH'
  /* END NEW */
  empleados: [],
  planificacion: [],
  festivos: {},
  disponibilidad: [],
  plantillas: [],
  reglasMinimo: [],
  /* context */
  view: 'overview',
  cursorMes: null,
  cursorSemana: null,
  /* NEW: active context */
  ctxOutletId: null,     // null = "todos" (only for overview/global reports)
  ctxDept: 'ALL',        // 'ALL' | 'FOH' | 'BOH'
};

const turnoColors = {};
const turnoNombres = {};
const turnoHoras = {};
const turnosOrden = [];

const DEPTS = ['FOH', 'BOH'];

function fmtFecha(f) {
  if (!f) return '';
  const s = String(f).slice(0, 10); // YYYY-MM-DD
  const [y, m, d] = s.split('-');
  return `${d}-${m}-${y.slice(2)}`;
}

const DEPT_LABELS = { FOH: 'Front of House', BOH: 'Back of House', ALL: 'Todos los departamentos' };
const DEPT_CLASS = { FOH: 'foh', BOH: 'boh', ALL: 'all' };
const OUTLET_ICONS = ['🏨', '🍽️', '🍹', '🏊', '🧖', '🎭', '🎰', '🏋️', '☕', '🛍️'];

/* =====================================================================
   ARRANQUE
   ===================================================================== */
window.addEventListener('DOMContentLoaded', async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { renderLogin(); return; }
  state.user = session.user;
  state.rol = session.user.rol || 'empleado';
  state.empleadoId = session.user.empleado_id || null;
  await cargarTodo();
});

/* =====================================================================
   LOGIN / LOGOUT
   ===================================================================== */
function renderLogin(error = '') {
  document.getElementById('root').innerHTML = `
    <div id="login-screen">
      <div class="login-card">
        <h1>Planificación Hotel</h1>
        <p class="login-sub">Acceso de gestión</p>
        <form id="login-form">
          <input type="email" id="email" placeholder="Email" autocomplete="email" required>
          <input type="password" id="password" placeholder="Contraseña" autocomplete="current-password" required>
          <button type="submit" id="btn-login">Entrar</button>
          ${error ? `<div class="login-error-msg">⚠️ ${error}</div>` : ''}
        </form>
      </div>
    </div>`;
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-login');
    btn.disabled = true;
    btn.textContent = 'Entrando…';
    const { data, error } = await supabase.auth.signInWithPassword({
      email: document.getElementById('email').value,
      password: document.getElementById('password').value,
    });
    btn.disabled = false;
    btn.textContent = 'Entrar';
    if (error) {
      const msg = error.message === 'Invalid login credentials' ? 'Email o contraseña incorrectos' : error.message;
      const card = document.querySelector('.login-card');
      card.classList.add('shake');
      setTimeout(() => card.classList.remove('shake'), 500);
      const oldErr = document.querySelector('.login-error-msg');
      if (oldErr) oldErr.remove();
      const errEl = document.createElement('div');
      errEl.className = 'login-error-msg';
      errEl.textContent = '⚠️ ' + msg;
      document.getElementById('login-form').appendChild(errEl);
      return;
    }
    state.user = data.user;
    state.rol = data.user.rol || 'empleado';
    state.empleadoId = data.user.empleado_id || null;
    await cargarTodo();
  });
}
async function logout() {
  await supabase.auth.signOut();
  state.user = null;
  renderLogin();
}

/* =====================================================================
   CARGA DE DATOS
   ===================================================================== */
async function cargarTodo() {
  document.getElementById('root').innerHTML = '<div class="loading">Cargando datos…</div>';
  try {
    const [cfgRes, empRes, planRes, festRes, dispRes, plantRes, reglasRes, outRes, oeRes] = await Promise.all([
      supabase.from('config').select('*'),
      supabase.from('empleados').select('*').eq('activo', true).order('nombre'),
      supabase.from('planificacion').select('*'),
      supabase.from('festivos').select('*'),
      supabase.from('disponibilidad').select('*'),
      supabase.from('plantillas').select('*').order('nombre'),
      supabase.from('reglas_minimo').select('*'),
      supabase.from('outlets').select('*').eq('activo', true).order('orden'),
      supabase.from('outlet_empleados').select('*'),
    ]);

    [cfgRes, empRes, planRes, festRes, dispRes, plantRes, reglasRes, outRes, oeRes].forEach(r => {
      if (r.error) throw r.error;
    });

    state.config = {};
    cfgRes.data.forEach(r => state.config[r.clave] = r.valor);

    state.empleados = empRes.data.map(e => ({
      ...e,
      coste_hora: parseFloat(e.coste_hora),
      max_horas_semana: parseFloat(e.max_horas_semana || 40),
    }));

    state.planificacion = planRes.data.map(p => ({ ...p, horas: parseFloat(p.horas), empleado_id: parseInt(p.empleado_id, 10) }));
    state.festivos = {};
    festRes.data.forEach(f => state.festivos[f.fecha] = f.nombre);
    state.disponibilidad = dispRes.data;
    state.plantillas = plantRes.data;
    state.reglasMinimo = reglasRes.data;
    state.outlets = outRes.data;
    state.outletEmpleados = oeRes.data;

    procesarTurnos();
    document.documentElement.style.setProperty('--color-primario', state.config.COLOR_PRIMARIO || '#0f766e');
    document.documentElement.style.setProperty('--color-alerta', state.config.COLOR_ALERTA || '#dc2626');

    if (!state.cursorMes) { const h = new Date(); state.cursorMes = new Date(h.getFullYear(), h.getMonth(), 1); }
    if (!state.cursorSemana) { state.cursorSemana = lunesDe(new Date()); }

    // Default context: if we have outlets, show overview first
    if (state.outlets.length > 0 && !state.ctxOutletId) {
      state.view = 'overview';
    }

    render();
  } catch (e) {
    console.error(e);
    document.getElementById('root').innerHTML = `<div class="loading">Error: ${e.message}<br><br><button class="btn-pri" onclick="location.reload()">Reintentar</button></div>`;
  }
}

function procesarTurnos() {
  const codigos = (state.config.TURNOS || 'M|T|N').split('|').filter(Boolean);
  turnosOrden.length = 0;
  [turnoNombres, turnoHoras, turnoColors].forEach(o => Object.keys(o).forEach(k => delete o[k]));
  for (const cod of codigos) {
    turnosOrden.push(cod);
    turnoNombres[cod] = state.config[`TURNO_${cod}_NOMBRE`] || cod;
    turnoHoras[cod] = parseFloat(state.config[`TURNO_${cod}_HORAS`] || '8');
    turnoColors[cod] = state.config[`TURNO_${cod}_COLOR`] || '#888';
  }
}

/* =====================================================================
   HELPERS GENERALES
   ===================================================================== */
function fechaISO(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function parseISO(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function divisa(n) { return `${n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${state.config.DIVISA || '€'}`; }
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function sumarDias(fechaStr, dias) { const d = parseISO(fechaStr); d.setDate(d.getDate() + dias); return fechaISO(d); }
function sumarDiasDate(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
function lunesDe(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); const dow = x.getDay(); x.setDate(x.getDate() + (dow === 0 ? -6 : 1 - dow)); return x; }
function diasSemana(lunes) { const out = []; for (let i = 0; i < 7; i++) out.push(new Date(lunes.getFullYear(), lunes.getMonth(), lunes.getDate() + i)); return out; }

/* =====================================================================
   HELPERS DE CONTEXTO (outlet / departamento)
   ===================================================================== */
function ctxOutlet() { return state.outlets.find(o => o.id === state.ctxOutletId) || null; }

/** Empleados visibles en el contexto activo */
function empleadosEnContexto() {
  if (!state.ctxOutletId) return state.empleados; // overview (no filtra)
  const ids = state.outletEmpleados
    .filter(oe => oe.outlet_id === state.ctxOutletId && (state.ctxDept === 'ALL' || oe.departamento === state.ctxDept))
    .map(oe => oe.empleado_id);
  return state.empleados.filter(e => ids.includes(e.id));
}

/** Departamento de un empleado en el outlet activo */
function deptDeEmpleado(empId) {
  if (!state.ctxOutletId) return null;
  const oe = state.outletEmpleados.find(x => x.empleado_id === empId && x.outlet_id === state.ctxOutletId);
  return oe ? oe.departamento : null;
}

/** Presupuesto del contexto activo */
function presupuestoCtx() {
  if (!state.ctxOutletId) return parseFloat(state.config.PRESUPUESTO_MENSUAL || 0);
  const dept = state.ctxDept === 'ALL' ? '' : `_${state.ctxDept}`;
  return parseFloat(state.config[`PRESUPUESTO_${state.ctxOutletId}${dept}`] || 0);
}

/** Asignaciones filtradas por contexto */
function asignacionesDe(fecha) {
  const emps = new Set(empleadosEnContexto().map(e => e.id));
  return state.planificacion.filter(a => a.fecha === fecha && emps.has(a.empleado_id));
}

/** Planificación completa filtrada por contexto (para resumen mes) */
function planificacionCtx() {
  const emps = new Set(empleadosEnContexto().map(e => e.id));
  return state.planificacion.filter(a => emps.has(a.empleado_id));
}

function empleadoNoDisponible(empleadoId, fecha) {
  return state.disponibilidad.find(d => d.empleado_id === empleadoId && fecha >= d.fecha_inicio && fecha <= d.fecha_fin);
}
function empleadosNoDisponiblesEn(fecha) {
  return state.disponibilidad.filter(d => fecha >= d.fecha_inicio && fecha <= d.fecha_fin);
}

const TIPOS_DISPONIBILIDAD = {
  vacaciones: { label: 'Vacaciones', color: '#3b82f6' },
  baja: { label: 'Baja médica', color: '#dc2626' },
  personal: { label: 'Asunto personal', color: '#a855f7' },
  otros: { label: 'Otros', color: '#6b7280' },
};
function tipoDispLabel(tipo) { return (TIPOS_DISPONIBILIDAD[tipo] || TIPOS_DISPONIBILIDAD.otros).label; }
function tipoDispColor(tipo) { return (TIPOS_DISPONIBILIDAD[tipo] || TIPOS_DISPONIBILIDAD.otros).color; }

function calcularHorasRango(inicio, fin) {
  if (!inicio || !fin) return 0;
  const [hi, mi] = inicio.split(':').map(Number);
  const [hf, mf] = fin.split(':').map(Number);
  let minI = hi * 60 + mi, minF = hf * 60 + mf;
  if (minF <= minI) minF += 24 * 60;
  return parseFloat(((minF - minI) / 60).toFixed(2));
}
function horasDefaultDeTurno(turno) {
  return { hora_inicio: state.config[`TURNO_${turno}_INICIO`] || '', hora_fin: state.config[`TURNO_${turno}_FIN`] || '' };
}

/* =====================================================================
   CÁLCULOS DE COSTE
   ===================================================================== */
function calcularCoste(asig, emp, esFestivo) {
  const base = asig.horas * emp.coste_hora;
  const plusN = asig.turno === 'N' ? base * (parseFloat(state.config.PLUS_NOCTURNIDAD || 0) / 100) : 0;
  const plusF = esFestivo ? base * (parseFloat(state.config.PLUS_FESTIVO || 0) / 100) : 0;
  return { base, plusN, plusF, total: base + plusN + plusF };
}

function totalDia(fecha) {
  const fijo = parseFloat(state.config.COSTE_FIJO_DIARIO || 0);
  const asigs = asignacionesDe(fecha);
  if (asigs.length === 0) return null;
  const empById = {}; state.empleados.forEach(e => empById[e.id] = e);
  let personal = 0;
  asigs.forEach(a => { const emp = empById[a.empleado_id]; if (!emp) return; personal += calcularCoste(a, emp, !!state.festivos[fecha]).total; });
  return { personal, fijo, total: personal + fijo, asignaciones: asigs.length };
}

/* =====================================================================
   AVISOS
   ===================================================================== */
function avisosDia(fecha) {
  const out = [];
  const asigs = asignacionesDe(fecha);
  const empById = {}; state.empleados.forEach(e => empById[e.id] = e);

  asigs.forEach(a => {
    const noDisp = empleadoNoDisponible(a.empleado_id, fecha);
    if (noDisp) out.push({ nivel: 'rojo', msg: `${empById[a.empleado_id]?.nombre} tiene ${tipoDispLabel(noDisp.tipo).toLowerCase()} y está asignado` });
  });

  const fechaObj = parseISO(fecha);
  let dow = fechaObj.getDay(); if (dow === 0) dow = 7;
  state.reglasMinimo.filter(r => r.dia_semana === dow).forEach(regla => {
    const cumplido = asigs.filter(a => {
      if (a.turno !== regla.turno) return false;
      if (regla.puesto) { const e = empById[a.empleado_id]; return e && e.puesto === regla.puesto; }
      return true;
    }).length;
    if (cumplido < regla.minimo) {
      out.push({ nivel: 'rojo', msg: `Mínimo no cumplido: ${cumplido}/${regla.minimo} turno ${regla.turno}${regla.puesto ? ` de ${regla.puesto}` : ''}` });
    }
  });

  const descansoMin = parseFloat(state.config.DESCANSO_MIN_HORAS || 12);
  asigs.forEach(a => {
    const emp = empById[a.empleado_id]; if (!emp) return;
    if (a.turno === 'N') {
      const sig = sumarDias(fecha, 1);
      const asigSig = state.planificacion.find(x => x.fecha === sig && x.empleado_id === a.empleado_id);
      if (asigSig && asigSig.turno === 'M') out.push({ nivel: 'amarillo', msg: `${emp.nombre}: N → M siguiente día (descanso < ${descansoMin}h)` });
    }
  });

  const maxCons = parseInt(state.config.MAX_DIAS_CONSECUTIVOS || 6);
  asigs.forEach(a => {
    const emp = empById[a.empleado_id]; if (!emp) return;
    let cons = 1; let f = sumarDias(fecha, -1);
    while (state.planificacion.some(x => x.fecha === f && x.empleado_id === a.empleado_id)) { cons++; if (cons > maxCons) break; f = sumarDias(f, -1); }
    if (cons > maxCons) out.push({ nivel: 'amarillo', msg: `${emp.nombre}: ${cons} días consecutivos (máx ${maxCons})` });
  });

  asigs.forEach(a => {
    const emp = empById[a.empleado_id]; if (!emp) return;
    const lunes = lunesDe(parseISO(fecha));
    const ini = fechaISO(lunes); const fin = sumarDias(ini, 6);
    const h = state.planificacion.filter(x => x.empleado_id === a.empleado_id && x.fecha >= ini && x.fecha <= fin).reduce((s, x) => s + x.horas, 0);
    if (h > emp.max_horas_semana) out.push({ nivel: 'amarillo', msg: `${emp.nombre}: ${h}h esta semana (máx ${emp.max_horas_semana})` });
  });

  const seen = new Set();
  return out.filter(a => { const k = a.nivel + '|' + a.msg; if (seen.has(k)) return false; seen.add(k); return true; });
}

function nivelMaximoAvisos(avisos) {
  if (avisos.some(a => a.nivel === 'rojo')) return 'rojo';
  if (avisos.length > 0) return 'amarillo';
  return null;
}

function calcularAvisosSobreDraft(fecha, draft) {
  const backup = state.planificacion;
  state.planificacion = [...backup.filter(a => a.fecha !== fecha), ...draft.map(a => ({ ...a, fecha }))];
  const av = avisosDia(fecha);
  state.planificacion = backup;
  return av;
}

/* =====================================================================
   TOAST
   ===================================================================== */
function toast(msg, tipo = '') {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = `toast ${tipo}`; el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

/* =====================================================================
   RENDER PRINCIPAL
   ===================================================================== */
function render() {
  // Vista empleado — interfaz reducida
  if (state.rol === 'empleado') { renderEmpleadoView(); return; }

  const outlet = ctxOutlet();
  const hasOutlets = state.outlets.length > 0;

  // Build dept buttons HTML
  const deptButtons = hasOutlets && state.ctxOutletId ? DEPTS.map(d => {
    const isActive = state.ctxDept === d;
    const cls = isActive ? `dept-badge active-${DEPT_CLASS[d]}` : `dept-badge ${DEPT_CLASS[d]}`;
    return `<button class="${cls}" data-dept="${d}">${d} <span style="font-size:10px;font-weight:400">${DEPT_LABELS[d]}</span></button>`;
  }).join('') + `<button class="${state.ctxDept === 'ALL' ? 'dept-badge active-all' : 'dept-badge all'}" data-dept="ALL">Ambos</button>` : '';

  const empCount = empleadosEnContexto().length;

  document.getElementById('root').innerHTML = `
    <header class="topbar">
      <div class="brand">
        <strong>${escapeHtml(state.config.NOMBRE_HOTEL || 'Hotel')}</strong>
        <span class="user">${escapeHtml(state.user?.email || '')}</span>
      </div>

      ${hasOutlets ? `
        <div class="ctx-strip">
          <span class="ctx-label">Local</span>
          <select class="ctx-select" id="ctx-outlet-sel">
            <option value="" ${!state.ctxOutletId ? 'selected' : ''}>🏨 Todos los locales</option>
            ${state.outlets.map(o => `<option value="${o.id}" ${o.id === state.ctxOutletId ? 'selected' : ''}>${o.icono || ''} ${escapeHtml(o.nombre)}</option>`).join('')}
          </select>
          ${state.ctxOutletId ? `
            <span class="ctx-chevron">›</span>
            <div class="dept-select-wrap">
              ${deptButtons}
            </div>
          ` : ''}
        </div>
      ` : ''}

      <nav class="tabs">
        ${hasOutlets && !state.ctxOutletId ? `
          <button data-view="overview" class="${state.view === 'overview' ? 'active' : ''}">Vista general</button>
        ` : ''}
        ${state.ctxOutletId ? `
          <button data-view="calendario" class="${state.view === 'calendario' ? 'active' : ''}">Calendario</button>
          <button data-view="semana" class="${state.view === 'semana' ? 'active' : ''}">Semana</button>
          <button data-view="mes" class="${state.view === 'mes' ? 'active' : ''}">Resumen mes</button>
        ` : ''}
        <button data-view="empleados" class="${state.view === 'empleados' ? 'active' : ''}">Empleados</button>
        <button data-view="disponibilidad" class="${state.view === 'disponibilidad' ? 'active' : ''}">Disponibilidad</button>
        <button data-view="config" class="${state.view === 'config' ? 'active' : ''}">Config</button>
      </nav>
      <button class="logout" id="btn-logout">Salir</button>
    </header>

    ${state.ctxOutletId ? `
      <div class="ctx-banner">
        <span>Viendo:</span>
        <span class="ctx-banner-outlet">${outlet?.icono || ''} ${escapeHtml(outlet?.nombre || '')}</span>
        <span class="ctx-banner-sep">|</span>
        <span class="ctx-banner-dept ${DEPT_CLASS[state.ctxDept]}">${state.ctxDept === 'ALL' ? 'FOH + BOH' : state.ctxDept}</span>
        <span class="ctx-banner-sep">·</span>
        <span class="ctx-banner-count">${empCount} empleado${empCount !== 1 ? 's' : ''}</span>
      </div>
    ` : ''}

    <main id="main"></main>
    <div id="modal-root"></div>
  `;

  // Events
  document.querySelectorAll('.tabs button').forEach(b => {
    b.addEventListener('click', () => { state.view = b.dataset.view; render(); });
  });
  document.getElementById('btn-logout').addEventListener('click', logout);

  const outSel = document.getElementById('ctx-outlet-sel');
  if (outSel) {
    outSel.addEventListener('change', () => {
      state.ctxOutletId = parseInt(outSel.value) || null;
      state.ctxDept = 'ALL';
      state.view = state.ctxOutletId ? 'calendario' : 'overview';
      render();
    });
  }
  document.querySelectorAll('[data-dept]').forEach(b => {
    b.addEventListener('click', () => { state.ctxDept = b.dataset.dept; render(); });
  });

  // Route view
  if (state.view === 'overview') renderOverview();
  else if (state.view === 'calendario') renderCalendario();
  else if (state.view === 'semana') renderSemana();
  else if (state.view === 'mes') renderResumenMes();
  else if (state.view === 'empleados') renderEmpleados();
  else if (state.view === 'disponibilidad') renderDisponibilidad();
  else if (state.view === 'plantillas') renderPlantillas();
  else if (state.view === 'reglas') renderReglas();
  else if (state.view === 'outlets') renderOutlets();
  else if (state.view === 'config') renderConfig();
}

/* =====================================================================
   VISTA EMPLEADO — interfaz reducida
   ===================================================================== */
function renderEmpleadoView() {
  const emp = state.empleados.find(e => e.id === state.empleadoId);
  const empNombre = emp ? emp.nombre : state.user?.email || '';
  const viewEmp = state.viewEmp || 'calendario';

  document.getElementById('root').innerHTML = `
    <header class="topbar">
      <div class="brand">
        <strong>${escapeHtml(state.config.NOMBRE_HOTEL || 'Hotel')}</strong>
        <span class="user">👤 ${escapeHtml(empNombre)}</span>
      </div>
      <nav class="tabs">
        <button data-vemp="calendario" class="${viewEmp === 'calendario' ? 'active' : ''}">Calendario</button>
        <button data-vemp="semana" class="${viewEmp === 'semana' ? 'active' : ''}">Semana</button>
        <button data-vemp="disponibilidad" class="${viewEmp === 'disponibilidad' ? 'active' : ''}">Mi disponibilidad</button>
      </nav>
      <button class="logout" id="btn-logout">Salir</button>
    </header>
    <main id="main"></main>
    <div id="modal-root"></div>
  `;

  document.getElementById('btn-logout').addEventListener('click', logout);
  document.querySelectorAll('[data-vemp]').forEach(b => {
    b.addEventListener('click', () => { state.viewEmp = b.dataset.vemp; renderEmpleadoView(); });
  });

  if (viewEmp === 'calendario') renderCalendarioEmpleado();
  else if (viewEmp === 'semana') renderSemanaEmpleado();
  else if (viewEmp === 'disponibilidad') renderDisponibilidadEmpleado();
}

function renderCalendarioEmpleado() {
  // Usa el calendario normal pero en modo solo lectura
  renderCalendario(true);
}

function renderSemanaEmpleado() {
  renderSemana(true);
}

function renderDisponibilidadEmpleado() {
  const main = document.getElementById('main');
  const emp = state.empleados.find(e => e.id === state.empleadoId);
  if (!emp) { main.innerHTML = '<div class="empty-state">Empleado no encontrado</div>'; return; }

  const misDisp = state.disponibilidad.filter(d => d.empleado_id === state.empleadoId);

  main.innerHTML = `
    <div style="padding:24px;max-width:700px;margin:0 auto">
      <h2 style="margin-bottom:16px">Mi disponibilidad</h2>
      <button class="btn-pri" id="btn-nueva-disp" style="margin-bottom:20px">+ Nueva solicitud</button>
      ${misDisp.length === 0 ? '<div class="empty-state">Sin solicitudes registradas</div>' : `
        <div class="cards-grid">
          ${misDisp.map(d => `
            <div class="card" style="padding:14px">
              <div style="font-weight:600;margin-bottom:4px">${tipoDispLabel(d.tipo)}</div>
              <div style="font-size:13px;color:var(--muted)">${fmtFecha(d.fecha_inicio)} → ${fmtFecha(d.fecha_fin)}</div>
              ${d.nota ? `<div style="font-size:12px;margin-top:6px;color:var(--muted)">${escapeHtml(d.nota)}</div>` : ''}
              <button class="btn-del" data-id="${d.id}" style="margin-top:10px;font-size:11px">Eliminar</button>
            </div>
          `).join('')}
        </div>
      `}
    </div>
    <div id="modal-root"></div>
  `;

  document.getElementById('btn-nueva-disp').addEventListener('click', () => {
    document.getElementById('modal-root').innerHTML = `
      <div class="modal-overlay">
        <div class="modal">
          <h3>Nueva solicitud</h3>
          <label>Tipo</label>
          <select id="disp-tipo">
            <option value="vacaciones">Vacaciones</option>
            <option value="baja">Baja médica</option>
            <option value="personal">Asunto personal</option>
            <option value="otros">Otros</option>
          </select>
          <label>Desde</label>
          <input type="date" id="disp-ini">
          <label>Hasta</label>
          <input type="date" id="disp-fin">
          <label>Nota (opcional)</label>
          <input type="text" id="disp-nota" placeholder="Motivo...">
          <div class="modal-actions">
            <button class="btn-sec" id="btn-cancel-disp">Cancelar</button>
            <button class="btn-pri" id="btn-save-disp">Guardar</button>
          </div>
        </div>
      </div>`;
    document.getElementById('btn-cancel-disp').addEventListener('click', () => { document.getElementById('modal-root').innerHTML = ''; });
    document.getElementById('btn-save-disp').addEventListener('click', async () => {
      const payload = {
        empleado_id: state.empleadoId,
        fecha_inicio: document.getElementById('disp-ini').value,
        fecha_fin: document.getElementById('disp-fin').value,
        tipo: document.getElementById('disp-tipo').value,
        nota: document.getElementById('disp-nota').value,
      };
      if (!payload.fecha_inicio || !payload.fecha_fin) { toast('Rellena las fechas', 'error'); return; }
      const { data, error } = await supabase.from('disponibilidad').insert([payload]).select().single();
      if (error) { toast('Error al guardar', 'error'); return; }
      state.disponibilidad.push(data);
      toast('Solicitud guardada', 'success');
      renderDisponibilidadEmpleado();
    });
  });

  document.querySelectorAll('.btn-del[data-id]').forEach(b => {
    b.addEventListener('click', async () => {
      const id = b.dataset.id;
      const { error } = await supabase.from('disponibilidad').delete().eq('id', id);
      if (error) { toast('Error al eliminar', 'error'); return; }
      state.disponibilidad = state.disponibilidad.filter(d => d.id !== id);
      toast('Eliminado', 'success');
      renderDisponibilidadEmpleado();
    });
  });
}

/* =====================================================================
   VISTA OVERVIEW (todos los outlets)
   ===================================================================== */
function renderOverview() {
  const main = document.getElementById('main');
  const cur = state.cursorMes;
  const year = cur.getFullYear();
  const mes = cur.getMonth();
  const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const diasMes = new Date(year, mes + 1, 0).getDate();

  if (state.outlets.length === 0) {
    main.innerHTML = `
      <div class="seccion-header"><h2>Vista general</h2></div>
      <div class="empty-state">
        <p style="font-size:32px;margin:0 0 12px">🏨</p>
        <p>No tienes ningún local (outlet) configurado todavía.</p>
        <button class="btn-pri" style="margin-top:12px" id="btn-ir-outlets">Crear primer local</button>
      </div>`;
    document.getElementById('btn-ir-outlets').addEventListener('click', () => { state.view = 'outlets'; render(); });
    return;
  }

  // Compute kpis per outlet
  const outletData = state.outlets.map(outlet => {
    const empIds_foh = new Set(state.outletEmpleados.filter(oe => oe.outlet_id === outlet.id && oe.departamento === 'FOH').map(oe => oe.empleado_id));
    const empIds_boh = new Set(state.outletEmpleados.filter(oe => oe.outlet_id === outlet.id && oe.departamento === 'BOH').map(oe => oe.empleado_id));
    const empIds_all = new Set([...empIds_foh, ...empIds_boh]);
    let totalMes = 0;
    for (let d = 1; d <= diasMes; d++) {
      const f = fechaISO(new Date(year, mes, d));
      const fijo = parseFloat(state.config.COSTE_FIJO_DIARIO || 0);
      const asigs = state.planificacion.filter(a => a.fecha === f && empIds_all.has(a.empleado_id));
      if (asigs.length === 0) continue;
      const empById = {}; state.empleados.forEach(e => empById[e.id] = e);
      let personal = 0;
      asigs.forEach(a => { const emp = empById[a.empleado_id]; if (!emp) return; personal += calcularCoste(a, emp, !!state.festivos[f]).total; });
      totalMes += personal + fijo;
    }
    const pres = parseFloat(state.config[`PRESUPUESTO_${outlet.id}`] || 0);
    return { outlet, foh: empIds_foh.size, boh: empIds_boh.size, total: empIds_all.size, totalMes, pres };
  });

  main.innerHTML = `
    <div class="cal-header" style="justify-content:space-between">
      <h2>Vista general — ${meses[mes]} ${year}</h2>
      <div style="display:flex;gap:8px">
        <button class="nav-mes" id="prev-mes">‹</button>
        <button class="nav-mes" id="next-mes">›</button>
      </div>
    </div>

    <div class="overview-grid">
      ${outletData.map(({ outlet, foh, boh, total, totalMes, pres }) => {
    const pct = pres > 0 ? (totalMes / pres * 100) : 0;
    const presColor = pct >= 100 ? 'var(--color-alerta)' : pct >= 90 ? 'var(--color-warn)' : 'var(--color-primario)';
    return `
        <div class="overview-card" data-outlet="${outlet.id}">
          <div class="overview-card-shop">
              ${outlet.imagen
                ? `<img src="${outlet.imagen}" alt="${escapeHtml(outlet.nombre)}" style="width:100%;height:100%;object-fit:cover">`
                : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#f0f4f5;color:#146385;font-size:13px;font-weight:500;letter-spacing:0.5px">📷 Sin imagen</div>`}
            </div>
          <div class="overview-card-head">
            <div>
              <p class="overview-outlet-name">${outlet.icono || '🏨'} ${escapeHtml(outlet.nombre)}</p>
              <p class="overview-outlet-sub">${total} empleado${total !== 1 ? 's' : ''} activos</p>
            </div>
          </div>
          <div class="overview-depts">
            <button class="overview-dept-btn foh" data-outlet="${outlet.id}" data-dept="FOH">
              <span class="overview-dept-btn-label">FOH</span>
              <span class="overview-dept-btn-count">${foh}</span>
              
            </button>
            <button class="overview-dept-btn boh" data-outlet="${outlet.id}" data-dept="BOH">
              <span class="overview-dept-btn-label">BOH</span>
              <span class="overview-dept-btn-count">${boh}</span>
              
            </button>
          </div>
          <div class="overview-kpis">
            <div class="overview-kpi">
              <span class="overview-kpi-label">Coste mes</span>
              <span class="overview-kpi-val" style="color:${presColor}">${divisa(totalMes)}</span>
            </div>
            ${pres > 0 ? `
            <div class="overview-kpi">
              <span class="overview-kpi-label">Presupuesto</span>
              <span class="overview-kpi-val">${pct.toFixed(0)}%</span>
            </div>`: ''}
            <div class="overview-kpi">
              <span class="overview-kpi-label">Empleados</span>
              <span class="overview-kpi-val">${total}</span>
            </div>
          </div>
        </div>`;
  }).join('')}
    </div>
  `;

  document.getElementById('prev-mes').addEventListener('click', () => { state.cursorMes = new Date(year, mes - 1, 1); render(); });
  document.getElementById('next-mes').addEventListener('click', () => { state.cursorMes = new Date(year, mes + 1, 1); render(); });

  document.querySelectorAll('.overview-card').forEach(card => {
    card.addEventListener('click', () => {
      state.ctxOutletId = parseInt(card.dataset.outlet);
      state.ctxDept = 'ALL';
      state.view = 'calendario';
      render();
    });
  });
  document.querySelectorAll('.overview-dept-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.ctxOutletId = parseInt(btn.dataset.outlet);
      state.ctxDept = btn.dataset.dept;
      state.view = 'calendario';
      render();
    });
  });
}

/* =====================================================================
   VISTA CALENDARIO
   ===================================================================== */
function renderCalendario(soloLectura = false) {
  const main = document.getElementById('main');
  const cur = state.cursorMes;
  const year = cur.getFullYear();
  const mes = cur.getMonth();
  const primer = new Date(year, mes, 1);
  const diasMes = new Date(year, mes + 1, 0).getDate();
  let inicioOffset = primer.getDay() - 1;
  if (inicioOffset < 0) inicioOffset = 6;
  const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  let totalMes = 0;
  for (let d = 1; d <= diasMes; d++) { const t = totalDia(fechaISO(new Date(year, mes, d))); if (t) totalMes += t.total; }

  const presupuesto = presupuestoCtx();
  const alertaPct = parseFloat(state.config.ALERTA_PORCENTAJE || 90);
  const pct = presupuesto > 0 ? (totalMes / presupuesto) * 100 : 0;
  let estadoBudget = pct >= 100 ? 'over' : pct >= alertaPct ? 'warn' : 'ok';

  let cellsHTML = '';
  for (let i = 0; i < inicioOffset; i++) cellsHTML += `<div class="cal-day empty"></div>`;
  for (let d = 1; d <= diasMes; d++) {
    const fechaObj = new Date(year, mes, d);
    const f = fechaISO(fechaObj);
    const dow = fechaObj.getDay();
    const esFinde = dow === 0 || dow === 6;
    const esFestivo = !!state.festivos[f];
    const t = totalDia(f);
    const turnosUnicos = [...new Set(asignacionesDe(f).map(a => a.turno))];
    const noDispCount = empleadosNoDisponiblesEn(f).length;
    const avisos = avisosDia(f);
    const nivelAv = nivelMaximoAvisos(avisos);
    cellsHTML += `
      <div class="cal-day ${esFinde ? 'weekend' : ''} ${esFestivo ? 'festivo' : ''}" data-fecha="${f}">
        <div class="cal-day-num">
          ${d}
          <span class="cal-icons">
            ${esFestivo ? `<span class="fest-tag" title="${escapeHtml(state.festivos[f])}">★</span>` : ''}
            ${nivelAv ? `<span class="aviso-tag aviso-${nivelAv}" title="${avisos.length} aviso(s)">!</span>` : ''}
            ${noDispCount > 0 ? `<span class="disp-tag">${noDispCount}</span>` : ''}
          </span>
        </div>
        <div class="cal-day-shifts">
          ${turnosUnicos.map(tt => `<span class="turno-pill" style="background:${turnoColors[tt] || '#888'}">${tt}</span>`).join('')}
        </div>
        ${t ? `<div class="cal-day-cost">${divisa(t.total)}</div>` : `<div class="cal-day-cost empty">—</div>`}
      </div>`;
  }

  main.innerHTML = `
    <div class="cal-header">
      <button class="nav-mes" id="prev-mes">‹</button>
      <h2>${meses[mes]} ${year}</h2>
      <button class="nav-mes" id="next-mes">›</button>
    </div>
    ${presupuesto > 0 ? `
      <div class="budget-bar budget-${estadoBudget}">
        <div class="budget-info">
          <span>Coste: <strong>${divisa(totalMes)}</strong></span>
          <span>Presupuesto: <strong>${divisa(presupuesto)}</strong> (${pct.toFixed(1)}%)</span>
        </div>
        <div class="budget-progress"><div style="width:${Math.min(pct, 100)}%"></div></div>
        ${estadoBudget === 'over' ? `<div class="budget-alert">⚠ Presupuesto superado en ${divisa(totalMes - presupuesto)}</div>` : ''}
      </div>`: ''}
    <div class="cal-grid">
      <div class="cal-dow">Lun</div><div class="cal-dow">Mar</div><div class="cal-dow">Mié</div>
      <div class="cal-dow">Jue</div><div class="cal-dow">Vie</div><div class="cal-dow">Sáb</div><div class="cal-dow">Dom</div>
      ${cellsHTML}
    </div>`;

  document.getElementById('prev-mes').addEventListener('click', () => { state.cursorMes = new Date(year, mes - 1, 1); render(); });
  document.getElementById('next-mes').addEventListener('click', () => { state.cursorMes = new Date(year, mes + 1, 1); render(); });
  document.querySelectorAll('.cal-day[data-fecha]').forEach(el => {
    el.addEventListener('click', () => { if (!soloLectura) abrirModalDia(el.dataset.fecha); });
  });
}

/* =====================================================================
   MODAL DE DÍA
   ===================================================================== */
function abrirModalDia(fecha) {
  const draft = asignacionesDe(fecha).map(a => ({ ...a }));
  renderModalDia(fecha, draft);
}

function renderModalDia(fecha, draft) {
  const fechaObj = parseISO(fecha);
  const fechaTxt = fechaObj.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const esFestivo = !!state.festivos[fecha];
  const empById = {}; state.empleados.forEach(e => empById[e.id] = e);
  const avisos = calcularAvisosSobreDraft(fecha, draft);
  const outlet = ctxOutlet();

  let totalPersonal = 0;
  const filasPorDept = { FOH: [], BOH: [], SIN: [] };

  draft.forEach((a, idx) => {
    const emp = empById[a.empleado_id];
    if (!emp) return;
    const c = calcularCoste(a, emp, esFestivo);
    totalPersonal += c.total;
    const noDisp = empleadoNoDisponible(a.empleado_id, fecha);
    const dept = deptDeEmpleado(a.empleado_id) || 'SIN';
    const tieneHorario = !!(a.hora_inicio && a.hora_fin);
    const alertaH = parseFloat(state.config.ALERTA_HORAS_TURNO || 8);
    const html = `
      <tr ${noDisp ? 'class="row-warning"' : ''}>
        <td>
          ${escapeHtml(emp.nombre)} <span class="puesto">${escapeHtml(emp.puesto || '')}</span>
          ${noDisp ? `<span class="disp-badge" style="background:${tipoDispColor(noDisp.tipo)}">${tipoDispLabel(noDisp.tipo)}</span>` : ''}
        </td>
        <td>
          <select data-idx="${idx}" data-field="turno">
            ${turnosOrden.filter(t => emp.turnos_permitidos.split('|').includes(t))
        .map(t => `<option value="${t}" ${t === a.turno ? 'selected' : ''}>${t} – ${escapeHtml(turnoNombres[t])}</option>`).join('')}
          </select>
        </td>
        <td>
          <div class="horario-wrap">
            <input type="time" class="time-input" data-idx="${idx}" data-field="hora_inicio" value="${a.hora_inicio || ''}">
            <span class="time-sep">→</span>
            <input type="time" class="time-input" data-idx="${idx}" data-field="hora_fin" value="${a.hora_fin || ''}">
            ${tieneHorario
        ? `<span class="horas-badge" style="${a.horas > alertaH ? 'background:var(--color-alerta)' : ''}">${parseFloat(a.horas).toFixed(1)}h</span>`
        : `<span class="horas-badge" style="background:var(--muted)">${parseFloat(a.horas).toFixed(1)}h</span>`
      }
          </div>
        </td>
        <td>${emp.coste_hora.toFixed(2)} ${state.config.DIVISA || '€'}</td>
        <td class="t-right">${divisa(c.total)}<br><span class="extras">${c.plusN > 0 ? `+N ${divisa(c.plusN)}` : ''} ${c.plusF > 0 ? `+F ${divisa(c.plusF)}` : ''}</span></td>
        <td><button class="btn-mini btn-del" data-idx="${idx}">×</button></td>
      </tr>`;
    filasPorDept[dept].push(html);
  });

  const mostrarPorDept = outlet && (filasPorDept.FOH.length > 0 || filasPorDept.BOH.length > 0);
  let tablaHTML = '';
  if (draft.length === 0) {
    tablaHTML = `<div class="empty-state">No hay personal asignado para este día.</div>`;
  } else {
    tablaHTML = `<table class="tabla-dia">
      <thead><tr><th>Empleado</th><th>Turno</th><th>Entrada → Salida</th><th>€/h</th><th class="t-right">Coste</th><th></th></tr></thead>
      <tbody>`;
    if (mostrarPorDept) {
      if (filasPorDept.FOH.length > 0) tablaHTML += `<tr class="tabla-emp-group-header"><td colspan="6"><span class="dept-badge foh" style="font-size:11px;padding:2px 8px">FOH</span></td></tr>` + filasPorDept.FOH.join('');
      if (filasPorDept.BOH.length > 0) tablaHTML += `<tr class="tabla-emp-group-header"><td colspan="6"><span class="dept-badge boh" style="font-size:11px;padding:2px 8px">BOH</span></td></tr>` + filasPorDept.BOH.join('');
    } else {
      tablaHTML += [...filasPorDept.FOH, ...filasPorDept.BOH, ...filasPorDept.SIN].join('');
    }
    tablaHTML += `</tbody></table>`;
  }

  const yaAsignados = new Set(draft.map(a => a.empleado_id));
  const disponibles = empleadosEnContexto().filter(e => !yaAsignados.has(e.id) && !empleadoNoDisponible(e.id, fecha));
  const noDispCount = empleadosEnContexto().filter(e => !yaAsignados.has(e.id) && empleadoNoDisponible(e.id, fecha)).length;
  const fijo = parseFloat(state.config.COSTE_FIJO_DIARIO || 0);

  // Group available employees by dept for the add-select
  const dispFOH = disponibles.filter(e => deptDeEmpleado(e.id) === 'FOH');
  const dispBOH = disponibles.filter(e => deptDeEmpleado(e.id) === 'BOH');
  const dispSIN = disponibles.filter(e => !deptDeEmpleado(e.id));
  let addOpts = '<option value="">+ Añadir empleado…</option>';
  if (outlet) {
    if (dispFOH.length > 0) addOpts += `<optgroup label="FOH">${dispFOH.map(e => `<option value="${e.id}">${escapeHtml(e.nombre)} (${escapeHtml(e.puesto || '')})</option>`).join('')}</optgroup>`;
    if (dispBOH.length > 0) addOpts += `<optgroup label="BOH">${dispBOH.map(e => `<option value="${e.id}">${escapeHtml(e.nombre)} (${escapeHtml(e.puesto || '')})</option>`).join('')}</optgroup>`;
    if (dispSIN.length > 0) addOpts += `<optgroup label="Sin departamento">${dispSIN.map(e => `<option value="${e.id}">${escapeHtml(e.nombre)}</option>`).join('')}</optgroup>`;
  } else {
    addOpts += disponibles.map(e => `<option value="${e.id}">${escapeHtml(e.nombre)} (${escapeHtml(e.puesto || '')})</option>`).join('');
  }

  document.getElementById('modal-root').innerHTML = `
    <div class="modal-backdrop">
      <div class="modal modal-lg">
        <div class="modal-head">
          <div>
            <h3>${capitalize(fechaTxt)}</h3>
            <div class="modal-head-sub">
              ${outlet ? `<span class="dept-badge ${DEPT_CLASS[state.ctxDept]}" style="font-size:10px;padding:2px 7px">${state.ctxDept === 'ALL' ? 'FOH+BOH' : state.ctxDept}</span>` : ''}
              ${esFestivo ? `<span class="festivo-tag">★ ${escapeHtml(state.festivos[fecha])}</span>` : ''}
            </div>
          </div>
          <button class="modal-x" id="modal-cerrar">×</button>
        </div>
        <div class="modal-body">
          ${avisos.length > 0 ? `<div class="avisos-box">${avisos.map(av => `<div class="aviso-line aviso-${av.nivel}">⚠ ${escapeHtml(av.msg)}</div>`).join('')}</div>` : ''}
          <div class="acciones-dia">
            <button class="btn-sec" id="btn-toggle-festivo">${esFestivo ? 'Quitar festivo' : 'Marcar como festivo'}</button>
            <button class="btn-sec" id="btn-aplicar-plantilla">Aplicar plantilla</button>
            <button class="btn-sec" id="btn-copiar-anterior">Copiar semana anterior</button>
            ${draft.length > 0 ? `<button class="btn-sec" id="btn-guardar-plantilla">Guardar como plantilla</button>` : ''}
          </div>
          ${tablaHTML}
          ${disponibles.length > 0 ? `
            <div class="add-empleado">
              <select id="sel-add-emp">${addOpts}</select>
              ${noDispCount > 0 ? `<div class="muted-small">${noDispCount} empleado${noDispCount > 1 ? 's' : ''} no disponible${noDispCount > 1 ? 's' : ''} este día</div>` : ''}
            </div>`: ''}
          <div class="totales-dia">
            <div><span>Coste personal:</span><strong>${divisa(totalPersonal)}</strong></div>
            <div><span>Coste fijo diario:</span><strong>${divisa(fijo)}</strong></div>
            <div class="total-grande"><span>TOTAL DÍA:</span><strong>${divisa(totalPersonal + fijo)}</strong></div>
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn-sec" id="btn-cancelar">Cancelar</button>
          <button class="btn-pri" id="btn-guardar">Guardar</button>
        </div>
      </div>
    </div>`;

  document.getElementById('modal-cerrar').addEventListener('click', cerrarModal);
  document.getElementById('btn-cancelar').addEventListener('click', cerrarModal);
  document.getElementById('btn-guardar').addEventListener('click', () => guardarDia(fecha, draft));
  document.getElementById('btn-toggle-festivo').addEventListener('click', () => toggleFestivo(fecha, draft));
  document.getElementById('btn-aplicar-plantilla').addEventListener('click', () => aplicarPlantillaModal(fecha, draft));
  document.getElementById('btn-copiar-anterior').addEventListener('click', () => copiarSemanaAnterior(fecha, draft));
  const btnGP = document.getElementById('btn-guardar-plantilla');
  if (btnGP) btnGP.addEventListener('click', () => guardarComoPlantilla(draft));

  document.querySelectorAll('select[data-field], input[data-field]').forEach(el => {
    el.addEventListener('change', () => {
      const idx = parseInt(el.dataset.idx);
      const field = el.dataset.field;
      if (field === 'turno') {
        draft[idx].turno = el.value;
        const defs = horasDefaultDeTurno(el.value);
        if (defs.hora_inicio && defs.hora_fin) { draft[idx].hora_inicio = defs.hora_inicio; draft[idx].hora_fin = defs.hora_fin; draft[idx].horas = calcularHorasRango(defs.hora_inicio, defs.hora_fin); }
      } else if (field === 'hora_inicio') {
        draft[idx].hora_inicio = el.value;
        if (el.value && draft[idx].hora_fin) draft[idx].horas = calcularHorasRango(el.value, draft[idx].hora_fin);
      } else if (field === 'hora_fin') {
        draft[idx].hora_fin = el.value;
        if (draft[idx].hora_inicio && el.value) draft[idx].horas = calcularHorasRango(draft[idx].hora_inicio, el.value);
      }
      renderModalDia(fecha, draft);
    });
  });
  document.querySelectorAll('.btn-del').forEach(b => {
    b.addEventListener('click', () => { draft.splice(parseInt(b.dataset.idx), 1); renderModalDia(fecha, draft); });
  });
  const sel = document.getElementById('sel-add-emp');
  if (sel) {
    sel.addEventListener('change', () => {
      const id = parseInt(sel.value); if (!id) return;
      const emp = state.empleados.find(e => e.id === id);
      const turnoDefault = (emp.turnos_permitidos.split('|')[0]) || turnosOrden[0];
      const defs = horasDefaultDeTurno(turnoDefault);
      const horas = (defs.hora_inicio && defs.hora_fin) ? calcularHorasRango(defs.hora_inicio, defs.hora_fin) : (turnoHoras[turnoDefault] || 8);
      draft.push({ fecha, empleado_id: id, turno: turnoDefault, horas, hora_inicio: defs.hora_inicio || '', hora_fin: defs.hora_fin || '' });
      renderModalDia(fecha, draft);
    });
  }
}

function cerrarModal() { document.getElementById('modal-root').innerHTML = ''; }

async function guardarDia(fecha, draft) {
  try {
    // Borrar planificacion del dia por fecha (where)
    const { error: delErr } = await supabase.from('planificacion').delete().eq('fecha', fecha);
    if (delErr) throw delErr;
    if (draft.length > 0) {
      const rows = draft.map(a => ({ fecha, empleado_id: a.empleado_id, turno: a.turno, horas: a.horas, hora_inicio: a.hora_inicio || null, hora_fin: a.hora_fin || null }));
      const { error: insErr } = await supabase.from('planificacion').insert(rows);
      if (insErr) throw insErr;
    }
    state.planificacion = state.planificacion.filter(a => a.fecha !== fecha);
    draft.forEach(a => state.planificacion.push({ ...a, fecha }));
    cerrarModal(); render(); toast('Guardado', 'success');
  } catch (e) { toast('Error: ' + e.message, 'error'); }
}

async function toggleFestivo(fecha, draft) {
  try {
    if (state.festivos[fecha]) {
      const { error } = await supabase.from('festivos').delete().eq('fecha', fecha);
      if (error) throw error;
      delete state.festivos[fecha];
    } else {
      const { error } = await supabase.from('festivos').insert([{ fecha, nombre: 'Día festivo' }]);
      if (error) throw error;
      state.festivos[fecha] = 'Día festivo';
    }
    renderModalDia(fecha, draft);
  } catch (e) { toast('Error: ' + e.message, 'error'); }
}

function aplicarPlantillaModal(fecha, draft) {
  if (state.plantillas.length === 0) { toast('No tienes plantillas guardadas', ''); return; }
  const root = document.getElementById('modal-root');
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop'; wrap.style.zIndex = 110;
  wrap.innerHTML = `
    <div class="modal">
      <div class="modal-head"><h3>Aplicar plantilla</h3><button class="modal-x" data-cerrar>×</button></div>
      <div class="modal-body">
        <p class="muted-small">Se sustituirán las asignaciones actuales.</p>
        <div class="lista-plantillas">
          ${state.plantillas.map(p => `<button class="plantilla-item" data-id="${p.id}"><strong>${escapeHtml(p.nombre)}</strong><span>${(p.asignaciones || []).length} asignaciones</span></button>`).join('')}
        </div>
      </div>
    </div>`;
  root.appendChild(wrap);
  wrap.querySelector('[data-cerrar]').addEventListener('click', () => wrap.remove());
  wrap.addEventListener('click', e => { if (e.target === wrap) wrap.remove(); });
  wrap.querySelectorAll('.plantilla-item').forEach(b => {
    b.addEventListener('click', () => {
      const p = state.plantillas.find(x => x.id === parseInt(b.dataset.id));
      draft.length = 0;
      (p.asignaciones || []).forEach(a => {
        const emp = state.empleados.find(e => e.id === a.empleado_id);
        if (!emp || empleadoNoDisponible(emp.id, fecha)) return;
        draft.push({ fecha, empleado_id: a.empleado_id, turno: a.turno, horas: parseFloat(a.horas) });
      });
      wrap.remove(); renderModalDia(fecha, draft); toast('Plantilla aplicada', '');
    });
  });
}

function copiarSemanaAnterior(fecha, draft) {
  const fechaPrev = sumarDias(fecha, -7);
  const asigsPrev = state.planificacion.filter(a => a.fecha === fechaPrev);
  if (asigsPrev.length === 0) { toast(`Sin asignaciones en ${fechaPrev}`, ''); return; }
  if (draft.length > 0 && !confirm(`Sustituir ${draft.length} asignaciones por las del ${fechaPrev}?`)) return;
  draft.length = 0;
  asigsPrev.forEach(a => {
    const emp = state.empleados.find(e => e.id === a.empleado_id);
    if (!emp || empleadoNoDisponible(emp.id, fecha)) return;
    draft.push({ fecha, empleado_id: a.empleado_id, turno: a.turno, horas: a.horas });
  });
  renderModalDia(fecha, draft); toast('Copiado de semana anterior', '');
}

async function guardarComoPlantilla(draft) {
  const nombre = prompt('Nombre de la plantilla:');
  if (!nombre || !nombre.trim()) return;
  try {
    const asigs = draft.map(a => ({ empleado_id: a.empleado_id, turno: a.turno, horas: a.horas }));
    const { data, error } = await supabase.from('plantillas').insert([{ nombre: nombre.trim(), asignaciones: asigs }]).select().single();
    if (error) throw error;
    state.plantillas.push(data); state.plantillas.sort((a, b) => a.nombre.localeCompare(b.nombre));
    toast('Plantilla guardada', 'success');
  } catch (e) { toast('Error: ' + e.message, 'error'); }
}

/* =====================================================================
   VISTA SEMANA
   ===================================================================== */
function renderSemana(soloLectura = false) {
  const main = document.getElementById('main');
  const lunes = state.cursorSemana;
  const dias = diasSemana(lunes);
  const finSem = dias[6];
  const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const tituloSemana = `${lunes.getDate()} ${meses[lunes.getMonth()]} – ${finSem.getDate()} ${meses[finSem.getMonth()]} ${finSem.getFullYear()}`;
  const empCtx = empleadosEnContexto();
  const outlet = ctxOutlet();

  let totalSemana = 0;
  const totalesPorDia = dias.map(d => { const t = totalDia(fechaISO(d)); const v = t ? t.total : 0; totalSemana += v; return v; });

  // Group employees by dept if we have an outlet
  const empleadosPorDept = outlet ? {
    FOH: empCtx.filter(e => deptDeEmpleado(e.id) === 'FOH'),
    BOH: empCtx.filter(e => deptDeEmpleado(e.id) === 'BOH'),
  } : { SIN: empCtx };

  const dowLabels = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

  const renderEmpRows = (emps) => emps.map(emp => {
    const cells = dias.map(d => {
      const f = fechaISO(d);
      const a = state.planificacion.find(x => x.fecha === f && x.empleado_id === emp.id);
      const noDisp = empleadoNoDisponible(emp.id, f);
      return { f, a, noDisp };
    });
    let horas = 0, total = 0;
    cells.forEach(c => { if (c.a) { horas += c.a.horas; total += calcularCoste(c.a, emp, !!state.festivos[c.f]).total; } });
    return `<tr>
      <td class="emp-col"><strong>${escapeHtml(emp.nombre)}</strong><span class="puesto">${escapeHtml(emp.puesto || '')}</span></td>
      ${cells.map(c => {
      const dow = parseISO(c.f).getDay(); const finde = dow === 0 || dow === 6; const fest = !!state.festivos[c.f];
      return `<td class="cell-sem ${c.noDisp ? 'cell-disp' : ''}" data-fecha="${c.f}" data-emp="${emp.id}">
          ${c.noDisp ? `<span class="disp-mini" style="background:${tipoDispColor(c.noDisp.tipo)}" title="${tipoDispLabel(c.noDisp.tipo)}">${tipoDispLabel(c.noDisp.tipo)[0]}</span>`
          : c.a ? `<span class="turno-pill" style="background:${turnoColors[c.a.turno] || '#888'}">${c.a.turno}</span><br><small>${c.a.horas}h</small>`
            : `<span class="cell-empty">+</span>`}
        </td>`;
    }).join('')}
      <td class="t-right">${horas.toFixed(1)}</td>
      <td class="t-right">${divisa(total)}</td>
    </tr>`;
  }).join('');

  const deptRows = Object.entries(empleadosPorDept).map(([dept, emps]) => {
    if (emps.length === 0) return '';
    const deptHeader = outlet && dept !== 'SIN' ? `
      <tr class="dept-row-header">
        <td colspan="${9}"><span class="dept-badge ${DEPT_CLASS[dept]}" style="font-size:11px;padding:2px 8px">${dept}</span> ${DEPT_LABELS[dept]}</td>
      </tr>` : '';
    return deptHeader + renderEmpRows(emps);
  }).join('');

  main.innerHTML = `
    <div class="cal-header">
      <button class="nav-mes" id="prev-sem">‹</button>
      <h2>Semana ${tituloSemana}</h2>
      <button class="nav-mes" id="next-sem">›</button>
      <button class="btn-sec" id="hoy-sem" style="margin-left:8px">Hoy</button>
      <button class="btn-pri" id="btn-pdf-sem" style="margin-left:auto">📄 PDF</button>
    </div>
    <div class="tabla-semana-wrap">
      <table class="tabla-semana">
        <thead><tr>
          <th class="emp-col">Empleado</th>
          ${dias.map(d => { const f = fechaISO(d); const fest = state.festivos[f]; const dow = d.getDay(); const finde = dow === 0 || dow === 6; return `<th class="${finde ? 'col-finde' : ''} ${fest ? 'col-festivo' : ''}">${dowLabels[dow]}<br><small>${d.getDate()}</small></th>`; }).join('')}
          <th>Σ h</th><th>Σ €</th>
        </tr></thead>
        <tbody>${deptRows}</tbody>
        <tfoot><tr>
          <td class="emp-col"><strong>Total día</strong></td>
          ${totalesPorDia.map(v => `<td class="t-right"><strong>${v > 0 ? divisa(v) : '—'}</strong></td>`).join('')}
          <td></td><td class="t-right"><strong>${divisa(totalSemana)}</strong></td>
        </tr></tfoot>
      </table>
    </div>
    <p class="muted-small">Click en una celda para editar.</p>`;

  document.getElementById('prev-sem').addEventListener('click', () => { state.cursorSemana = sumarDiasDate(state.cursorSemana, -7); render(); });
  document.getElementById('next-sem').addEventListener('click', () => { state.cursorSemana = sumarDiasDate(state.cursorSemana, 7); render(); });
  document.getElementById('hoy-sem').addEventListener('click', () => { state.cursorSemana = lunesDe(new Date()); render(); });
  document.getElementById('btn-pdf-sem').addEventListener('click', exportarPDFSemana);

  document.querySelectorAll('.cell-sem').forEach(td => {
    td.addEventListener('click', () => abrirModalCelda(td.dataset.fecha, parseInt(td.dataset.emp)));
  });
}

function abrirModalCelda(fecha, empId) {
  const emp = state.empleados.find(e => e.id === empId); if (!emp) return;
  const noDisp = empleadoNoDisponible(empId, fecha);
  const actual = state.planificacion.find(a => a.fecha === fecha && a.empleado_id === empId);
  const turnoBase = actual?.turno || (emp.turnos_permitidos.split('|')[0] || turnosOrden[0]);
  let defIni = actual?.hora_inicio || '', defFin = actual?.hora_fin || '';
  if (!defIni && !defFin) { const d = horasDefaultDeTurno(turnoBase); defIni = d.hora_inicio; defFin = d.hora_fin; }
  const tieneHorario = !!(defIni && defFin);
  const horasCalc = tieneHorario ? calcularHorasRango(defIni, defFin) : (actual?.horas || turnoHoras[turnoBase] || 8);
  const alertaH = parseFloat(state.config.ALERTA_HORAS_TURNO || 8);
  const fechaTxt = parseISO(fecha).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  const dept = deptDeEmpleado(empId);

  document.getElementById('modal-root').innerHTML = `
    <div class="modal-backdrop"><div class="modal">
      <div class="modal-head">
        <div>
          <h3>${escapeHtml(emp.nombre)}</h3>
          <div class="modal-head-sub">
            ${dept ? `<span class="dept-badge ${DEPT_CLASS[dept]}" style="font-size:10px;padding:2px 7px">${dept}</span>` : ''}
            <span>${capitalize(fechaTxt)}</span>
          </div>
        </div>
        <button class="modal-x" id="modal-cerrar">×</button>
      </div>
      <div class="modal-body form-grid">
        ${noDisp ? `<div class="aviso-line aviso-rojo">⚠ ${tipoDispLabel(noDisp.tipo)}: ${fmtFecha(noDisp.fecha_inicio)} → ${fmtFecha(noDisp.fecha_fin)}</div>` : ''}
        <label>Turno
          <select id="cell-turno">
            ${turnosOrden.filter(t => emp.turnos_permitidos.split('|').includes(t))
      .map(t => `<option value="${t}" ${t === turnoBase ? 'selected' : ''}>${t} – ${escapeHtml(turnoNombres[t])}</option>`).join('')}
          </select>
        </label>
        <label>Horario
          <div class="horario-wrap" style="margin-top:4px">
            <input type="time" id="cell-hora-ini" class="time-input" value="${defIni}">
            <span class="time-sep">→</span>
            <input type="time" id="cell-hora-fin" class="time-input" value="${defFin}">
            <span id="cell-horas-auto" class="horas-badge" style="${tieneHorario && horasCalc > alertaH ? 'background:var(--color-alerta)' : tieneHorario ? '' : 'background:var(--muted)'}">${horasCalc}h</span>
          </div>
        </label>
      </div>
      <div class="modal-foot">
        ${actual ? `<button class="btn-sec btn-danger" id="btn-quitar" style="margin-right:auto">Quitar</button>` : ''}
        <button class="btn-sec" id="btn-cancelar">Cancelar</button>
        <button class="btn-pri" id="btn-guardar">Guardar</button>
      </div>
    </div></div>`;

  const syncHours = () => {
    const ini = document.getElementById('cell-hora-ini').value;
    const fin = document.getElementById('cell-hora-fin').value;
    const autoEl = document.getElementById('cell-horas-auto');
    const alertaH = parseFloat(state.config.ALERTA_HORAS_TURNO || 8);
    if (ini && fin) { const h = calcularHorasRango(ini, fin); autoEl.textContent = `${h}h`; autoEl.style.background = h > alertaH ? 'var(--color-alerta)' : ''; }
    else { autoEl.textContent = `${turnoHoras[document.getElementById('cell-turno').value] || 8}h`; autoEl.style.background = 'var(--muted)'; }
  };
  document.getElementById('cell-hora-ini').addEventListener('change', syncHours);
  document.getElementById('cell-hora-fin').addEventListener('change', syncHours);
  document.getElementById('cell-turno').addEventListener('change', () => {
    const defs = horasDefaultDeTurno(document.getElementById('cell-turno').value);
    if (defs.hora_inicio) document.getElementById('cell-hora-ini').value = defs.hora_inicio;
    if (defs.hora_fin) document.getElementById('cell-hora-fin').value = defs.hora_fin;
    syncHours();
  });
  document.getElementById('modal-cerrar').addEventListener('click', cerrarModal);
  document.getElementById('btn-cancelar').addEventListener('click', cerrarModal);
  document.getElementById('btn-guardar').addEventListener('click', () => guardarCelda(fecha, empId));
  if (actual) document.getElementById('btn-quitar').addEventListener('click', () => quitarCelda(fecha, empId));
}

async function guardarCelda(fecha, empId) {
  const id = parseInt(empId, 10);
  const turno = document.getElementById('cell-turno').value;
  const horaIni = document.getElementById('cell-hora-ini').value;
  const horaFin = document.getElementById('cell-hora-fin').value;
  const horas = (horaIni && horaFin) ? calcularHorasRango(horaIni, horaFin) : (turnoHoras[turno] || 8);
  if (horas <= 0) { toast('Las horas deben ser >0', 'error'); return; }
  const payload = { turno, horas, hora_inicio: horaIni || null, hora_fin: horaFin || null };
  try {
    const existente = state.planificacion.find(a => a.fecha === fecha && parseInt(a.empleado_id, 10) === id);
    if (existente) {
      const { error } = await supabase.from('planificacion').update(payload).eq('id', existente.id);
      if (error) throw error;
      Object.assign(existente, payload);
    } else {
      // Llamada directa a la API para insertar y obtener el resultado
      const res = await apiCall({ action: 'insert', table: 'planificacion', data: { fecha, empleado_id: id, ...payload } });
      if (res.error) throw new Error(res.error);
      const nuevo = res.data;
      state.planificacion.push({ ...nuevo, empleado_id: parseInt(nuevo.empleado_id, 10), horas: parseFloat(nuevo.horas) });
    }
    cerrarModal(); render(); toast('Guardado', 'success');
  } catch (e) { toast('Error: ' + e.message, 'error'); }
}

async function quitarCelda(fecha, empId) {
  try {
    const id = parseInt(empId, 10);
    const existente = state.planificacion.find(a => a.fecha === fecha && parseInt(a.empleado_id, 10) === id);
    if (!existente) { cerrarModal(); return; }
    const { error } = await supabase.from('planificacion').delete().eq('id', existente.id);
    if (error) throw error;
    state.planificacion = state.planificacion.filter(a => a.id !== existente.id);
    cerrarModal(); render(); toast('Quitado', 'success');
  } catch (e) { toast('Error: ' + e.message, 'error'); }
}

/* =====================================================================
   VISTA RESUMEN MES
   ===================================================================== */
/* =====================================================================
   KPI HELPERS
   ===================================================================== */
function calcularKPIsOutlet(outletId, prefijo) {
  const revenue = parseFloat(state.config[`KPI_REVENUE_${outletId}`] || 0);
  const fohPct = parseFloat(state.config[`KPI_FOH_PCT_${outletId}`] || 0);
  const bohPct = parseFloat(state.config[`KPI_BOH_PCT_${outletId}`] || 0);
  if (!revenue && !fohPct && !bohPct) return null;

  const fohIds = new Set(state.outletEmpleados.filter(oe => oe.outlet_id === outletId && oe.departamento === 'FOH').map(oe => oe.empleado_id));
  const bohIds = new Set(state.outletEmpleados.filter(oe => oe.outlet_id === outletId && oe.departamento === 'BOH').map(oe => oe.empleado_id));

  let fohActual = 0, bohActual = 0;
  state.planificacion.filter(a => a.fecha.startsWith(prefijo)).forEach(a => {
    const emp = state.empleados.find(e => e.id === a.empleado_id); if (!emp) return;
    const c = calcularCoste(a, emp, !!state.festivos[a.fecha]);
    if (fohIds.has(a.empleado_id)) fohActual += c.total;
    if (bohIds.has(a.empleado_id)) bohActual += c.total;
  });

  const fohTarget = revenue * fohPct / 100;
  const bohTarget = revenue * bohPct / 100;
  return { revenue, fohPct, bohPct, fohTarget, bohTarget, fohActual, bohActual };
}

function renderKPIBar(label, dept, actual, target, revenue, pctTarget) {
  if (!target && !pctTarget) return '';
  const pctActual = revenue > 0 ? (actual / revenue * 100) : 0;
  const fillPct = target > 0 ? Math.min(actual / target * 100, 100) : 0;
  const over = target > 0 && actual > target;
  const warn = target > 0 && actual / target >= 0.9 && !over;
  const barColor = over ? 'var(--color-alerta)' : warn ? '#d97706' : 'var(--color-primario)';
  const deptClass = dept === 'FOH' ? 'foh' : 'boh';
  return `
    <div class="kpi-bar-card">
      <div class="kpi-bar-head">
        <span class="dept-badge ${deptClass}" style="font-size:11px;padding:2px 9px">${dept}</span>
        <span class="kpi-bar-label">${label}</span>
        <span class="kpi-bar-nums">
          <strong style="color:${over ? 'var(--color-alerta)' : ''}">${divisa(actual)}</strong>
          <span class="kpi-bar-of">de ${divisa(target)}</span>
          ${over ? `<span class="kpi-over-badge">+${divisa(actual - target)}</span>` : ''}
        </span>
      </div>
      <div class="kpi-bar-track">
        <div class="kpi-bar-fill" style="width:${fillPct}%;background:${barColor}"></div>
        ${target > 0 ? `<div class="kpi-bar-target-line" style="left:100%"></div>` : ''}
      </div>
      <div class="kpi-bar-footer">
        <span>Coste real: <strong>${pctActual.toFixed(1)}%</strong> sobre revenue</span>
        ${pctTarget ? `<span>Objetivo: <strong>${pctTarget}%</strong> · ${(fillPct).toFixed(0)}% del target consumido</span>` : ''}
      </div>
    </div>`;
}

function renderKPIBlock(outletId, prefijo) {
  const kpi = calcularKPIsOutlet(outletId, prefijo);
  if (!kpi) return `
    <div class="kpi-block kpi-block-empty">
      <span>📊</span>
      <div>
        <strong>KPIs no configurados para este local</strong>
        <p>Ve a <strong>Locales → Editar</strong> y rellena el revenue mensual y los porcentajes objetivo de FOH y BOH.</p>
      </div>
      <button class="btn-sec" onclick="state.view='outlets';render()">Ir a Locales →</button>
    </div>`;
  return `
    <div class="kpi-block">
      <div class="kpi-block-head">
        <span class="kpi-block-title">📊 KPIs</span>
        <span class="kpi-block-revenue">Revenue mensual: <strong>${divisa(kpi.revenue)}</strong></span>
      </div>
      ${renderKPIBar('Coste personal FOH', 'FOH', kpi.fohActual, kpi.fohTarget, kpi.revenue, kpi.fohPct)}
      ${renderKPIBar('Coste personal BOH', 'BOH', kpi.bohActual, kpi.bohTarget, kpi.revenue, kpi.bohPct)}
    </div>`;
}

function renderResumenMes() {
  const main = document.getElementById('main');
  const cur = state.cursorMes;
  const year = cur.getFullYear();
  const mes = cur.getMonth();
  const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const prefijo = `${year}-${String(mes + 1).padStart(2, '0')}`;

  const diasM = new Date(year, mes + 1, 0).getDate();
  const dias = [];
  for (let d = 1; d <= diasM; d++) { const f = fechaISO(new Date(year, mes, d)); const t = totalDia(f); if (t) dias.push([f, t]); }

  const totalMes = dias.reduce((s, [, r]) => s + r.total, 0);
  const totalPersonal = dias.reduce((s, [, r]) => s + r.personal, 0);
  const totalFijo = dias.reduce((s, [, r]) => s + r.fijo, 0);
  const presupuesto = presupuestoCtx();
  const empCtx = empleadosEnContexto();
  const outlet = ctxOutlet();

  // Per employee
  const porEmp = {};
  planificacionCtx().filter(a => a.fecha.startsWith(prefijo)).forEach(a => {
    const emp = state.empleados.find(e => e.id === a.empleado_id); if (!emp) return;
    const c = calcularCoste(a, emp, !!state.festivos[a.fecha]);
    if (!porEmp[emp.id]) porEmp[emp.id] = { nombre: emp.nombre, puesto: emp.puesto || '', dept: deptDeEmpleado(emp.id) || '', horas: 0, total: 0 };
    porEmp[emp.id].horas += a.horas; porEmp[emp.id].total += c.total;
  });
  const empOrdenados = Object.values(porEmp).sort((a, b) => b.total - a.total);

  let estadoPres = '';
  if (presupuesto > 0) { if (totalMes > presupuesto) estadoPres = 'over'; else if (totalMes / presupuesto * 100 >= parseFloat(state.config.ALERTA_PORCENTAJE || 90)) estadoPres = 'warn'; }

  main.innerHTML = `
    <div class="cal-header">
      <button class="nav-mes" id="prev-mes">‹</button>
      <h2>Resumen ${meses[mes]} ${year}</h2>
      <button class="nav-mes" id="next-mes">›</button>
    </div>
    <div class="export-bar">
      <span class="muted-small">Exportar:</span>
      <button class="btn-sec" id="btn-pdf-mes">📄 PDF</button>
      <button class="btn-sec" id="btn-xlsx-mes">📊 Excel</button>
      <button class="btn-sec" id="btn-csv-mes">📋 CSV</button>
    </div>
    <div class="kpi-grid">
      <div class="kpi"><span>Días planificados</span><strong>${dias.length}</strong></div>
      <div class="kpi"><span>Empleados activos</span><strong>${empCtx.length}</strong></div>
      <div class="kpi"><span>Coste personal</span><strong>${divisa(totalPersonal)}</strong></div>
      <div class="kpi"><span>Coste fijo</span><strong>${divisa(totalFijo)}</strong></div>
      <div class="kpi kpi-total"><span>TOTAL MES</span><strong>${divisa(totalMes)}</strong></div>
    </div>
    ${presupuesto > 0 ? `
      <div class="presupuesto-box ${estadoPres}">
        <div>Presupuesto: <strong>${divisa(presupuesto)}</strong></div>
        <div>Diferencia: <strong>${divisa(presupuesto - totalMes)}</strong></div>
        <div>${(totalMes / presupuesto * 100).toFixed(1)}% consumido</div>
      </div>`: ''}
    ${outlet ? renderKPIBlock(outlet.id, prefijo) : ''}
    <h3>Coste diario</h3>
    <div class="grafica-dias">
      ${dias.length === 0 ? '<div class="empty-state" style="width:100%">Sin datos</div>' :
      (() => {
        const mx = Math.max(...dias.map(([, r]) => r.total));
        return dias.map(([f, r]) => {
          const fobj = parseISO(f); const h = mx > 0 ? (r.total / mx * 100) : 0;
          return `<div class="bar-col" title="${f} – ${divisa(r.total)}">
              <div class="bar" style="height:${h}%;background:${state.festivos[f] ? 'var(--color-alerta)' : 'var(--color-primario)'}"></div>
              <span class="bar-label">${fobj.getDate()}</span>
            </div>`;
        }).join('');
      })()}
    </div>
    <h3>Por empleado ${outlet ? `<span style="font-size:12px;color:var(--muted);font-weight:400">(${outlet.nombre} · ${state.ctxDept === 'ALL' ? 'FOH+BOH' : state.ctxDept})</span>` : ''}
    </h3>
    ${empOrdenados.length === 0 ? '<div class="empty-state">Sin asignaciones</div>' : `
      <table class="tabla-emp">
        <thead><tr><th>Empleado</th><th>Puesto</th>${outlet ? '<th>Dept</th>' : ''}<th>Horas</th><th class="t-right">Total</th></tr></thead>
        <tbody>${empOrdenados.map(e => `
          <tr>
            <td>${escapeHtml(e.nombre)}</td>
            <td>${escapeHtml(e.puesto)}</td>
            ${outlet ? `<td><span class="dept-badge ${DEPT_CLASS[e.dept] || 'all'}" style="font-size:10px;padding:1px 6px">${e.dept || '—'}</span></td>` : ''}
            <td>${e.horas.toFixed(1)}</td>
            <td class="t-right">${divisa(e.total)}</td>
          </tr>`).join('')}
        </tbody>
      </table>`}`;

  document.getElementById('prev-mes').addEventListener('click', () => { state.cursorMes = new Date(year, mes - 1, 1); render(); });
  document.getElementById('next-mes').addEventListener('click', () => { state.cursorMes = new Date(year, mes + 1, 1); render(); });
  document.getElementById('btn-pdf-mes').addEventListener('click', exportarPDFMes);
  document.getElementById('btn-xlsx-mes').addEventListener('click', exportarExcelMes);
  document.getElementById('btn-csv-mes').addEventListener('click', exportarCSVMes);
}

/* =====================================================================
   VISTA EMPLEADOS
   ===================================================================== */
function renderEmpleados() {
  const main = document.getElementById('main');
  // Filtrar por contexto si lo hay
  const empsVis = state.ctxOutletId ? empleadosEnContexto() : state.empleados;
  const outlet = ctxOutlet();

  main.innerHTML = `
    <div class="seccion-header">
      <h2>Empleados ${outlet ? `<span style="font-size:13px;color:var(--muted);font-weight:400">— ${outlet.nombre} ${state.ctxDept !== 'ALL' ? state.ctxDept : ''}</span>` : '(todos los locales)'}</h2>
      <button class="btn-pri" id="btn-nuevo-emp">+ Nuevo empleado</button>
    </div>
    ${!outlet ? `<div class="info">Selecciona un local en la barra superior para ver y gestionar solo sus empleados. Aquí se muestran todos.</div>` : ''}
    <table class="tabla-emp">
      <thead><tr><th>Nombre</th><th>Puesto</th><th>Locales / Dept</th><th>€/hora</th><th>Turnos</th><th></th></tr></thead>
      <tbody>
        ${empsVis.map(e => {
    const outletDepts = state.outletEmpleados.filter(oe => oe.empleado_id === e.id).map(oe => {
      const out = state.outlets.find(o => o.id === oe.outlet_id);
      return `<span class="dept-badge ${DEPT_CLASS[oe.departamento]}" style="font-size:10px;padding:1px 6px;margin-right:3px">${out ? escapeHtml(out.nombre.substring(0, 8)) : oe.outlet_id} · ${oe.departamento}</span>`;
    }).join('');
    return `<tr>
            <td>${escapeHtml(e.nombre)}</td>
            <td>${escapeHtml(e.puesto || '')}</td>
            <td>${outletDepts || '<em style="color:var(--muted);font-size:12px">Sin asignar</em>'}</td>
            <td>${e.coste_hora.toFixed(2)}</td>
            <td>${escapeHtml(e.turnos_permitidos)}</td>
            <td class="t-right">
              <button class="btn-mini" data-edit="${e.id}">Editar</button>
              <button class="btn-mini btn-danger" data-del="${e.id}">Borrar</button>
            </td>
          </tr>`;
  }).join('')}
      </tbody>
    </table>`;

  document.getElementById('btn-nuevo-emp').addEventListener('click', () => abrirModalEmpleado(null));
  document.querySelectorAll('[data-edit]').forEach(b => {
    b.addEventListener('click', () => abrirModalEmpleado(state.empleados.find(e => e.id === parseInt(b.dataset.edit))));
  });
  document.querySelectorAll('[data-del]').forEach(b => {
    b.addEventListener('click', async () => {
      const id = parseInt(b.dataset.del);
      const emp = state.empleados.find(e => e.id === id);
      if (!confirm(`¿Borrar a ${emp.nombre}?`)) return;
      try {
        const { error } = await supabase.from('empleados').update({ activo: false }).eq('id', id);
        if (error) throw error;
        // Remove from outlet_empleados locally
        state.outletEmpleados = state.outletEmpleados.filter(oe => oe.empleado_id !== id);
        state.empleados = state.empleados.filter(e => e.id !== id);
        render(); toast('Empleado eliminado', 'success');
      } catch (e) { toast('Error: ' + e.message, 'error'); }
    });
  });
}

function abrirModalEmpleado(emp) {
  const esNuevo = !emp;
  emp = emp || { nombre: '', puesto: '', coste_hora: 0, turnos_permitidos: turnosOrden.join('|'), max_horas_semana: 40 };

  // Current outlet-dept assignments for this employee
  const asignActuales = emp.id ? state.outletEmpleados.filter(oe => oe.empleado_id === emp.id) : [];

  document.getElementById('modal-root').innerHTML = `
    <div class="modal-backdrop"><div class="modal" style="max-width:560px">
      <div class="modal-head">
        <h3>${esNuevo ? 'Nuevo empleado' : 'Editar empleado'}</h3>
        <button class="modal-x" id="modal-cerrar">×</button>
      </div>
      <div class="modal-body form-grid">
        <div class="form-row">
          <label>Nombre <input type="text" id="emp-nombre" value="${escapeHtml(emp.nombre)}"></label>
          <label>Puesto <input type="text" id="emp-puesto" value="${escapeHtml(emp.puesto || '')}"></label>
        </div>
        <div class="form-row">
          <label>Coste por hora <input type="number" step="0.01" id="emp-coste" value="${emp.coste_hora}"></label>
          <label>Máx horas/semana <input type="number" step="0.5" id="emp-max-horas" value="${emp.max_horas_semana || 40}"></label>
        </div>
        <label>Turnos permitidos
          <div class="turnos-check">
            ${turnosOrden.map(t => `<label class="check"><input type="checkbox" value="${t}" ${(emp.turnos_permitidos || '').split('|').includes(t) ? 'checked' : ''}> ${t} – ${escapeHtml(turnoNombres[t])}</label>`).join('')}
          </div>
        </label>
        <label>Locales y departamentos
          <div class="outlet-dept-list" id="outlet-dept-list">
            ${state.outlets.length === 0 ? '<p class="muted-small" style="padding:8px">No hay locales creados todavía.</p>' :
      state.outlets.flatMap(o => DEPTS.map(d => {
        const checked = asignActuales.some(oe => oe.outlet_id === o.id && oe.departamento === d);
        return `<label class="outlet-dept-item">
                  <input type="checkbox" data-outlet="${o.id}" data-dept="${d}" ${checked ? 'checked' : ''}>
                  <span class="outlet-dept-item-info">
                    <span class="outlet-dept-item-name">${o.icono || ''} ${escapeHtml(o.nombre)}</span>
                    <span class="outlet-dept-item-dept dept-badge ${DEPT_CLASS[d]}" style="font-size:10px;padding:1px 7px">${d} – ${DEPT_LABELS[d]}</span>
                  </span>
                </label>`;
      })).join('')}
          </div>
        </label>
      </div>
      <div class="modal-foot">
        <button class="btn-sec" id="btn-cancelar">Cancelar</button>
        <button class="btn-pri" id="btn-guardar">${esNuevo ? 'Crear' : 'Guardar'}</button>
      </div>
    </div></div>`;

  document.getElementById('modal-cerrar').addEventListener('click', cerrarModal);
  document.getElementById('btn-cancelar').addEventListener('click', cerrarModal);
  document.getElementById('btn-guardar').addEventListener('click', async () => {
    const turnosSel = [...document.querySelectorAll('.turnos-check input:checked')].map(c => c.value).join('|');
    const payload = {
      nombre: document.getElementById('emp-nombre').value.trim(),
      puesto: document.getElementById('emp-puesto').value.trim(),
      coste_hora: parseFloat(document.getElementById('emp-coste').value) || 0,
      max_horas_semana: parseFloat(document.getElementById('emp-max-horas').value) || 40,
      turnos_permitidos: turnosSel || 'M',
    };
    if (!payload.nombre) { toast('El nombre es obligatorio', 'error'); return; }

    // Collect outlet-dept checkboxes
    const selAsigs = [...document.querySelectorAll('#outlet-dept-list input[type=checkbox]:checked')]
      .map(cb => ({ outlet_id: parseInt(cb.dataset.outlet), departamento: cb.dataset.dept }));

    try {
      let empId = emp.id;
      if (esNuevo) {
        const { data, error } = await supabase.from('empleados').insert([payload]).select().single();
        if (error) throw error;
        empId = data.id;
        state.empleados.push({ ...data, coste_hora: parseFloat(data.coste_hora), max_horas_semana: parseFloat(data.max_horas_semana || 40) });
      } else {
        const { data, error } = await supabase.from('empleados').update(payload).eq('id', emp.id).select().single();
        if (error) throw error;
        const idx = state.empleados.findIndex(e => e.id === emp.id);
        state.empleados[idx] = { ...data, coste_hora: parseFloat(data.coste_hora), max_horas_semana: parseFloat(data.max_horas_semana || 40) };
      }

      // Sync outlet_empleados: delete existing then insert new
      const { error: delOE } = await supabase.from('outlet_empleados').delete().eq('empleado_id', empId);
      if (delOE) throw delOE;
      state.outletEmpleados = state.outletEmpleados.filter(oe => oe.empleado_id !== empId);

      if (selAsigs.length > 0) {
        const rows = selAsigs.map(a => ({ empleado_id: empId, ...a }));
        const { data: oeData, error: oeErr } = await supabase.from('outlet_empleados').insert(rows).select();
        if (oeErr) throw oeErr;
        state.outletEmpleados.push(...oeData);
      }

      state.empleados.sort((a, b) => a.nombre.localeCompare(b.nombre));
      cerrarModal(); render(); toast('Guardado', 'success');
    } catch (e) { toast('Error: ' + e.message, 'error'); }
  });
}

/* =====================================================================
   VISTA DISPONIBILIDAD
   ===================================================================== */
function renderDisponibilidad() {
  const main = document.getElementById('main');
  const empsVis = state.ctxOutletId ? empleadosEnContexto() : state.empleados;
  const porEmp = {};
  empsVis.forEach(e => porEmp[e.id] = []);
  state.disponibilidad.forEach(d => { if (porEmp[d.empleado_id] !== undefined) porEmp[d.empleado_id].push(d); });
  Object.values(porEmp).forEach(arr => arr.sort((a, b) => a.fecha_inicio.localeCompare(b.fecha_inicio)));

  main.innerHTML = `
    <div class="seccion-header">
      <h2>Disponibilidad</h2>
    </div>
    <p class="info" style="margin-bottom:16px">Vacaciones, bajas y ausencias. Los empleados con periodo activo no aparecerán al asignar turnos en esa fecha.</p>
    <div class="disp-grid">
      ${empsVis.map(emp => {
    const dept = deptDeEmpleado(emp.id);
    const periodos = porEmp[emp.id] || [];
    return `<div class="disp-card">
          <div class="disp-card-head">
            <div class="disp-card-info">
              <strong>${escapeHtml(emp.nombre)}</strong>
              <span class="puesto">${escapeHtml(emp.puesto || '')}</span>
              ${dept ? `<span class="dept-badge ${DEPT_CLASS[dept]}" style="font-size:10px;padding:1px 6px">${dept}</span>` : ''}
            </div>
            <button class="disp-add-btn" data-emp-id="${emp.id}" title="Añadir periodo">+</button>
          </div>
          <div class="disp-card-body">
            ${periodos.length === 0
        ? `<div class="disp-card-empty">Sin ausencias</div>`
        : periodos.map(d => `
                <div class="disp-pill-row">
                  <span class="disp-tipo" style="background:${tipoDispColor(d.tipo)};font-size:9px;padding:1px 6px">${tipoDispLabel(d.tipo)}</span>
                  <span class="disp-rango" style="font-size:11px">${fmtFecha(d.fecha_inicio)} → ${fmtFecha(d.fecha_fin)}</span>
                  ${d.nota ? `<span class="disp-nota" style="font-size:10px">${escapeHtml(d.nota)}</span>` : ''}
                  <button class="disp-del-btn" data-del-disp="${d.id}" title="Eliminar">×</button>
                </div>`).join('')
      }
          </div>
        </div>`;
  }).join('')}
    </div>`;

  document.querySelectorAll('.disp-add-btn').forEach(b => {
    b.addEventListener('click', () => abrirModalDisponibilidad(empsVis, parseInt(b.dataset.empId)));
  });
  document.querySelectorAll('[data-del-disp]').forEach(b => {
    b.addEventListener('click', async () => {
      const id = parseInt(b.dataset.delDisp);
      if (!confirm('¿Eliminar este periodo?')) return;
      try {
        const { error } = await supabase.from('disponibilidad').delete().eq('id', id);
        if (error) throw error;
        state.disponibilidad = state.disponibilidad.filter(d => d.id !== id);
        render(); toast('Eliminado', 'success');
      } catch (e) { toast('Error: ' + e.message, 'error'); }
    });
  });
}

function abrirModalDisponibilidad(empsVis, preselEmpId = null) {
  const hoy = fechaISO(new Date());
  document.getElementById('modal-root').innerHTML = `
    <div class="modal-backdrop"><div class="modal">
      <div class="modal-head">
        <h3>Añadir periodo de ausencia</h3>
        <button class="modal-x" id="modal-cerrar">×</button>
      </div>
      <div class="modal-body form-grid">
        <label>Empleado
          <select id="d-emp">
            ${empsVis.map(e => `<option value="${e.id}" ${e.id === preselEmpId ? 'selected' : ''}>${escapeHtml(e.nombre)}</option>`).join('')}
          </select>
        </label>
        <label>Tipo
          <select id="d-tipo">${Object.entries(TIPOS_DISPONIBILIDAD).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select>
        </label>
        <div class="form-row">
          <label>Fecha inicio <input type="date" id="d-ini" value="${hoy}"></label>
          <label>Fecha fin <input type="date" id="d-fin" value="${hoy}"></label>
        </div>
        <label>Nota (opcional) <input type="text" id="d-nota" placeholder="Ej: cita médica"></label>
      </div>
      <div class="modal-foot">
        <button class="btn-sec" id="btn-cancelar">Cancelar</button>
        <button class="btn-pri" id="btn-guardar">Guardar</button>
      </div>
    </div></div>`;
  document.getElementById('modal-cerrar').addEventListener('click', cerrarModal);
  document.getElementById('btn-cancelar').addEventListener('click', cerrarModal);
  document.getElementById('btn-guardar').addEventListener('click', async () => {
    const payload = {
      empleado_id: parseInt(document.getElementById('d-emp').value),
      tipo: document.getElementById('d-tipo').value,
      fecha_inicio: document.getElementById('d-ini').value,
      fecha_fin: document.getElementById('d-fin').value,
      nota: document.getElementById('d-nota').value.trim() || null,
    };
    if (!payload.fecha_inicio || !payload.fecha_fin) { toast('Faltan fechas', 'error'); return; }
    if (payload.fecha_fin < payload.fecha_inicio) { toast('Fecha fin < inicio', 'error'); return; }
    try {
      const { data, error } = await supabase.from('disponibilidad').insert([payload]).select().single();
      if (error) throw error;
      state.disponibilidad.push(data);
      cerrarModal(); render(); toast('Periodo añadido', 'success');
    } catch (e) { toast('Error: ' + e.message, 'error'); }
  });
}

/* =====================================================================
   VISTA PLANTILLAS
   ===================================================================== */
function renderPlantillas(container) {
  const main = container || document.getElementById('main');
  const empById = {}; state.empleados.forEach(e => empById[e.id] = e);
  main.innerHTML = `
    <div class="seccion-header"><h2>Plantillas de día</h2></div>

    ${state.plantillas.length === 0
      ? `<div class="empty-state">Sin plantillas</div>`
      : `<div class="plantillas-grid">
          ${state.plantillas.map(p => {
        const asigs = p.asignaciones || [];
        const turnos = [...new Set(asigs.map(a => a.turno))];
        const horasTotal = asigs.reduce((s, a) => s + parseFloat(a.horas || 0), 0);
        return `<div class="ptcard">
              <div class="ptcard-head">
                <span class="ptcard-nombre">${escapeHtml(p.nombre)}</span>
                <div class="ptcard-actions">
                  <button class="ptcard-btn" data-rename="${p.id}" title="Renombrar">✏️</button>
                  <button class="ptcard-btn ptcard-btn-del" data-del-plant="${p.id}" title="Borrar">×</button>
                </div>
              </div>
              <div class="ptcard-meta">
                <span>${asigs.length} persona${asigs.length !== 1 ? 's' : ''}</span>
                <span class="ptcard-sep">·</span>
                <span>${horasTotal.toFixed(0)}h totales</span>
                <span class="ptcard-sep">·</span>
                <span>${turnos.map(t => `<span class="turno-pill" style="background:${turnoColors[t] || '#888'};font-size:9px;padding:1px 5px">${t}</span>`).join('')}</span>
              </div>
              <div class="ptcard-rows">
                ${asigs.map(a => {
          const emp = empById[a.empleado_id]; const color = turnoColors[a.turno] || '#888'; return `<div class="ptcard-row">
                  <span class="ptcard-dot" style="background:${color}"></span>
                  <span class="ptcard-emp">${emp ? escapeHtml(emp.nombre) : `<em style="color:var(--muted)">Eliminado</em>`}</span>
                  <span class="ptcard-turno" style="color:${color}">${a.turno}</span>
                  <span class="ptcard-horas">${parseFloat(a.horas).toFixed(1)}h</span>
                </div>`;
        }).join('')}
              </div>
            </div>`;
      }).join('')}
        </div>`}`;

  document.querySelectorAll('[data-rename]').forEach(b => {
    b.addEventListener('click', async () => {
      const p = state.plantillas.find(x => x.id === parseInt(b.dataset.rename));
      const nuevo = prompt('Nuevo nombre:', p.nombre);
      if (!nuevo || !nuevo.trim() || nuevo === p.nombre) return;
      try { const { error } = await supabase.from('plantillas').update({ nombre: nuevo.trim() }).eq('id', p.id); if (error) throw error; p.nombre = nuevo.trim(); state.plantillas.sort((a, b) => a.nombre.localeCompare(b.nombre)); render(); toast('Renombrada', 'success'); }
      catch (e) { toast('Error: ' + e.message, 'error'); }
    });
  });
  document.querySelectorAll('[data-del-plant]').forEach(b => {
    b.addEventListener('click', async () => {
      const p = state.plantillas.find(x => x.id === parseInt(b.dataset.delPlant));
      if (!confirm(`¿Borrar "${p.nombre}"?`)) return;
      try { const { error } = await supabase.from('plantillas').delete().eq('id', p.id); if (error) throw error; state.plantillas = state.plantillas.filter(x => x.id !== p.id); render(); toast('Eliminada', 'success'); }
      catch (e) { toast('Error: ' + e.message, 'error'); }
    });
  });
}

/* =====================================================================
   VISTA REGLAS
   ===================================================================== */
function renderReglas(container) {
  const main = container || document.getElementById('main');
  const dowNames = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  const dowFull = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  const puestosUnicos = [...new Set(state.empleados.map(e => e.puesto).filter(Boolean))].sort();

  const sorted = state.reglasMinimo.slice().sort((a, b) => a.dia_semana - b.dia_semana || a.turno.localeCompare(b.turno));

  main.innerHTML = `
    <div class="seccion-header">
      <h2>Reglas de mínimo de personal</h2>
      <button class="btn-pri" id="btn-nueva-regla">+ Añadir regla</button>
    </div>
    <p class="muted-small" style="margin-bottom:16px">Mínimo por día de semana, turno y puesto. Si no se cumple, aparece aviso rojo en el calendario.</p>
    ${sorted.length === 0 ? `<div class="empty-state">Sin reglas. Añade una con el botón de arriba.</div>` : `
      <div class="reglas-grid">
        ${sorted.map(r => {
    const tColor = turnoColors[r.turno] || '#888';
    const horasTxt = r.horas_minimas ? `· ≥${r.horas_minimas}h` : '';
    return `<div class="regla-card">
            <div class="regla-card-top">
              <span class="regla-dow">${dowNames[r.dia_semana]}</span>
              <span class="turno-pill" style="background:${tColor};font-size:10px;padding:2px 7px">${r.turno}</span>
              ${r.puesto ? `<span class="regla-puesto">${escapeHtml(r.puesto)}</span>` : `<span class="regla-puesto muted">cualquiera</span>`}
              <button class="disp-del-btn" data-del-regla="${r.id}" style="margin-left:auto">×</button>
            </div>
            <div class="regla-card-bot">
              <span>Mínimo <strong>${r.minimo}</strong> persona${r.minimo !== 1 ? 's' : ''}</span>
              ${r.horas_minimas ? `<span class="regla-horas-tag">≥ ${r.horas_minimas}h/persona</span>` : ''}
            </div>
          </div>`;
  }).join('')}
      </div>`}`;

  document.getElementById('btn-nueva-regla').addEventListener('click', () => {
    document.getElementById('modal-root').innerHTML = `
      <div class="modal-backdrop"><div class="modal">
        <div class="modal-head"><h3>Nueva regla de mínimo</h3><button class="modal-x" id="modal-cerrar">×</button></div>
        <div class="modal-body form-grid">
          <div class="form-row">
            <label>Día
              <select id="r-dow">${[1, 2, 3, 4, 5, 6, 7].map(i => `<option value="${i}">${dowFull[i]}</option>`).join('')}</select>
            </label>
            <label>Turno
              <select id="r-turno">${turnosOrden.map(t => `<option value="${t}">${t} – ${escapeHtml(turnoNombres[t])}</option>`).join('')}</select>
            </label>
          </div>
          <label>Puesto (opcional)
            <select id="r-puesto"><option value="">— cualquiera —</option>${puestosUnicos.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('')}</select>
          </label>
          <div class="form-row">
            <label>Mínimo de personas
              <input type="number" min="1" step="1" id="r-min" value="1">
            </label>
            <label>Mín. horas por persona <span style="font-size:10px;color:var(--muted)">(opcional)</span>
              <input type="number" min="0" step="0.5" id="r-horas" value="" placeholder="ej: 7">
            </label>
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn-sec" id="btn-cancelar">Cancelar</button>
          <button class="btn-pri" id="btn-guardar">Crear</button>
        </div>
      </div></div>`;
    document.getElementById('modal-cerrar').addEventListener('click', cerrarModal);
    document.getElementById('btn-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('btn-guardar').addEventListener('click', async () => {
      const hMin = parseFloat(document.getElementById('r-horas').value) || null;
      const payload = {
        dia_semana: parseInt(document.getElementById('r-dow').value),
        turno: document.getElementById('r-turno').value,
        puesto: document.getElementById('r-puesto').value || null,
        minimo: parseInt(document.getElementById('r-min').value) || 1,
        horas_minimas: hMin,
      };
      try {
        const { data, error } = await supabase.from('reglas_minimo').insert([payload]).select().single();
        if (error) throw error;
        state.reglasMinimo.push(data);
        cerrarModal(); render(); toast('Regla creada', 'success');
      } catch (e) { toast('Error: ' + e.message, 'error'); }
    });
  });

  document.querySelectorAll('[data-del-regla]').forEach(b => {
    b.addEventListener('click', async () => {
      const id = parseInt(b.dataset.delRegla);
      try {
        const { error } = await supabase.from('reglas_minimo').delete().eq('id', id);
        if (error) throw error;
        state.reglasMinimo = state.reglasMinimo.filter(r => r.id !== id);
        render(); toast('Eliminada', 'success');
      } catch (e) { toast('Error: ' + e.message, 'error'); }
    });
  });
}

/* =====================================================================
   VISTA OUTLETS (gestión de locales)
   ===================================================================== */
function renderOutlets(container) {
  const main = container || document.getElementById('main');
  main.innerHTML = `
    <div class="seccion-header">
      <h2>Gestión de locales (Outlets)</h2>
      <button class="btn-pri" id="btn-nuevo-outlet">+ Nuevo local</button>
    </div>
    <p class="info">Crea aquí tus locales (restaurante, bar, spa…). Cada uno tiene presupuesto propio por departamento. Los empleados se asignan a local + departamento desde la ficha de empleado.</p>

    ${state.outlets.length === 0 ? `<div class="empty-state">Sin locales. Crea el primero con el botón de arriba.</div>` : `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px">
        ${state.outlets.map(o => {
    const empFOH = state.outletEmpleados.filter(oe => oe.outlet_id === o.id && oe.departamento === 'FOH').length;
    const empBOH = state.outletEmpleados.filter(oe => oe.outlet_id === o.id && oe.departamento === 'BOH').length;
    const presFOH = parseFloat(state.config[`PRESUPUESTO_${o.id}_FOH`] || 0);
    const presBOH = parseFloat(state.config[`PRESUPUESTO_${o.id}_BOH`] || 0);
    const presGlobal = parseFloat(state.config[`PRESUPUESTO_${o.id}`] || 0);
    return `<div style="background:white;border:1px solid var(--border);border-radius:12px;padding:18px;box-shadow:var(--shadow)">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px">
              <div>
                <div style="font-size:24px;margin-bottom:4px">${o.icono || '🏨'}</div>
                <strong style="font-size:15px">${escapeHtml(o.nombre)}</strong>
              </div>
              <div>
                <button class="btn-mini" data-edit-outlet="${o.id}">Editar</button>
                <button class="btn-mini btn-danger" data-del-outlet="${o.id}">×</button>
              </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">
              <div style="background:var(--foh-bg);border-radius:8px;padding:10px;text-align:center">
                <div style="font-size:10px;font-weight:700;color:var(--foh-text);text-transform:uppercase;margin-bottom:4px">FOH</div>
                <div style="font-size:20px;font-weight:700;color:var(--foh-text)">${empFOH}</div>
                <div style="font-size:10px;color:var(--foh-text);opacity:0.8">empleados</div>
              </div>
              <div style="background:var(--boh-bg);border-radius:8px;padding:10px;text-align:center">
                <div style="font-size:10px;font-weight:700;color:var(--boh-text);text-transform:uppercase;margin-bottom:4px">BOH</div>
                <div style="font-size:20px;font-weight:700;color:var(--boh-text)">${empBOH}</div>
                <div style="font-size:10px;color:var(--boh-text);opacity:0.8">empleados</div>
              </div>
            </div>
            <div style="font-size:12px;color:var(--muted);display:flex;flex-direction:column;gap:4px">
              ${presGlobal > 0 ? `<div>Presupuesto global: <strong>${divisa(presGlobal)}</strong>/mes</div>` : ''}
              ${presFOH > 0 ? `<div>Presupuesto FOH: <strong>${divisa(presFOH)}</strong>/mes</div>` : ''}
              ${presBOH > 0 ? `<div>Presupuesto BOH: <strong>${divisa(presBOH)}</strong>/mes</div>` : ''}
              ${!presGlobal && !presFOH && !presBOH ? `<div style="font-style:italic">Sin presupuesto definido</div>` : ''}
            </div>
          </div>`;
  }).join('')}
      </div>`}`;

  document.getElementById('btn-nuevo-outlet').addEventListener('click', () => abrirModalOutlet(null));
  document.querySelectorAll('[data-edit-outlet]').forEach(b => {
    b.addEventListener('click', () => abrirModalOutlet(state.outlets.find(o => o.id === parseInt(b.dataset.editOutlet))));
  });
  document.querySelectorAll('[data-del-outlet]').forEach(b => {
    b.addEventListener('click', async () => {
      const o = state.outlets.find(x => x.id === parseInt(b.dataset.delOutlet));
      if (!confirm(`¿Desactivar "${o.nombre}"? Los empleados asignados perderán su vínculo con este local.`)) return;
      try {
        const { error } = await supabase.from('outlets').update({ activo: false }).eq('id', o.id);
        if (error) throw error;
        state.outlets = state.outlets.filter(x => x.id !== o.id);
        state.outletEmpleados = state.outletEmpleados.filter(oe => oe.outlet_id !== o.id);
        if (state.ctxOutletId === o.id) { state.ctxOutletId = null; state.view = 'overview'; }
        render(); toast('Local desactivado', 'success');
      } catch (e) { toast('Error: ' + e.message, 'error'); }
    });
  });
}

function abrirModalOutlet(outlet) {
  const esNuevo = !outlet;
  outlet = outlet || { nombre: '', icono: '🏨', orden: state.outlets.length + 1 };
  const oId = outlet.id;
  const presFOH = oId ? parseFloat(state.config[`PRESUPUESTO_${oId}_FOH`] || 0) : 0;
  const presBOH = oId ? parseFloat(state.config[`PRESUPUESTO_${oId}_BOH`] || 0) : 0;
  const presGlobal = oId ? parseFloat(state.config[`PRESUPUESTO_${oId}`] || 0) : 0;

  const kpiRevenue = oId ? parseFloat(state.config[`KPI_REVENUE_${oId}`] || 0) : 0;
  const kpiFOH = oId ? parseFloat(state.config[`KPI_FOH_PCT_${oId}`] || 0) : 0;
  const kpiBOH = oId ? parseFloat(state.config[`KPI_BOH_PCT_${oId}`] || 0) : 0;

  document.getElementById('modal-root').innerHTML = `
    <div class="modal-backdrop"><div class="modal" style="max-width:520px">
      <div class="modal-head">
        <h3>${esNuevo ? 'Nuevo local' : 'Editar local'}</h3>
        <button class="modal-x" id="modal-cerrar">×</button>
      </div>
      <div class="modal-body form-grid">
        <div class="form-row">
          <label>Nombre <input type="text" id="o-nombre" value="${escapeHtml(outlet.nombre)}"></label>
          <label>Icono (emoji)
            <div style="display:flex;gap:6px;flex-wrap:wrap;padding:4px 0">
              ${OUTLET_ICONS.map(ic => `<button type="button" class="icon-btn" data-icon="${ic}" style="font-size:22px;background:${outlet.icono === ic ? 'var(--bg)' : 'transparent'};border:2px solid ${outlet.icono === ic ? 'var(--color-primario)' : 'transparent'};border-radius:6px;padding:4px;cursor:pointer">${ic}</button>`).join('')}
            </div>
            <input type="text" id="o-icono" value="${escapeHtml(outlet.icono || '🏨')}" placeholder="🏨" style="width:60px;font-size:20px;text-align:center">
          </label>
        </div>
        <label>Orden de aparición <input type="number" id="o-orden" min="1" value="${outlet.orden || 1}"></label>

        <div class="modal-section-divider">💰 Presupuesto mensual</div>
        <div class="form-row">
          <label>Global (todo el local) <input type="number" step="0.01" min="0" id="o-pres-global" value="${presGlobal || ''}"></label>
        </div>
        <div class="form-row">
          <label><span class="dept-badge foh" style="font-size:10px;padding:1px 7px">FOH</span> Presupuesto FOH <input type="number" step="0.01" min="0" id="o-pres-foh" value="${presFOH || ''}"></label>
          <label><span class="dept-badge boh" style="font-size:10px;padding:1px 7px">BOH</span> Presupuesto BOH <input type="number" step="0.01" min="0" id="o-pres-boh" value="${presBOH || ''}"></label>
        </div>

        <div class="modal-section-divider">📊 KPIs (% sobre revenue)</div>
        <label style="font-size:12px;color:var(--muted);margin-bottom:2px">Revenue mensual esperado del local</label>
        <input type="number" step="0.01" min="0" id="o-kpi-revenue" value="${kpiRevenue || ''}" placeholder="ej: 100000">
        <div class="form-row" style="margin-top:8px">
          <label>
            <span class="dept-badge foh" style="font-size:10px;padding:1px 7px">FOH</span> % objetivo FOH
            <input type="number" step="0.1" min="0" max="100" id="o-kpi-foh" value="${kpiFOH || ''}" placeholder="ej: 22">
            <span class="kpi-pct-preview" id="prev-foh" style="font-size:11px;color:var(--muted);margin-top:3px">${kpiRevenue && kpiFOH ? `= ${divisa(kpiRevenue * kpiFOH / 100)}/mes` : ''}</span>
          </label>
          <label>
            <span class="dept-badge boh" style="font-size:10px;padding:1px 7px">BOH</span> % objetivo BOH
            <input type="number" step="0.1" min="0" max="100" id="o-kpi-boh" value="${kpiBOH || ''}" placeholder="ej: 18">
            <span class="kpi-pct-preview" id="prev-boh" style="font-size:11px;color:var(--muted);margin-top:3px">${kpiRevenue && kpiBOH ? `= ${divisa(kpiRevenue * kpiBOH / 100)}/mes` : ''}</span>
          </label>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn-sec" id="btn-cancelar">Cancelar</button>
        <button class="btn-pri" id="btn-guardar">${esNuevo ? 'Crear' : 'Guardar'}</button>
      </div>
    </div></div>`;

  document.getElementById('modal-cerrar').addEventListener('click', cerrarModal);
  document.getElementById('btn-cancelar').addEventListener('click', cerrarModal);

  // Icon picker
  document.querySelectorAll('.icon-btn').forEach(b => {
    b.addEventListener('click', () => {
      document.getElementById('o-icono').value = b.dataset.icon;
      document.querySelectorAll('.icon-btn').forEach(x => { x.style.background = 'transparent'; x.style.borderColor = 'transparent'; });
      b.style.background = 'var(--bg)'; b.style.borderColor = 'var(--color-primario)';
    });
  });

  // Live preview for KPI %
  const updatePreviews = () => {
    const rev = parseFloat(document.getElementById('o-kpi-revenue').value) || 0;
    const foh = parseFloat(document.getElementById('o-kpi-foh').value) || 0;
    const boh = parseFloat(document.getElementById('o-kpi-boh').value) || 0;
    document.getElementById('prev-foh').textContent = rev && foh ? `= ${divisa(rev * foh / 100)}/mes` : '';
    document.getElementById('prev-boh').textContent = rev && boh ? `= ${divisa(rev * boh / 100)}/mes` : '';
  };
  ['o-kpi-revenue', 'o-kpi-foh', 'o-kpi-boh'].forEach(id => document.getElementById(id).addEventListener('input', updatePreviews));

  document.getElementById('btn-guardar').addEventListener('click', async () => {
    const payload = { nombre: document.getElementById('o-nombre').value.trim(), icono: document.getElementById('o-icono').value.trim() || '🏨', orden: parseInt(document.getElementById('o-orden').value) || 1, activo: true };
    if (!payload.nombre) { toast('El nombre es obligatorio', 'error'); return; }
    const pGlobal = parseFloat(document.getElementById('o-pres-global').value) || 0;
    const pFOH = parseFloat(document.getElementById('o-pres-foh').value) || 0;
    const pBOH = parseFloat(document.getElementById('o-pres-boh').value) || 0;
    const kRev = parseFloat(document.getElementById('o-kpi-revenue').value) || 0;
    const kFOH = parseFloat(document.getElementById('o-kpi-foh').value) || 0;
    const kBOH = parseFloat(document.getElementById('o-kpi-boh').value) || 0;

    try {
      let outletId = oId;
      if (esNuevo) {
        const { data, error } = await supabase.from('outlets').insert([payload]).select().single();
        if (error) throw error;
        outletId = data.id;
        state.outlets.push(data);
      } else {
        const { data, error } = await supabase.from('outlets').update(payload).eq('id', oId).select().single();
        if (error) throw error;
        const idx = state.outlets.findIndex(x => x.id === oId);
        state.outlets[idx] = data;
      }
      state.outlets.sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre));

      const cfgChanges = [
        { clave: `PRESUPUESTO_${outletId}`, valor: String(pGlobal) },
        { clave: `PRESUPUESTO_${outletId}_FOH`, valor: String(pFOH) },
        { clave: `PRESUPUESTO_${outletId}_BOH`, valor: String(pBOH) },
        { clave: `KPI_REVENUE_${outletId}`, valor: String(kRev) },
        { clave: `KPI_FOH_PCT_${outletId}`, valor: String(kFOH) },
        { clave: `KPI_BOH_PCT_${outletId}`, valor: String(kBOH) },
      ];
      const { error: cfgErr } = await supabase.from('config').upsert(cfgChanges, { onConflict: 'clave' });
      if (cfgErr) throw cfgErr;
      cfgChanges.forEach(c => state.config[c.clave] = c.valor);

      cerrarModal(); render(); toast(`Local ${esNuevo ? 'creado' : 'actualizado'}`, 'success');
    } catch (e) { toast('Error: ' + e.message, 'error'); }
  });
}

/* =====================================================================
   VISTA CONFIGURACIÓN
   ===================================================================== */
function renderConfig() {
  const subview = state.configSubview || 'aplicacion';
  const tabs = [
    { id: 'aplicacion', label: 'Aplicación', icon: '⚙️' },
    { id: 'locales', label: 'Locales', icon: '🏪' },
    { id: 'plantillas', label: 'Plantillas', icon: '📋' },
    { id: 'reglas', label: 'Reglas', icon: '📏' },
  ];

  const main = document.getElementById('main');
  main.innerHTML = `
    <div style="padding:0">
      <div class="config-subtabs">
        ${tabs.map(t => `
          <button class="config-subtab${subview===t.id?' active':''}" data-subtab="${t.id}">
            <span class="config-subtab-icon">${t.icon}</span>
            <span class="config-subtab-label">${t.label}</span>
          </button>`).join('')}
      </div>
      <div id="config-content"></div>
    </div>`;

  document.querySelectorAll('.config-subtab').forEach(b => {
    b.addEventListener('click', () => { state.configSubview = b.dataset.subtab; renderConfig(); });
  });

  const content2 = document.getElementById('config-content');

  if (subview === 'aplicacion') renderConfigAplicacion(content2);
  else if (subview === 'locales') { content2.innerHTML = ''; renderOutlets(content2); }
  else if (subview === 'plantillas') { content2.innerHTML = ''; renderPlantillas(content2); }
  else if (subview === 'reglas') { content2.innerHTML = ''; renderReglas(content2); }
}

function renderConfigAplicacion(container) {
  const main = container || document.getElementById('main');
  const grupos = [
    ['Hotel', ['NOMBRE_HOTEL', 'DIVISA']],
    ['Turnos', ['TURNOS', 'TURNO_M_NOMBRE', 'TURNO_M_HORAS', 'TURNO_M_COLOR', 'TURNO_T_NOMBRE', 'TURNO_T_HORAS', 'TURNO_T_COLOR', 'TURNO_N_NOMBRE', 'TURNO_N_HORAS', 'TURNO_N_COLOR']],
    ['Costes', ['PLUS_NOCTURNIDAD', 'PLUS_FESTIVO', 'COSTE_FIJO_DIARIO']],
    ['Avisos y descansos', ['DESCANSO_MIN_HORAS', 'MAX_DIAS_CONSECUTIVOS']],
    ['Presupuesto global', ['PRESUPUESTO_MENSUAL', 'ALERTA_PORCENTAJE']],
    ['Apariencia', ['COLOR_PRIMARIO', 'COLOR_ALERTA']],
  ];
  const incluidas = new Set(grupos.flatMap(g => g[1]));
  const otras = Object.keys(state.config).filter(k => !incluidas.has(k) && !k.startsWith('PRESUPUESTO_'));
  if (otras.length) grupos.push(['Otros', otras]);

  main.innerHTML = `
    <div class="seccion-header"><h2>Configuración de aplicación</h2></div>
    ${grupos.map(([titulo, claves]) => `
      <h3 style="margin-top:20px">${titulo}</h3>
      <table class="tabla-config">
        ${claves.map(k => `<tr>
          <td style="width:40%"><code>${escapeHtml(k)}</code></td>
          <td><input type="text" data-clave="${k}" value="${escapeHtml(state.config[k] || '')}"></td>
        </tr>`).join('')}
      </table>`).join('')}
    <div style="margin-top:20px;display:flex;gap:8px;justify-content:flex-end">
      <button class="btn-pri" id="btn-guardar-cfg">Guardar configuración</button>
    </div>`;

  document.getElementById('btn-guardar-cfg').addEventListener('click', async () => {
    const cambios = [];
    document.querySelectorAll('[data-clave]').forEach(inp => {
      const k = inp.dataset.clave, v = inp.value.trim();
      if (state.config[k] !== v) cambios.push({ clave: k, valor: v });
    });
    if (cambios.length === 0) { toast('Sin cambios', ''); return; }
    try {
      const { error } = await supabase.from('config').upsert(cambios, { onConflict: 'clave' });
      if (error) throw error;
      cambios.forEach(c => state.config[c.clave] = c.valor);
      procesarTurnos();
      document.documentElement.style.setProperty('--color-primario', state.config.COLOR_PRIMARIO || '#146385');
      document.documentElement.style.setProperty('--color-alerta', state.config.COLOR_ALERTA || '#dc2626');
      render(); toast(`${cambios.length} cambio(s) guardado(s)`, 'success');
    } catch (e) { toast('Error: ' + e.message, 'error'); }
  });
}

/* =====================================================================
   EXPORTACIÓN
   ===================================================================== */
function nombreArchivo(prefijo, sufijoFecha) {
  const hotel = (state.config.NOMBRE_HOTEL || 'hotel').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const outlet = ctxOutlet();
  const outletSlug = outlet ? `_${outlet.nombre.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : '';
  const deptSlug = state.ctxDept !== 'ALL' ? `_${state.ctxDept.toLowerCase()}` : '';
  return `${hotel}${outletSlug}${deptSlug}_${prefijo}_${sufijoFecha}`;
}

function exportarPDFSemana() {
  if (!window.jspdf) { toast('jsPDF no cargado', 'error'); return; }
  const { jsPDF } = window.jspdf;
  const lunes = state.cursorSemana;
  const dias = diasSemana(lunes);
  const finSem = dias[6];
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const outlet = ctxOutlet();
  const dowLabels = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

  doc.setFontSize(16); doc.setFont(undefined, 'bold');
  doc.text(state.config.NOMBRE_HOTEL || 'Hotel', 14, 14);
  doc.setFontSize(11); doc.setFont(undefined, 'normal');
  doc.text(`Cuadrante semanal${outlet ? ` – ${outlet.nombre} (${state.ctxDept === 'ALL' ? 'FOH+BOH' : state.ctxDept})` : ''}: ${fechaISO(lunes)} — ${fechaISO(finSem)}`, 14, 21);

  const empCtx = empleadosEnContexto();
  const head = [['Empleado', 'Puesto', ...(outlet ? ['Dept'] : []), ...dias.map((d, i) => `${dowLabels[i]} ${d.getDate()}`), 'Σ h', `Σ ${state.config.DIVISA || '€'}`]];

  let totalSemana = 0;
  const body = empCtx.map(emp => {
    let horas = 0, total = 0;
    const cells = dias.map(d => {
      const f = fechaISO(d);
      const a = state.planificacion.find(x => x.fecha === f && x.empleado_id === emp.id);
      const noDisp = empleadoNoDisponible(emp.id, f);
      if (noDisp) return `[${tipoDispLabel(noDisp.tipo)[0]}]`;
      if (!a) return '';
      const c = calcularCoste(a, emp, !!state.festivos[f]);
      horas += a.horas; total += c.total;
      return `${a.turno} ${a.horas}h`;
    });
    totalSemana += total;
    const dept = deptDeEmpleado(emp.id) || '';
    return [emp.nombre, emp.puesto || '', ...(outlet ? [dept] : []), ...cells, horas.toFixed(1), total.toFixed(2)];
  });

  const totalesDia = dias.map(d => { const t = totalDia(fechaISO(d)); return t ? t.total.toFixed(2) : '—'; });
  const foot = [['TOTAL DÍA', '', ...(outlet ? [''] : []), ...totalesDia, '', totalSemana.toFixed(2)]];

  doc.autoTable({
    head, body, foot, startY: 26, theme: 'striped',
    headStyles: { fillColor: hexToRgb(state.config.COLOR_PRIMARIO || '#0f766e'), textColor: 255, fontSize: 9 },
    bodyStyles: { fontSize: 8 },
    footStyles: { fillColor: [240, 240, 240], textColor: 0, fontStyle: 'bold', fontSize: 9 },
    columnStyles: { 0: { cellWidth: 30, fontStyle: 'bold' }, 1: { cellWidth: 22 } },
  });
  doc.setFontSize(8); doc.setTextColor(120);
  doc.text(`Generado el ${new Date().toLocaleString('es-ES')}`, 14, doc.lastAutoTable.finalY + 8);
  doc.save(`${nombreArchivo('cuadrante_semana', fechaISO(lunes))}.pdf`);
  toast('PDF generado', 'success');
}

function exportarPDFMes() {
  if (!window.jspdf) { toast('jsPDF no cargado', 'error'); return; }
  const { jsPDF } = window.jspdf;
  const cur = state.cursorMes;
  const year = cur.getFullYear(); const mes = cur.getMonth();
  const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const prefijo = `${year}-${String(mes + 1).padStart(2, '0')}`;
  const outlet = ctxOutlet();
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  doc.setFontSize(16); doc.setFont(undefined, 'bold');
  doc.text(state.config.NOMBRE_HOTEL || 'Hotel', 14, 16);
  doc.setFontSize(12); doc.setFont(undefined, 'normal');
  doc.text(`Resumen ${meses[mes]} ${year}${outlet ? ` – ${outlet.nombre} (${state.ctxDept === 'ALL' ? 'FOH+BOH' : state.ctxDept})` : ''}`, 14, 23);

  const diasM = new Date(year, mes + 1, 0).getDate();
  let totalMes = 0, totalPersonal = 0, totalFijo = 0, diasPlan = 0;
  for (let d = 1; d <= diasM; d++) { const f = fechaISO(new Date(year, mes, d)); const t = totalDia(f); if (t) { totalMes += t.total; totalPersonal += t.personal; totalFijo += t.fijo; diasPlan++; } }
  const presupuesto = presupuestoCtx();

  doc.autoTable({
    startY: 30, head: [['Concepto', 'Valor']],
    body: [
      ['Días planificados', `${diasPlan} / ${diasM}`],
      ['Coste personal', `${totalPersonal.toFixed(2)} ${state.config.DIVISA || '€'}`],
      ['Coste fijo', `${totalFijo.toFixed(2)} ${state.config.DIVISA || '€'}`],
      [{ content: 'TOTAL MES', styles: { fontStyle: 'bold' } }, { content: `${totalMes.toFixed(2)} ${state.config.DIVISA || '€'}`, styles: { fontStyle: 'bold' } }],
      ...(presupuesto > 0 ? [['Presupuesto', `${presupuesto.toFixed(2)} ${state.config.DIVISA || '€'}`], ['Diferencia', `${(presupuesto - totalMes).toFixed(2)} ${state.config.DIVISA || '€'}`], ['Consumido', `${(totalMes / presupuesto * 100).toFixed(1)}%`]] : []),
    ],
    theme: 'plain', headStyles: { fillColor: hexToRgb(state.config.COLOR_PRIMARIO || '#0f766e'), textColor: 255 },
    columnStyles: { 1: { halign: 'right' } },
  });

  const porEmp = {};
  planificacionCtx().filter(a => a.fecha.startsWith(prefijo)).forEach(a => {
    const emp = state.empleados.find(e => e.id === a.empleado_id); if (!emp) return;
    const c = calcularCoste(a, emp, !!state.festivos[a.fecha]);
    const dept = deptDeEmpleado(emp.id) || '';
    if (!porEmp[emp.id]) porEmp[emp.id] = { nombre: emp.nombre, puesto: emp.puesto || '', dept, horas: 0, base: 0, plusN: 0, plusF: 0, total: 0 };
    porEmp[emp.id].horas += a.horas; porEmp[emp.id].base += c.base; porEmp[emp.id].plusN += c.plusN; porEmp[emp.id].plusF += c.plusF; porEmp[emp.id].total += c.total;
  });
  const empOrdenados = Object.values(porEmp).sort((a, b) => b.total - a.total);
  if (empOrdenados.length > 0) {
    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 8,
      head: [['Empleado', 'Puesto', ...(outlet ? ['Dept'] : []), 'Horas', 'Base', 'Plus N', 'Plus F', 'Total']],
      body: empOrdenados.map(e => [e.nombre, e.puesto, ...(outlet ? [e.dept] : []), e.horas.toFixed(1), e.base.toFixed(2), e.plusN.toFixed(2), e.plusF.toFixed(2), { content: e.total.toFixed(2), styles: { fontStyle: 'bold' } }]),
      theme: 'striped', headStyles: { fillColor: hexToRgb(state.config.COLOR_PRIMARIO || '#0f766e'), textColor: 255, fontSize: 9 }, bodyStyles: { fontSize: 9 },
    });
  }
  doc.setFontSize(8); doc.setTextColor(120);
  doc.text(`Generado el ${new Date().toLocaleString('es-ES')}`, 14, doc.internal.pageSize.height - 8);
  doc.save(`${nombreArchivo('resumen_mes', prefijo)}.pdf`);
  toast('PDF generado', 'success');
}

function exportarExcelMes() {
  if (!window.XLSX) { toast('SheetJS no cargado', 'error'); return; }
  const cur = state.cursorMes;
  const year = cur.getFullYear(); const mes = cur.getMonth();
  const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const prefijo = `${year}-${String(mes + 1).padStart(2, '0')}`;
  const outlet = ctxOutlet();

  const diasM = new Date(year, mes + 1, 0).getDate();
  let totalMes = 0, totalPersonal = 0, totalFijo = 0, diasPlan = 0;
  for (let d = 1; d <= diasM; d++) { const f = fechaISO(new Date(year, mes, d)); const t = totalDia(f); if (t) { totalMes += t.total; totalPersonal += t.personal; totalFijo += t.fijo; diasPlan++; } }
  const presupuesto = presupuestoCtx();

  const resumenAOA = [[state.config.NOMBRE_HOTEL || 'Hotel'], [`Resumen ${meses[mes]} ${year}${outlet ? ` – ${outlet.nombre} (${state.ctxDept})` : ''}`], [],
  ['Días planificados', diasPlan, `de ${diasM}`], ['Coste personal', totalPersonal], ['Coste fijo', totalFijo], ['TOTAL MES', totalMes],
  ...(presupuesto > 0 ? [[], ['Presupuesto mensual', presupuesto], ['Diferencia', presupuesto - totalMes], ['% consumido', totalMes / presupuesto]] : [])
  ];
  const wsRes = XLSX.utils.aoa_to_sheet(resumenAOA);
  wsRes['!cols'] = [{ wch: 24 }, { wch: 16 }, { wch: 12 }];

  const porEmp = {};
  planificacionCtx().filter(a => a.fecha.startsWith(prefijo)).forEach(a => {
    const emp = state.empleados.find(e => e.id === a.empleado_id); if (!emp) return;
    const c = calcularCoste(a, emp, !!state.festivos[a.fecha]);
    const dept = deptDeEmpleado(emp.id) || '';
    if (!porEmp[emp.id]) porEmp[emp.id] = { Nombre: emp.nombre, Puesto: emp.puesto || '', Departamento: dept, Local: outlet ? outlet.nombre : '', ' Coste/hora': emp.coste_hora, 'Horas totales': 0, 'Base': 0, 'Plus nocturnidad': 0, 'Plus festivo': 0, 'Total bruto': 0 };
    porEmp[emp.id]['Horas totales'] += a.horas; porEmp[emp.id]['Base'] += c.base; porEmp[emp.id]['Plus nocturnidad'] += c.plusN; porEmp[emp.id]['Plus festivo'] += c.plusF; porEmp[emp.id]['Total bruto'] += c.total;
  });
  const empArr = Object.values(porEmp).sort((a, b) => b['Total bruto'] - a['Total bruto']);
  empArr.forEach(e => { ['Horas totales', 'Base', 'Plus nocturnidad', 'Plus festivo', 'Total bruto'].forEach(k => e[k] = parseFloat(e[k].toFixed(2))); });
  const wsEmp = empArr.length > 0 ? XLSX.utils.json_to_sheet(empArr) : XLSX.utils.aoa_to_sheet([['Sin asignaciones']]);
  wsEmp['!cols'] = [{ wch: 22 }, { wch: 16 }, { wch: 12 }, { wch: 16 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 18 }, { wch: 14 }, { wch: 14 }];

  const detalle = [];
  planificacionCtx().filter(a => a.fecha.startsWith(prefijo)).sort((a, b) => a.fecha.localeCompare(b.fecha)).forEach(a => {
    const emp = state.empleados.find(e => e.id === a.empleado_id); if (!emp) return;
    const esFest = !!state.festivos[a.fecha]; const c = calcularCoste(a, emp, esFest);
    const dept = deptDeEmpleado(emp.id) || '';
    detalle.push({ Fecha: a.fecha, Local: outlet ? outlet.nombre : '', Departamento: dept, Empleado: emp.nombre, Puesto: emp.puesto || '', Turno: `${a.turno} (${turnoNombres[a.turno] || ''})`, Horas: parseFloat(a.horas), 'Coste/hora': emp.coste_hora, Base: parseFloat(c.base.toFixed(2)), 'Plus N': parseFloat(c.plusN.toFixed(2)), 'Plus F': parseFloat(c.plusF.toFixed(2)), Festivo: esFest ? (state.festivos[a.fecha] || 'Sí') : '', Total: parseFloat(c.total.toFixed(2)) });
  });
  const wsDet = detalle.length > 0 ? XLSX.utils.json_to_sheet(detalle) : XLSX.utils.aoa_to_sheet([['Sin asignaciones']]);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsRes, 'Resumen');
  XLSX.utils.book_append_sheet(wb, wsEmp, 'Por empleado');
  XLSX.utils.book_append_sheet(wb, wsDet, 'Detalle diario');
  XLSX.writeFile(wb, `${nombreArchivo('mes_gestoria', prefijo)}.xlsx`);
  toast('Excel generado', 'success');
}

function exportarCSVMes() {
  const cur = state.cursorMes;
  const year = cur.getFullYear(); const mes = cur.getMonth();
  const prefijo = `${year}-${String(mes + 1).padStart(2, '0')}`;
  const outlet = ctxOutlet();
  const lines = [['fecha', 'local', 'departamento', 'empleado', 'puesto', 'turno', 'horas', 'base', 'plus_noct', 'plus_fest', 'festivo', 'total']];
  planificacionCtx().filter(a => a.fecha.startsWith(prefijo)).sort((a, b) => a.fecha.localeCompare(b.fecha)).forEach(a => {
    const emp = state.empleados.find(e => e.id === a.empleado_id); if (!emp) return;
    const esFest = !!state.festivos[a.fecha]; const c = calcularCoste(a, emp, esFest);
    const dept = deptDeEmpleado(emp.id) || '';
    lines.push([a.fecha, outlet ? outlet.nombre : '', dept, emp.nombre, emp.puesto || '', a.turno, a.horas, c.base.toFixed(2), c.plusN.toFixed(2), c.plusF.toFixed(2), esFest ? (state.festivos[a.fecha] || 'Si') : '', c.total.toFixed(2)]);
  });
  if (lines.length === 1) { toast('Sin datos', ''); return; }
  const csv = lines.map(row => row.map(v => { const s = String(v); return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `${nombreArchivo('mes', prefijo)}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  toast('CSV generado', 'success');
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return h.length === 3 ? h.split('').map(c => parseInt(c + c, 16)) : [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}