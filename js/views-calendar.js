/**
 * views-calendar.js
 * / Vista overview (todos los outlets), calendario mensual y modal de día.
 */

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
              <span class="overview-dept-btn-sub">Front of House</span>
            </button>
            <button class="overview-dept-btn boh" data-outlet="${outlet.id}" data-dept="BOH">
              <span class="overview-dept-btn-label">BOH</span>
              <span class="overview-dept-btn-count">${boh}</span>
              <span class="overview-dept-btn-sub">Back of House</span>
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
function renderCalendario() {
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
    el.addEventListener('click', () => abrirModalDia(el.dataset.fecha));
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
        ? `<span class="horas-badge" style="${a.horas > parseFloat(state.config.ALERTA_HORAS_TURNO || 8) ? 'background:var(--color-alerta)' : ''}">${parseFloat(a.horas).toFixed(1)}h</span>`
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
      <thead><tr><th>Empleado</th><th>Turno</th><th>Entrada → Salida / Horas</th><th>€/h</th><th class="t-right">Coste</th><th></th></tr></thead>
      <tbody>`;
    if (mostrarPorDept) {
      if (filasPorDept.FOH.length > 0) tablaHTML += `<tr class="tabla-emp-group-header"><td colspan="6"><span class="dept-badge foh" style="font-size:11px;padding:2px 8px">FOH</span> Front of House</td></tr>` + filasPorDept.FOH.join('');
      if (filasPorDept.BOH.length > 0) tablaHTML += `<tr class="tabla-emp-group-header"><td colspan="6"><span class="dept-badge boh" style="font-size:11px;padding:2px 8px">BOH</span> Back of House</td></tr>` + filasPorDept.BOH.join('');
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
    if (dispFOH.length > 0) addOpts += `<optgroup label="FOH – Front of House">${dispFOH.map(e => `<option value="${e.id}">${escapeHtml(e.nombre)} (${escapeHtml(e.puesto || '')})</option>`).join('')}</optgroup>`;
    if (dispBOH.length > 0) addOpts += `<optgroup label="BOH – Back of House">${dispBOH.map(e => `<option value="${e.id}">${escapeHtml(e.nombre)} (${escapeHtml(e.puesto || '')})</option>`).join('')}</optgroup>`;
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
      if (field === 'horas') {
        draft[idx].horas = parseFloat(el.value) || 0;
      } else if (field === 'turno') {
        draft[idx].turno = el.value;
        // Apply config defaults for the new turno (only if current times are blank)
        const defs = horasDefaultDeTurno(el.value);
        if (defs.hora_inicio && defs.hora_fin) {
          draft[idx].hora_inicio = defs.hora_inicio;
          draft[idx].hora_fin = defs.hora_fin;
          draft[idx].horas = calcularHorasRango(defs.hora_inicio, defs.hora_fin);
        }
      } else if (field === 'hora_inicio') {
        draft[idx].hora_inicio = el.value;
        if (el.value && draft[idx].hora_fin) {
          draft[idx].horas = calcularHorasRango(el.value, draft[idx].hora_fin);
        }
      } else if (field === 'hora_fin') {
        draft[idx].hora_fin = el.value;
        if (draft[idx].hora_inicio && el.value) {
          draft[idx].horas = calcularHorasRango(draft[idx].hora_inicio, el.value);
        }
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
      const horas = (defs.hora_inicio && defs.hora_fin)
        ? calcularHorasRango(defs.hora_inicio, defs.hora_fin)
        : (turnoHoras[turnoDefault] || 8);
      draft.push({ fecha, empleado_id: id, turno: turnoDefault, horas, hora_inicio: defs.hora_inicio || '', hora_fin: defs.hora_fin || '' });
      renderModalDia(fecha, draft);
    });
  }
}

function cerrarModal() { document.getElementById('modal-root').innerHTML = ''; }

async function guardarDia(fecha, draft) {
  try {
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