/**
 * render.js
 * /Render principal: topbar, selector de contexto y routing de vistas.
 */

/* =====================================================================
   RENDER PRINCIPAL
   ===================================================================== */
function render() {
  const outlet = ctxOutlet();
  const hasOutlets = state.outlets.length > 0;

  // Build dept buttons HTML
  const deptButtons = hasOutlets && state.ctxOutletId ? DEPTS.map(d => {
    const isActive = state.ctxDept === d;
    const cls = isActive ? `dept-badge active-${DEPT_CLASS[d]}` : `dept-badge ${DEPT_CLASS[d]}`;
    return `<button class="${cls}" data-dept="${d}">${d} <span style="font-size:10px;font-weight:400">${DEPT_LABELS[d]}</span></button>`;
  }).join('') + `<button class="${state.ctxDept==='ALL'?'dept-badge active-all':'dept-badge all'}" data-dept="ALL">Ambos</button>` : '';

  const empCount = empleadosEnContexto().length;

  document.getElementById('root').innerHTML = `
    <header class="topbar">
      <div class="brand">
        <strong>${escapeHtml(state.config.NOMBRE_HOTEL||'Hotel')}</strong>
        <span class="user">${escapeHtml(state.user?.email||'')}</span>
      </div>

      ${hasOutlets ? `
        <div class="ctx-strip">
          <span class="ctx-label">Local</span>
          <select class="ctx-select" id="ctx-outlet-sel">
            ${state.outlets.map(o=>`<option value="${o.id}" ${o.id===state.ctxOutletId?'selected':''}>${o.icono||''} ${escapeHtml(o.nombre)}</option>`).join('')}
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
          <button data-view="overview" class="${state.view==='overview'?'active':''}">Vista general</button>
        ` : ''}
        ${state.ctxOutletId ? `
          <button data-view="calendario" class="${state.view==='calendario'?'active':''}">Calendario</button>
          <button data-view="semana" class="${state.view==='semana'?'active':''}">Semana</button>
          <button data-view="mes" class="${state.view==='mes'?'active':''}">Resumen mes</button>
        ` : ''}
        <button data-view="empleados" class="${state.view==='empleados'?'active':''}">Empleados</button>
        <button data-view="disponibilidad" class="${state.view==='disponibilidad'?'active':''}">Disponibilidad</button>
        <button data-view="plantillas" class="${state.view==='plantillas'?'active':''}">Plantillas</button>
        <button data-view="reglas" class="${state.view==='reglas'?'active':''}">Reglas</button>
        <button data-view="outlets" class="${state.view==='outlets'?'active':''}">Locales</button>
        <button data-view="config" class="${state.view==='config'?'active':''}">Config</button>
      </nav>
      <button class="logout" id="btn-logout">Salir</button>
    </header>

    ${state.ctxOutletId ? `
      <div class="ctx-banner">
        <span>Viendo:</span>
        <span class="ctx-banner-outlet">${outlet?.icono||''} ${escapeHtml(outlet?.nombre||'')}</span>
        <span class="ctx-banner-sep">|</span>
        <span class="ctx-banner-dept ${DEPT_CLASS[state.ctxDept]}">${state.ctxDept==='ALL'?'FOH + BOH':state.ctxDept}</span>
        <span class="ctx-banner-sep">·</span>
        <span class="ctx-banner-count">${empCount} empleado${empCount!==1?'s':''}</span>
      </div>
    ` : ''}

    <main id="main"></main>
    <div id="modal-root"></div>
  `;

  // Events
  document.querySelectorAll('.tabs button').forEach(b=>{
    b.addEventListener('click',()=>{ state.view=b.dataset.view; render(); });
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
  document.querySelectorAll('[data-dept]').forEach(b=>{
    b.addEventListener('click',()=>{ state.ctxDept=b.dataset.dept; render(); });
  });

  // Route view
  if (state.view==='overview') renderOverview();
  else if (state.view==='calendario') renderCalendario();
  else if (state.view==='semana') renderSemana();
  else if (state.view==='mes') renderResumenMes();
  else if (state.view==='empleados') renderEmpleados();
  else if (state.view==='disponibilidad') renderDisponibilidad();
  else if (state.view==='plantillas') renderPlantillas();
  else if (state.view==='reglas') renderReglas();
  else if (state.view==='outlets') renderOutlets();
  else if (state.view==='config') renderConfig();
}

