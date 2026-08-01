/**
 * helpers.js
 * / Arranque, login/logout, carga de datos, helpers generales,
// helpers de contexto outlet/dept, cálculos de coste, avisos y toast.
 */

/* =====================================================================
   ARRANQUE
   ===================================================================== */
window.addEventListener('DOMContentLoaded', async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { renderLogin(); return; }
  state.user = session.user;
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
          <div id="login-error" class="error-msg">${error}</div>
        </form>
      </div>
    </div>`;
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-login');
    const err = document.getElementById('login-error');
    btn.disabled = true; err.textContent = '';
    const { data, error } = await supabase.auth.signInWithPassword({
      email: document.getElementById('email').value,
      password: document.getElementById('password').value,
    });
    btn.disabled = false;
    if (error) { err.textContent = error.message === 'Invalid login credentials' ? 'Email o contraseña incorrectos' : error.message; return; }
    state.user = data.user;
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

    state.planificacion = planRes.data.map(p => ({ ...p, horas: parseFloat(p.horas) }));
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
function calcularHorasRango(inicio, fin) {
  if (!inicio || !fin) return 0;

  const [hi, mi] = inicio.split(':').map(Number);
  const [hf, mf] = fin.split(':').map(Number);

  const minInicio = hi * 60 + mi;
  let minFin = hf * 60 + mf;

  if (minFin <= minInicio) {
    minFin += 24 * 60;
  }

  return (minFin - minInicio) / 60;
}


function crearRangoHorario(inicio, fin) {
  return `${inicio}-${fin}`;
}


function separarRangoHorario(turno) {
  const [inicio = '', fin = ''] = String(turno || '').split('-');
  return { inicio, fin };
}

/** Devuelve las horas de inicio/fin por defecto de un turno según config.
 *  Claves: TURNO_M_INICIO, TURNO_M_FIN, TURNO_T_INICIO, TURNO_T_FIN, etc.
 *  Si no están configuradas devuelve cadenas vacías. */
function horasDefaultDeTurno(turno) {
  const hora_inicio = state.config[`TURNO_${turno}_INICIO`] || '';
  const hora_fin = state.config[`TURNO_${turno}_FIN`] || '';
  return { hora_inicio, hora_fin };
}



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