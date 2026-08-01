/**
 * export.js
 * /Exportación a PDF (semana y mes), Excel (.xlsx) y CSV.
 */

/* =====================================================================
   EXPORTACIÓN
   ===================================================================== */
function nombreArchivo(prefijo, sufijoFecha) {
  const hotel=(state.config.NOMBRE_HOTEL||'hotel').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  const outlet=ctxOutlet();
  const outletSlug=outlet?`_${outlet.nombre.toLowerCase().replace(/[^a-z0-9]+/g,'-')}`:'';
  const deptSlug=state.ctxDept!=='ALL'?`_${state.ctxDept.toLowerCase()}`:'';
  return `${hotel}${outletSlug}${deptSlug}_${prefijo}_${sufijoFecha}`;
}

function exportarPDFSemana() {
  if(!window.jspdf){toast('jsPDF no cargado','error');return;}
  const {jsPDF}=window.jspdf;
  const lunes=state.cursorSemana;
  const dias=diasSemana(lunes);
  const finSem=dias[6];
  const doc=new jsPDF({orientation:'landscape',unit:'mm',format:'a4'});
  const outlet=ctxOutlet();
  const dowLabels=['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];

  doc.setFontSize(16);doc.setFont(undefined,'bold');
  doc.text(state.config.NOMBRE_HOTEL||'Hotel',14,14);
  doc.setFontSize(11);doc.setFont(undefined,'normal');
  doc.text(`Cuadrante semanal${outlet?` – ${outlet.nombre} (${state.ctxDept==='ALL'?'FOH+BOH':state.ctxDept})`:''}: ${fechaISO(lunes)} — ${fechaISO(finSem)}`,14,21);

  const empCtx=empleadosEnContexto();
  const head=[['Empleado','Puesto',...(outlet?['Dept']:[]),...dias.map((d,i)=>`${dowLabels[i]} ${d.getDate()}`),'Σ h',`Σ ${state.config.DIVISA||'€'}`]];

  let totalSemana=0;
  const body=empCtx.map(emp=>{
    let horas=0,total=0;
    const cells=dias.map(d=>{
      const f=fechaISO(d);
      const a=state.planificacion.find(x=>x.fecha===f&&x.empleado_id===emp.id);
      const noDisp=empleadoNoDisponible(emp.id,f);
      if(noDisp) return `[${tipoDispLabel(noDisp.tipo)[0]}]`;
      if(!a) return '';
      const c=calcularCoste(a,emp,!!state.festivos[f]);
      horas+=a.horas;total+=c.total;
      return `${a.turno} ${a.horas}h`;
    });
    totalSemana+=total;
    const dept=deptDeEmpleado(emp.id)||'';
    return [emp.nombre,emp.puesto||'',...(outlet?[dept]:[]),...cells,horas.toFixed(1),total.toFixed(2)];
  });

  const totalesDia=dias.map(d=>{const t=totalDia(fechaISO(d));return t?t.total.toFixed(2):'—';});
  const foot=[['TOTAL DÍA','',...(outlet?['']: []),...totalesDia,'',totalSemana.toFixed(2)]];

  doc.autoTable({head,body,foot,startY:26,theme:'striped',
    headStyles:{fillColor:hexToRgb(state.config.COLOR_PRIMARIO||'#0f766e'),textColor:255,fontSize:9},
    bodyStyles:{fontSize:8},
    footStyles:{fillColor:[240,240,240],textColor:0,fontStyle:'bold',fontSize:9},
    columnStyles:{0:{cellWidth:30,fontStyle:'bold'},1:{cellWidth:22}},
  });
  doc.setFontSize(8);doc.setTextColor(120);
  doc.text(`Generado el ${new Date().toLocaleString('es-ES')}`,14,doc.lastAutoTable.finalY+8);
  doc.save(`${nombreArchivo('cuadrante_semana',fechaISO(lunes))}.pdf`);
  toast('PDF generado','success');
}

function exportarPDFMes() {
  if(!window.jspdf){toast('jsPDF no cargado','error');return;}
  const {jsPDF}=window.jspdf;
  const cur=state.cursorMes;
  const year=cur.getFullYear();const mes=cur.getMonth();
  const meses=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const prefijo=`${year}-${String(mes+1).padStart(2,'0')}`;
  const outlet=ctxOutlet();
  const doc=new jsPDF({orientation:'portrait',unit:'mm',format:'a4'});

  doc.setFontSize(16);doc.setFont(undefined,'bold');
  doc.text(state.config.NOMBRE_HOTEL||'Hotel',14,16);
  doc.setFontSize(12);doc.setFont(undefined,'normal');
  doc.text(`Resumen ${meses[mes]} ${year}${outlet?` – ${outlet.nombre} (${state.ctxDept==='ALL'?'FOH+BOH':state.ctxDept})`:''}`,14,23);

  const diasM=new Date(year,mes+1,0).getDate();
  let totalMes=0,totalPersonal=0,totalFijo=0,diasPlan=0;
  for(let d=1;d<=diasM;d++){const f=fechaISO(new Date(year,mes,d));const t=totalDia(f);if(t){totalMes+=t.total;totalPersonal+=t.personal;totalFijo+=t.fijo;diasPlan++;}}
  const presupuesto=presupuestoCtx();

  doc.autoTable({startY:30,head:[['Concepto','Valor']],
    body:[
      ['Días planificados',`${diasPlan} / ${diasM}`],
      ['Coste personal',`${totalPersonal.toFixed(2)} ${state.config.DIVISA||'€'}`],
      ['Coste fijo',`${totalFijo.toFixed(2)} ${state.config.DIVISA||'€'}`],
      [{content:'TOTAL MES',styles:{fontStyle:'bold'}},{content:`${totalMes.toFixed(2)} ${state.config.DIVISA||'€'}`,styles:{fontStyle:'bold'}}],
      ...(presupuesto>0?[['Presupuesto',`${presupuesto.toFixed(2)} ${state.config.DIVISA||'€'}`],['Diferencia',`${(presupuesto-totalMes).toFixed(2)} ${state.config.DIVISA||'€'}`],['Consumido',`${(totalMes/presupuesto*100).toFixed(1)}%`]]:[] ),
    ],
    theme:'plain',headStyles:{fillColor:hexToRgb(state.config.COLOR_PRIMARIO||'#0f766e'),textColor:255},
    columnStyles:{1:{halign:'right'}},
  });

  const porEmp={};
  planificacionCtx().filter(a=>a.fecha.startsWith(prefijo)).forEach(a=>{
    const emp=state.empleados.find(e=>e.id===a.empleado_id);if(!emp) return;
    const c=calcularCoste(a,emp,!!state.festivos[a.fecha]);
    const dept=deptDeEmpleado(emp.id)||'';
    if(!porEmp[emp.id]) porEmp[emp.id]={nombre:emp.nombre,puesto:emp.puesto||'',dept,horas:0,base:0,plusN:0,plusF:0,total:0};
    porEmp[emp.id].horas+=a.horas;porEmp[emp.id].base+=c.base;porEmp[emp.id].plusN+=c.plusN;porEmp[emp.id].plusF+=c.plusF;porEmp[emp.id].total+=c.total;
  });
  const empOrdenados=Object.values(porEmp).sort((a,b)=>b.total-a.total);
  if(empOrdenados.length>0){
    doc.autoTable({startY:doc.lastAutoTable.finalY+8,
      head:[['Empleado','Puesto',...(outlet?['Dept']:[]),'Horas','Base','Plus N','Plus F','Total']],
      body:empOrdenados.map(e=>[e.nombre,e.puesto,...(outlet?[e.dept]:[]),e.horas.toFixed(1),e.base.toFixed(2),e.plusN.toFixed(2),e.plusF.toFixed(2),{content:e.total.toFixed(2),styles:{fontStyle:'bold'}}]),
      theme:'striped',headStyles:{fillColor:hexToRgb(state.config.COLOR_PRIMARIO||'#0f766e'),textColor:255,fontSize:9},bodyStyles:{fontSize:9},
    });
  }
  doc.setFontSize(8);doc.setTextColor(120);
  doc.text(`Generado el ${new Date().toLocaleString('es-ES')}`,14,doc.internal.pageSize.height-8);
  doc.save(`${nombreArchivo('resumen_mes',prefijo)}.pdf`);
  toast('PDF generado','success');
}

function exportarExcelMes() {
  if(!window.XLSX){toast('SheetJS no cargado','error');return;}
  const cur=state.cursorMes;
  const year=cur.getFullYear();const mes=cur.getMonth();
  const meses=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const prefijo=`${year}-${String(mes+1).padStart(2,'0')}`;
  const outlet=ctxOutlet();

  const diasM=new Date(year,mes+1,0).getDate();
  let totalMes=0,totalPersonal=0,totalFijo=0,diasPlan=0;
  for(let d=1;d<=diasM;d++){const f=fechaISO(new Date(year,mes,d));const t=totalDia(f);if(t){totalMes+=t.total;totalPersonal+=t.personal;totalFijo+=t.fijo;diasPlan++;}}
  const presupuesto=presupuestoCtx();

  const resumenAOA=[[state.config.NOMBRE_HOTEL||'Hotel'],[`Resumen ${meses[mes]} ${year}${outlet?` – ${outlet.nombre} (${state.ctxDept})`:''}` ],[],
    ['Días planificados',diasPlan,`de ${diasM}`],['Coste personal',totalPersonal],['Coste fijo',totalFijo],['TOTAL MES',totalMes],
    ...(presupuesto>0?[[],['Presupuesto mensual',presupuesto],['Diferencia',presupuesto-totalMes],['% consumido',totalMes/presupuesto]]:[])
  ];
  const wsRes=XLSX.utils.aoa_to_sheet(resumenAOA);
  wsRes['!cols']=[{wch:24},{wch:16},{wch:12}];

  const porEmp={};
  planificacionCtx().filter(a=>a.fecha.startsWith(prefijo)).forEach(a=>{
    const emp=state.empleados.find(e=>e.id===a.empleado_id);if(!emp) return;
    const c=calcularCoste(a,emp,!!state.festivos[a.fecha]);
    const dept=deptDeEmpleado(emp.id)||'';
    if(!porEmp[emp.id]) porEmp[emp.id]={Nombre:emp.nombre,Puesto:emp.puesto||'',Departamento:dept,Local:outlet?outlet.nombre:'',' Coste/hora':emp.coste_hora,'Horas totales':0,'Base':0,'Plus nocturnidad':0,'Plus festivo':0,'Total bruto':0};
    porEmp[emp.id]['Horas totales']+=a.horas;porEmp[emp.id]['Base']+=c.base;porEmp[emp.id]['Plus nocturnidad']+=c.plusN;porEmp[emp.id]['Plus festivo']+=c.plusF;porEmp[emp.id]['Total bruto']+=c.total;
  });
  const empArr=Object.values(porEmp).sort((a,b)=>b['Total bruto']-a['Total bruto']);
  empArr.forEach(e=>{['Horas totales','Base','Plus nocturnidad','Plus festivo','Total bruto'].forEach(k=>e[k]=parseFloat(e[k].toFixed(2)));});
  const wsEmp=empArr.length>0?XLSX.utils.json_to_sheet(empArr):XLSX.utils.aoa_to_sheet([['Sin asignaciones']]);
  wsEmp['!cols']=[{wch:22},{wch:16},{wch:12},{wch:16},{wch:12},{wch:14},{wch:12},{wch:18},{wch:14},{wch:14}];

  const detalle=[];
  planificacionCtx().filter(a=>a.fecha.startsWith(prefijo)).sort((a,b)=>a.fecha.localeCompare(b.fecha)).forEach(a=>{
    const emp=state.empleados.find(e=>e.id===a.empleado_id);if(!emp) return;
    const esFest=!!state.festivos[a.fecha];const c=calcularCoste(a,emp,esFest);
    const dept=deptDeEmpleado(emp.id)||'';
    detalle.push({Fecha:a.fecha,Local:outlet?outlet.nombre:'',Departamento:dept,Empleado:emp.nombre,Puesto:emp.puesto||'',Turno:`${a.turno} (${turnoNombres[a.turno]||''})`,Horas:parseFloat(a.horas),'Coste/hora':emp.coste_hora,Base:parseFloat(c.base.toFixed(2)),'Plus N':parseFloat(c.plusN.toFixed(2)),'Plus F':parseFloat(c.plusF.toFixed(2)),Festivo:esFest?(state.festivos[a.fecha]||'Sí'):'',Total:parseFloat(c.total.toFixed(2))});
  });
  const wsDet=detalle.length>0?XLSX.utils.json_to_sheet(detalle):XLSX.utils.aoa_to_sheet([['Sin asignaciones']]);

  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,wsRes,'Resumen');
  XLSX.utils.book_append_sheet(wb,wsEmp,'Por empleado');
  XLSX.utils.book_append_sheet(wb,wsDet,'Detalle diario');
  XLSX.writeFile(wb,`${nombreArchivo('mes_gestoria',prefijo)}.xlsx`);
  toast('Excel generado','success');
}

