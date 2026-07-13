/**
 * views-reports.js
 * / Resumen mensual: KPIs, gráfica de barras y tabla por empleado.
 */

/* =====================================================================
   VISTA RESUMEN MES
   ===================================================================== */
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
  const ritmoDiario = presupuesto > 0 ? presupuesto / diasM : 0;
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
    <h3>Coste diario</h3>
    <div class="grafica-dias">
      ${dias.length === 0 ? '<div class="empty-state" style="width:100%">Sin datos</div>' :
      (() => {
        const mx = Math.max(...dias.map(([, r]) => r.total));
        return dias.map(([f, r]) => {
          const fobj = parseISO(f);
          const h = mx > 0 ? (r.total / mx * 100) : 0;
          const esFestivo = !!state.festivos[f];
          const sobrePresupuesto = ritmoDiario > 0 && r.total > ritmoDiario;
          return `<div class="bar-col ${esFestivo ? 'festivo' : ''}" title="${f}${esFestivo ? ` – ${state.festivos[f]}` : ''} – ${divisa(r.total)}">
    <div class="bar" style="height:${h}%;background:${sobrePresupuesto ? 'var(--color-alerta)' : 'var(--color-primario)'}"></div>
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

