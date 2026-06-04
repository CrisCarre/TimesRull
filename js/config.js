/**
 * config.js
 * / Configuración de Supabase, estado global y constantes de turnos.
 */

/* =====================================================================
   CONFIGURACIÓN SUPABASE
   ===================================================================== */
const SUPABASE_URL = 'https://mysswdyczvtcjzbaptnp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im15c3N3ZHljenZ0Y2p6YmFwdG5wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczNzY1NjUsImV4cCI6MjA5Mjk1MjU2NX0.uB5l0yq65XS6xhjALakca1QXLSYBuKTMfcuiyb3pQdc';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);


/* =====================================================================
   ESTADO GLOBAL
   ===================================================================== */
const state = {
  user: null,
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
const DEPT_LABELS = { FOH: 'Front of House', BOH: 'Back of House', ALL: 'Todos los departamentos' };
const DEPT_CLASS  = { FOH: 'foh', BOH: 'boh', ALL: 'all' };
const OUTLET_ICONS = ['🏨','🍽️','🍹','🏊','🧖','🎭','🎰','🏋️','☕','🛍️'];