function exportarCSVMes() {
  const cur=state.cursorMes;
  const year=cur.getFullYear();const mes=cur.getMonth();
  const prefijo=`${year}-${String(mes+1).padStart(2,'0')}`;
  const outlet=ctxOutlet();
  const lines=[['fecha','local','departamento','empleado','puesto','turno','horas','base','plus_noct','plus_fest','festivo','total']];
  planificacionCtx().filter(a=>a.fecha.startsWith(prefijo)).sort((a,b)=>a.fecha.localeCompare(b.fecha)).forEach(a=>{
    const emp=state.empleados.find(e=>e.id===a.empleado_id);if(!emp) return;
    const esFest=!!state.festivos[a.fecha];const c=calcularCoste(a,emp,esFest);
    const dept=deptDeEmpleado(emp.id)||'';
    lines.push([a.fecha,outlet?outlet.nombre:'',dept,emp.nombre,emp.puesto||'',a.turno,a.horas,c.base.toFixed(2),c.plusN.toFixed(2),c.plusF.toFixed(2),esFest?(state.festivos[a.fecha]||'Si'):'',c.total.toFixed(2)]);
  });
  if(lines.length===1){toast('Sin datos','');return;}
  const csv=lines.map(row=>row.map(v=>{const s=String(v);return(s.includes(',')||s.includes('"')||s.includes('\n'))?`"${s.replace(/"/g,'""')}"`:s;}).join(',')).join('\n');
  const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=`${nombreArchivo('mes',prefijo)}.csv`;
  document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);
  toast('CSV generado','success');
}

function hexToRgb(hex){
  const h=hex.replace('#','');
  return h.length===3?h.split('').map(c=>parseInt(c+c,16)):[parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)];
}
