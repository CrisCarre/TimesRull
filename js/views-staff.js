/**
 * views-staff.js
 * / Vistas: empleados, disponibilidad, plantillas y reglas de mínimo.
 */

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
  state.disponibilidad.forEach(d => { if (porEmp[d.empleado_id]) porEmp[d.empleado_id].push(d); });
  Object.values(porEmp).forEach(arr => arr.sort((a, b) => a.fecha_inicio.localeCompare(b.fecha_inicio)));

  main.innerHTML = `
    <div class="seccion-header">
      <h2>Disponibilidad</h2>
      <button class="btn-pri" id="btn-nueva-disp">+ Añadir periodo</button>
    </div>
    <p class="info">Vacaciones, bajas y ausencias. Los empleados con periodo activo no aparecerán al asignar turnos en esa fecha.</p>
    ${empsVis.map(emp => {
    const dept = deptDeEmpleado(emp.id);
    return `<div class="emp-disp-card">
        <div class="emp-disp-head">
          <strong>${escapeHtml(emp.nombre)}</strong>
          <span class="puesto">${escapeHtml(emp.puesto || '')}</span>
          ${dept ? `<span class="dept-badge ${DEPT_CLASS[dept]}" style="font-size:10px;padding:1px 6px">${dept}</span>` : ''}
        </div>
        ${porEmp[emp.id].length === 0 ? `<div class="muted-small">Sin periodos registrados.</div>` : `
          <div class="disp-list">
            ${porEmp[emp.id].map(d => `
              <div class="disp-item">
                <span class="disp-tipo" style="background:${tipoDispColor(d.tipo)}">${tipoDispLabel(d.tipo)}</span>
                <span class="disp-rango">${d.fecha_inicio} → ${d.fecha_fin}</span>
                ${d.nota ? `<span class="disp-nota">${escapeHtml(d.nota)}</span>` : ''}
                <button class="btn-mini btn-danger" data-del-disp="${d.id}">×</button>
              </div>`).join('')}
          </div>`}
      </div>`;
  }).join('')}`;

  document.getElementById('btn-nueva-disp').addEventListener('click', () => abrirModalDisponibilidad(empsVis));
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

