/**
 * views-outlets.js
 * /Vistas: gestión de locales (outlets) y configuración global.
 */

/* =====================================================================
   VISTA OUTLETS (gestión de locales)
   ===================================================================== */
function renderOutlets() {
  const main = document.getElementById('main');
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

  document.getElementById('modal-root').innerHTML = `
    <div class="modal-backdrop"><div class="modal" style="max-width:500px">
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
        <div style="border-top:1px solid var(--border);padding-top:12px;margin-top:4px">
          <div style="font-size:12px;font-weight:700;margin-bottom:8px;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em">Presupuesto mensual</div>
          <div style="display:flex;flex-direction:column;gap:8px">
            <label>Global (todo el local) <input type="number" step="0.01" min="0" id="o-pres-global" value="${presGlobal || ''}"></label>
            <label><span class="dept-badge foh" style="font-size:10px;padding:1px 7px">FOH</span> Presupuesto FOH <input type="number" step="0.01" min="0" id="o-pres-foh" value="${presFOH || ''}"></label>
            <label><span class="dept-badge boh" style="font-size:10px;padding:1px 7px">BOH</span> Presupuesto BOH <input type="number" step="0.01" min="0" id="o-pres-boh" value="${presBOH || ''}"></label>
          </div>
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

  document.getElementById('btn-guardar').addEventListener('click', async () => {
    const payload = { nombre: document.getElementById('o-nombre').value.trim(), icono: document.getElementById('o-icono').value.trim() || '🏨', orden: parseInt(document.getElementById('o-orden').value) || 1, activo: true };
    if (!payload.nombre) { toast('El nombre es obligatorio', 'error'); return; }
    const pGlobal = parseFloat(document.getElementById('o-pres-global').value) || 0;
    const pFOH = parseFloat(document.getElementById('o-pres-foh').value) || 0;
    const pBOH = parseFloat(document.getElementById('o-pres-boh').value) || 0;

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

      // Save budget config
      const budgetChanges = [
        { clave: `PRESUPUESTO_${outletId}`, valor: String(pGlobal) },
        { clave: `PRESUPUESTO_${outletId}_FOH`, valor: String(pFOH) },
        { clave: `PRESUPUESTO_${outletId}_BOH`, valor: String(pBOH) },
      ];
      const { error: cfgErr } = await supabase.from('config').upsert(budgetChanges, { onConflict: 'clave' });
      if (cfgErr) throw cfgErr;
      budgetChanges.forEach(c => state.config[c.clave] = c.valor);

      cerrarModal(); render(); toast(`Local ${esNuevo ? 'creado' : 'actualizado'}`, 'success');
    } catch (e) { toast('Error: ' + e.message, 'error'); }
  });
}


/* =====================================================================
   VISTA CONFIGURACIÓN
   ===================================================================== */
function renderConfig() {
  const main = document.getElementById('main');

  const META = {
    NOMBRE_HOTEL: { label: 'Nombre del hotel', desc: 'Aparece en la cabecera y en todas las exportaciones' },
    DIVISA: { label: 'Divisa', desc: 'Símbolo de moneda que se muestra junto a los importes (ej: €, $, £)' },
    TURNOS: { label: 'Códigos de turno', desc: 'Lista de códigos separados por | en el orden que quieras mostrarlos (ej: M|T|N)' },
    PLUS_NOCTURNIDAD: { label: 'Plus nocturnidad (%)', desc: 'Porcentaje extra que se suma al coste base cuando el turno es N' },
    PLUS_FESTIVO: { label: 'Plus festivo (%)', desc: 'Porcentaje extra que se suma al coste base en días marcados como festivos' },
    COSTE_FIJO_DIARIO: { label: 'Coste fijo diario', desc: 'Gastos fijos del local por día (suministros, amortizaciones…) que se suman al coste de personal' },
    DESCANSO_MIN_HORAS: { label: 'Descanso mínimo (h)', desc: 'Horas mínimas de descanso entre un turno N y el turno M del día siguiente — genera aviso si no se cumple' },
    MAX_DIAS_CONSECUTIVOS: { label: 'Máx. días consecutivos', desc: 'Aviso amarillo si un empleado trabaja más días seguidos que este valor' },
    ALERTA_HORAS_TURNO: { label: 'Alerta horas por turno', desc: 'El badge de horas en el modal se pone rojo si supera este número (ej: 8)' },
    PRESUPUESTO_MENSUAL: { label: 'Presupuesto global / mes', desc: 'Presupuesto de referencia cuando no hay un local seleccionado. Cada local tiene el suyo propio en la sección Locales' },
    ALERTA_PORCENTAJE: { label: 'Alerta presupuesto (%)', desc: 'Se activa la alerta naranja en el calendario cuando el coste mensual alcanza este porcentaje del presupuesto' },
    COLOR_PRIMARIO: { label: 'Color principal', desc: 'Color de botones, pestañas activas y badges — en formato hexadecimal (ej: #0f766e)' },
    COLOR_ALERTA: { label: 'Color de alertas', desc: 'Color usado para errores y avisos críticos — en formato hexadecimal (ej: #dc2626)' },
  };

  const codigos = (state.config.TURNOS || 'M|T|N').split('|').filter(Boolean);

  const field = (clave, extraDesc = '') => {
    const m = META[clave] || {};
    const desc = m.desc || extraDesc;
    const val = escapeHtml(state.config[clave] || '');
    const isColor = clave.endsWith('_COLOR');
    return `<div class="cfg-item">
      <div class="cfg-item-head">
        <code class="cfg-key">${escapeHtml(clave)}</code>
        ${isColor && state.config[clave] ? `<span class="cfg-color-dot" style="background:${escapeHtml(state.config[clave])}"></span>` : ''}
      </div>
      <input type="text" data-clave="${clave}" value="${val}" placeholder="${escapeHtml(m.label || clave)}">
      ${desc ? `<p class="cfg-desc">${desc}</p>` : ''}
    </div>`;
  };

  main.innerHTML = `
    <div class="seccion-header">
      <h2>Configuración global</h2>
      <button class="btn-pri" id="btn-guardar-cfg">Guardar cambios</button>
    </div>

    <div class="cfg-section">
      <div class="cfg-section-title">🏨 Hotel</div>
      <div class="cfg-grid">
        ${field('NOMBRE_HOTEL')}
        ${field('DIVISA')}
      </div>
    </div>

    <div class="cfg-section">
      <div class="cfg-section-title">🕐 Turnos</div>
      <div class="cfg-grid" style="margin-bottom:12px">
        ${field('TURNOS')}
      </div>
      ${codigos.map(cod => {
    const color = state.config[`TURNO_${cod}_COLOR`] || '#888';
    const nombre = state.config[`TURNO_${cod}_NOMBRE`] || cod;
    return `<div class="cfg-turno-card">
          <div class="cfg-turno-label" style="border-left:4px solid ${color}">
            <span style="font-weight:700;font-size:15px;color:${color}">${cod}</span>
            <span style="color:var(--muted);font-size:13px;margin-left:6px">${escapeHtml(nombre)}</span>
          </div>
          <div class="cfg-grid">
            ${field(`TURNO_${cod}_NOMBRE`, 'Nombre que se muestra en la interfaz')}
            ${field(`TURNO_${cod}_HORAS`, 'Horas por defecto del turno cuando no se usan los relojes de entrada/salida')}
            ${field(`TURNO_${cod}_COLOR`, 'Color del turno en hexadecimal (ej: #0f766e)')}
            ${field(`TURNO_${cod}_INICIO`, 'Hora de entrada por defecto al asignar este turno (formato HH:MM, ej: 07:00)')}
            ${field(`TURNO_${cod}_FIN`, 'Hora de salida por defecto al asignar este turno (formato HH:MM, ej: 15:00)')}
          </div>
        </div>`;
  }).join('')}
    </div>

    <div class="cfg-section">
      <div class="cfg-section-title">💰 Costes</div>
      <div class="cfg-grid">
        ${field('PLUS_NOCTURNIDAD')}
        ${field('PLUS_FESTIVO')}
        ${field('COSTE_FIJO_DIARIO')}
      </div>
    </div>

    <div class="cfg-section">
      <div class="cfg-section-title">⚠️ Avisos y descansos</div>
      <div class="cfg-grid">
        ${field('DESCANSO_MIN_HORAS')}
        ${field('MAX_DIAS_CONSECUTIVOS')}
        ${field('ALERTA_HORAS_TURNO')}
      </div>
    </div>

    <div class="cfg-section">
      <div class="cfg-section-title">📊 Presupuesto global</div>
      <div class="cfg-grid">
        ${field('PRESUPUESTO_MENSUAL')}
        ${field('ALERTA_PORCENTAJE')}
      </div>
    </div>

    <div class="cfg-section">
      <div class="cfg-section-title">🎨 Apariencia</div>
      <div class="cfg-grid">
        ${field('COLOR_PRIMARIO')}
        ${field('COLOR_ALERTA')}
      </div>
    </div>
  `;

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
      document.documentElement.style.setProperty('--color-primario', state.config.COLOR_PRIMARIO || '#0f766e');
      document.documentElement.style.setProperty('--color-alerta', state.config.COLOR_ALERTA || '#dc2626');
      render(); toast(`${cambios.length} cambio(s) guardado(s)`, 'success');
    } catch (e) { toast('Error: ' + e.message, 'error'); }
  });
}