function abrirModalDisponibilidad(empsVis) {
  const hoy = fechaISO(new Date());
  document.getElementById('modal-root').innerHTML = `
    <div class="modal-backdrop"><div class="modal">
      <div class="modal-head"><h3>Nuevo periodo de no disponibilidad</h3><button class="modal-x" id="modal-cerrar">×</button></div>
      <div class="modal-body form-grid">
        <label>Empleado
          <select id="d-emp">${empsVis.map(e => `<option value="${e.id}">${escapeHtml(e.nombre)}</option>`).join('')}</select>
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
function renderPlantillas() {
  const main = document.getElementById('main');
  const empById = {}; state.empleados.forEach(e => empById[e.id] = e);

  main.innerHTML = `
    <div class="seccion-header">
      <h2>Plantillas de día</h2>
    </div>
    <p class="muted-small" style="margin-bottom:16px">Creadas desde el modal de un día. Haz clic en una para aplicarla.</p>
    ${state.plantillas.length === 0
      ? `<div class="empty-state">Sin plantillas. Ve a un día con asignaciones y pulsa "Guardar como plantilla".</div>`
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
          const emp = empById[a.empleado_id];
          const color = turnoColors[a.turno] || '#888';
          return `<div class="ptcard-row">
                    <span class="ptcard-dot" style="background:${color}"></span>
                    <span class="ptcard-emp">${emp ? escapeHtml(emp.nombre) : `<em style="color:var(--muted)">Eliminado</em>`}</span>
                    <span class="ptcard-turno" style="color:${color}">${a.turno}</span>
                    <span class="ptcard-horas">${parseFloat(a.horas).toFixed(1)}h</span>
                  </div>`;
        }).join('')}
              </div>
            </div>`;
      }).join('')}
        </div>`
    }`;

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
function renderReglas() {
  const main = document.getElementById('main');
  const dowNames = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  const puestosUnicos = [...new Set(state.empleados.map(e => e.puesto).filter(Boolean))].sort();

  main.innerHTML = `
    <div class="seccion-header">
      <h2>Reglas de mínimo de personal</h2>
      <button class="btn-pri" id="btn-nueva-regla">+ Añadir regla</button>
    </div>
    <p class="info">Mínimo por día de semana, turno y puesto. Si no se cumple, aparece aviso rojo en el calendario.</p>
    ${state.reglasMinimo.length === 0 ? `<div class="empty-state">Sin reglas.</div>` : `
      <table class="tabla-emp">
        <thead><tr><th>Día</th><th>Turno</th><th>Puesto</th><th>Mínimo</th><th></th></tr></thead>
        <tbody>
          ${state.reglasMinimo.slice().sort((a, b) => a.dia_semana - b.dia_semana || a.turno.localeCompare(b.turno)).map(r => `
            <tr>
              <td>${dowNames[r.dia_semana]}</td>
              <td>${r.turno} – ${escapeHtml(turnoNombres[r.turno] || '')}</td>
              <td>${r.puesto ? escapeHtml(r.puesto) : '<em>cualquiera</em>'}</td>
              <td>${r.minimo}</td>
              <td class="t-right"><button class="btn-mini btn-danger" data-del-regla="${r.id}">×</button></td>
            </tr>`).join('')}
        </tbody>
      </table>`}`;

  document.getElementById('btn-nueva-regla').addEventListener('click', () => {
    document.getElementById('modal-root').innerHTML = `
      <div class="modal-backdrop"><div class="modal">
        <div class="modal-head"><h3>Nueva regla</h3><button class="modal-x" id="modal-cerrar">×</button></div>
        <div class="modal-body form-grid">
          <label>Día <select id="r-dow">${[1, 2, 3, 4, 5, 6, 7].map(i => `<option value="${i}">${dowNames[i]}</option>`).join('')}</select></label>
          <label>Turno <select id="r-turno">${turnosOrden.map(t => `<option value="${t}">${t} – ${escapeHtml(turnoNombres[t])}</option>`).join('')}</select></label>
          <label>Puesto <select id="r-puesto"><option value="">— cualquiera —</option>${puestosUnicos.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('')}</select></label>
          <label>Mínimo <input type="number" min="1" step="1" id="r-min" value="1"></label>
        </div>
        <div class="modal-foot">
          <button class="btn-sec" id="btn-cancelar">Cancelar</button>
          <button class="btn-pri" id="btn-guardar">Crear</button>
        </div>
      </div></div>`;
    document.getElementById('modal-cerrar').addEventListener('click', cerrarModal);
    document.getElementById('btn-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('btn-guardar').addEventListener('click', async () => {
      const payload = { dia_semana: parseInt(document.getElementById('r-dow').value), turno: document.getElementById('r-turno').value, puesto: document.getElementById('r-puesto').value || null, minimo: parseInt(document.getElementById('r-min').value) || 1 };
      try { const { data, error } = await supabase.from('reglas_minimo').insert([payload]).select().single(); if (error) throw error; state.reglasMinimo.push(data); cerrarModal(); render(); toast('Regla creada', 'success'); }
      catch (e) { toast('Error: ' + e.message, 'error'); }
    });
  });
  document.querySelectorAll('[data-del-regla]').forEach(b => {
    b.addEventListener('click', async () => {
      const id = parseInt(b.dataset.delRegla);
      try { const { error } = await supabase.from('reglas_minimo').delete().eq('id', id); if (error) throw error; state.reglasMinimo = state.reglasMinimo.filter(r => r.id !== id); render(); toast('Eliminada', 'success'); }
      catch (e) { toast('Error: ' + e.message, 'error'); }
    });
  });
}