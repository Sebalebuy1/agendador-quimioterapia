/* Interfaz del agendador: ingreso manual de pacientes sobre el motor (motor.js) y el modelo (modelo.json). */
(function () {
  'use strict';
  const CLAVE = 'agendador-quimio-v1';
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const COLORES = { P1: '#E63946', P2: '#E08C56', P3: '#2F6E9E', P4: '#6C5DD3' };

  let datos, cfg, agenda, fechaInicio, diaVista = 0, resaltado = null;
  let prop = null, entradaActual = null, previas = {}, opcionSel = null, aviso = '';
  const form = { cat: 2, kappa: 1, turno: null };

  // ── Fechas: dias habiles desde el inicio de la agenda ──
  const fechas = [];
  function fecha(k) {
    while (fechas.length <= k) {
      const d = new Date(fechas.length ? fechas[fechas.length - 1] : fechaInicio);
      if (fechas.length) { do d.setDate(d.getDate() + 1); while (d.getDay() === 0 || d.getDay() === 6); }
      fechas.push(d);
    }
    return fechas[k];
  }
  const corta = k => { const d = fecha(k); return `${DIAS[d.getDay()].slice(0, 3)} ${d.getDate()}/${d.getMonth() + 1}`; };
  const larga = k => { const d = fecha(k); return `${DIAS[d.getDay()][0].toUpperCase() + DIAS[d.getDay()].slice(1)} ${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`; };
  const corridos = (k0, k1) => Math.round((fecha(k1) - fecha(k0)) / 86400000);
  const hora = b => { const m = cfg.HORA_INI * 60 + b * cfg.BLOQUE_MIN; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
  const num = (v, d = 1) => v.toFixed(d).replace('.', ',');
  function inicioHoy() {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    return d;
  }
  const catNom = c => cfg.CAT_ORDER[c];
  const catCfg = c => cfg.CATEGORIAS[catNom(c)];
  const turnoNom = s => cfg.NOMBRES_TURNO[s];
  const cumpleGes = p => corridos(p.a, p.inicio) <= catCfg(p.cat).plazo_corridos;

  // ── Persistencia en el navegador ──
  function guardar() {
    try { localStorage.setItem(CLAVE, JSON.stringify({ fechaInicio: fechaInicio.toISOString(), agenda: agenda.exportar(),
      regimen: $('cfgRegimen').value, semilla: +$('cfgSemilla').value })); } catch (e) { /* sin almacenamiento */ }
  }
  function recuperar() {
    try {
      const j = JSON.parse(localStorage.getItem(CLAVE) || 'null');
      if (!j || !datos.modelos[String(j.agenda.opts.sillones)]) return false;
      agenda = Motor.Agenda.importar(datos, j.agenda); fechaInicio = new Date(j.fechaInicio); fechas.length = 0;
      $('cfgSillones').value = j.agenda.opts.sillones; $('cfgGamma').value = j.agenda.opts.gamma;
      $('cfgM').value = j.agenda.opts.m; $('cfgRatio').value = j.agenda.opts.ratio;
      $('cfgRegimen').value = j.regimen; $('cfgSemilla').value = j.semilla;
      return true;
    } catch (e) { return false; }
  }
  function nuevaAgenda() {
    const opts = { sillones: +$('cfgSillones').value, gamma: +$('cfgGamma').value, m: +$('cfgM').value, ratio: +$('cfgRatio').value };
    agenda = new Motor.Agenda(datos, opts);
    agenda.generarInicial(+$('cfgSemilla').value || 42, $('cfgRegimen').value);
    fechaInicio = inicioHoy(); fechas.length = 0; diaVista = 0; limpiarPropuesta();
    guardar();
  }

  // ── Formulario de ingreso ──
  function armarFormulario() {
    $('inCat').innerHTML = cfg.CAT_ORDER.map((k, c) => {
      const x = cfg.CATEGORIAS[k];
      return `<button type="button" class="cat" data-c="${c}" style="color:${COLORES[k]}"><b>${k} · ${esc(x.nombre)}</b>` +
             `<span>${x.urgente ? 'Urgente' : 'Programado'} · plazo ${x.plazo_corridos} días</span></button>`;
    }).join('');
    $('inCat').onclick = e => { const b = e.target.closest('.cat'); if (b) { form.cat = +b.dataset.c; actualizarFormulario(true); } };
    for (const id of ['inKappa', 'inTurno']) $(id).onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      [...$(id).children].forEach(x => x.classList.toggle('on', x === b));
      if (id === 'inKappa') form.kappa = +b.dataset.v; else form.turno = b.dataset.v === '' ? null : +b.dataset.v;
    };
    $('inDur').oninput = () => { $('inDurTxt').textContent = `${$('inDur').value} min`; };
    $('inPrep').oninput = actualizarPrep;
    actualizarFormulario(true);
  }
  function actualizarFormulario(reiniciarPrep) {
    [...$('inCat').children].forEach(b => b.classList.toggle('on', +b.dataset.c === form.cat));
    const probs = cfg.PROT_PROBS[form.cat];
    const hab = cfg.PROTOCOLOS.map((p, k) => k).filter(k => probs[k] > 0).sort((a, b) => probs[b] - probs[a]);
    const otros = cfg.PROTOCOLOS.map((p, k) => k).filter(k => probs[k] === 0);
    const op = k => { const p = cfg.PROTOCOLOS[k]; return `<option value="${k}">${esc(p.nombre)} · ${esc(p.esquema)} (${p.offsets.length} sesiones en 12 semanas) — ${esc(p.uso)}</option>`; };
    $('inProt').innerHTML = `<optgroup label="Habituales para ${catNom(form.cat)}">${hab.map(op).join('')}</optgroup>` +
                            `<optgroup label="Otros protocolos">${otros.map(op).join('')}</optgroup>`;
    if (reiniciarPrep) $('inPrep').value = catCfg(form.cat).listo[0];
    $('inDurTxt').textContent = `${$('inDur').value} min`;
    actualizarPrep();
  }
  function actualizarPrep() {
    const v = +$('inPrep').value, [lo, hi] = catCfg(form.cat).listo, r = agenda.diaActual + v;
    $('inPrepTxt').textContent = `${v} día${v === 1 ? '' : 's'} hábil${v === 1 ? '' : 'es'}`;
    $('inPrepAyuda').textContent = `Listo para iniciar el ${corta(r)}. Rango habitual para ${catNom(form.cat)}: ${lo}–${hi} días (exámenes previos, validación de farmacia, catéter).`;
  }

  // ── Propuesta ──
  function calcular(e) {
    e.preventDefault();
    entradaActual = { cat: form.cat, prot: +$('inProt').value, dur: Math.ceil(+$('inDur').value / cfg.BLOQUE_MIN), kappa: form.kappa,
      prep: +$('inPrep').value, turno: form.turno, nombre: $('inNombre').value.trim() };
    prop = agenda.proponer(entradaActual);
    previas = {};
    for (const op of ['estandar', 'reacomodo']) if (prop[op]) {
      const copia = agenda.copia(), res = copia.aplicar(prop, op, entradaActual.nombre);
      previas[op] = { agenda: copia, ...res };
    }
    opcionSel = prop.reacomodo ? 'reacomodo' : prop.estandar ? 'estandar' : null;
    aviso = '';
    if (opcionSel) diaVista = prop[opcionSel].t;
    render();
  }
  function limpiarPropuesta() { prop = null; previas = {}; opcionSel = null; }
  function confirmar(op) {
    const res = agenda.aplicar(prop, op, entradaActual.nombre);
    const p = res.pac, movidas = res.cambios.filter(c => c.de !== c.a).length;
    aviso = `<div class="resumen"><b>${esc(p.pid)} · ${esc(p.nombre)} agendado.</b> Inicia el ${larga(p.inicio)} a las ${hora(agenda.sesiones[p.sesiones[0]].bloque)}, ` +
            `Sillón ${p.sillon + 1} · turno ${turnoNom(p.turno)}, ${p.sesiones.length} sesiones.` +
            (movidas ? ` Se reacomodaron ${movidas} sesión(es) de otros pacientes.` : '') + '</div>';
    resaltado = p.pid; diaVista = p.inicio; limpiarPropuesta();
    $('inNombre').value = '';
    guardar(); render();
  }
  function tarjetaOpcion(op) {
    const sol = prop[op], pr = previas[op], p = pr.pac, c = catCfg(prop.cat);
    const espera = sol.t - prop.a, ok = corridos(prop.a, sol.t) <= c.plazo_corridos;
    const inicioHora = hora(pr.agenda.sesiones[p.sesiones[0]].bloque);
    const exc = agenda.srv.conAgudeza ? agenda.srv.excesoIncremental(cfg.PROTOCOLOS[prop.prot].offsets.map(o => sol.t + o), prop.kappa)[sol.s] : 0;
    const titulo = op === 'estandar' ? 'Opción A · Agenda estándar del modelo'
      : `Opción B · Empieza ${prop.estandar ? (prop.estandar.t - sol.t) + ' día(s) hábil(es) antes' : 'antes'} con reacomodo`;
    let mov = '';
    if (op === 'reacomodo') {
      const movidas = pr.cambios.filter(x => x.de !== x.a), horas = pr.cambios.filter(x => x.de === x.a);
      const quien = id => { const q = agenda.pacientePorId(id); return `${esc(id)}${q && !q.previo ? ' · ' + esc(q.nombre) : ''}`; };
      mov = `<div class="mov"><b>Cambios propuestos a otros pacientes</b> (misma fecha, turno y protocolo):<ul>` +
        movidas.map(x => `<li>${quien(x.pid)} · ${corta(x.dia)} ${turnoNom(x.turno)}: Sillón ${x.de + 1} → <b>Sillón ${x.a + 1}</b>, ${hora(x.bloqueAntes)} → <b>${hora(x.bloque)}</b></li>`).join('') +
        horas.map(x => `<li>${quien(x.pid)} · ${corta(x.dia)} ${turnoNom(x.turno)}, Sillón ${x.a + 1}: hora ${hora(x.bloqueAntes)} → <b>${hora(x.bloque)}</b></li>`).join('') +
        `</ul></div>`;
    }
    return `<div class="opcion ${opcionSel === op ? 'sel' : ''}" data-op="${op}">
      <h4><span>${titulo}</span><span class="ges ${ok ? 'ok' : 'no'}">${ok ? 'Dentro de plazo GES' : 'Fuera de plazo GES'}</span></h4>
      <div class="det">
        <div><b>Inicio:</b> ${larga(sol.t)}, ${inicioHora}</div>
        <div><b>Sillón ${sol.l + 1}</b> · turno ${turnoNom(sol.s)} · espera ${espera} día(s) hábil(es), ${corridos(prop.a, sol.t)} corridos (plazo ${c.plazo_corridos})</div>
        <div class="chips">${p.sesiones.map((id, j) => `<span title="Sesión ${j + 1}">${corta(pr.agenda.sesiones[id].dia)}</span>`).join('')}</div>
        ${exc > 0 ? `<div class="ref">Agrega ${num(exc, 0)} punto(s) de sobrecarga de enfermería en esas fechas.</div>` : ''}
      </div>${mov}
      <div class="acciones"><button class="pri" data-confirmar="${op}">Agendar esta opción</button></div>
    </div>`;
  }
  function renderPropuesta() {
    if (!prop) { $('propuesta').innerHTML = aviso; return; }
    const c = catCfg(prop.cat), proto = cfg.PROTOCOLOS[prop.prot];
    const resumen = prop.urgente
      ? `<b>${catNom(prop.cat)} · urgente.</b> Va a la primera fecha disponible desde que está listo (${corta(prop.r)}), sin predicción, como en el Algoritmo 2.`
      : `<b>${catNom(prop.cat)} · programado.</b> El modelo predice una espera ideal de <b>${num(prop.w)} días hábiles</b> (w̄ = ${prop.wbar}): ` +
        `busca fecha desde el ${corta(prop.desde)} para dejar espacio a urgentes que aún no llegan. Reserva γ = ${Math.round(prop.gamma * 100)}%.`;
    const ref = prop.greedy ? `Regla de referencia (greedy, Pham et al.): inicio el ${corta(prop.greedy.t)} en Sillón ${prop.greedy.l + 1} ${turnoNom(prop.greedy.s)}.`
                            : 'Regla de referencia (greedy, Pham et al.): sin fecha disponible.';
    let html = `<div class="resumen">${resumen}<br><span class="ref">${esc(proto.nombre)} · ${proto.offsets.length} sesiones de ${prop.dur * cfg.BLOQUE_MIN} min · agudeza ${prop.kappa} · plazo ${corta(prop.d)} (${c.plazo_corridos} días corridos)</span></div>`;
    if (prop.reacomodo) html += tarjetaOpcion('reacomodo');
    if (prop.estandar) html += tarjetaOpcion('estandar');
    else html += `<div class="resumen"><b>Sin fecha disponible</b> en el horizonte de la agenda con estas condiciones. Prueba otro turno o revisa la configuración.</div>`;
    html += `<div class="ref">${ref}</div><div class="acciones"><button class="sec" id="btnCancelar">Descartar propuesta</button></div>`;
    $('propuesta').innerHTML = html;
  }

  // ── Vista: agenda mostrada (con vista previa si hay una opcion seleccionada) ──
  const vista = () => (prop && opcionSel && previas[opcionSel]) ? previas[opcionSel].agenda : agenda;

  function renderKPIs() {
    const ag = agenda, srv = ag.srv, d0 = ag.diaActual;
    let oc = 0, act = 0, sobre = 0;
    for (let t = d0; t < d0 + 10; t++) {
      oc += srv.ocupacion(t);
      for (let s = 0; s < srv.S; s++) if (srv.abiertos(t, s)) { act++; if (srv.cargaTurno(t, s) > srv.capCarga(t, s)) sobre++; }
    }
    const nuevos = ag.pacientes.filter(p => !p.previo), enTrat = ag.pacientes.filter(p => p.sesiones.some(id => ag.sesiones[id].dia >= d0)).length;
    const ges = nuevos.length ? Math.round(nuevos.filter(cumpleGes).length / nuevos.length * 100) + '%' : '—';
    const espera = nuevos.length ? num(nuevos.reduce((a, p) => a + p.inicio - p.a, 0) / nuevos.length) + ' d' : '—';
    const k = [[Math.round(oc / 10 * 100) + '%', 'Ocupación próximos 10 días'], [enTrat, 'Pacientes en tratamiento'],
      [nuevos.length, `Ingresos manuales${nuevos.filter(p => p.opcion === 'reacomodo').length ? ' · ' + nuevos.filter(p => p.opcion === 'reacomodo').length + ' con reacomodo' : ''}`],
      [espera, 'Espera media de ingresos (hábiles)'], [ges, 'Ingresos dentro de plazo GES'],
      [`${sobre} de ${act}`, 'Turnos con sobrecarga de enfermería (10 días)']];
    $('kpis').innerHTML = k.map(([v, t]) => `<div class="kpi"><b>${v}</b><span>${t}</span></div>`).join('');
  }

  function renderCalendario() {
    const ag = vista(), srv = ag.srv, d = diaVista, pct = b => (b / cfg.CAP_DIA * 100) + '%';
    const nuevaPid = prop && opcionSel && previas[opcionSel] ? previas[opcionSel].pac.pid : null;
    const movidas = new Set(prop && opcionSel && previas[opcionSel] ? previas[opcionSel].cambios.map(x => x.id) : []);
    $('calFecha').textContent = larga(d);
    $('calSub').textContent = `Día hábil ${d + 1} de la agenda` + (d < agenda.diaActual ? ' · pasado' : d === agenda.diaActual ? ' · hoy' : ` · en ${d - agenda.diaActual} día(s) hábil(es)`);
    $('vistaPrevia').hidden = !nuevaPid;
    $('vistaPrevia').innerHTML = nuevaPid ? `Vista previa de la <b>${opcionSel === 'reacomodo' ? 'opción B (reacomodo)' : 'opción A'}</b>: borde punteado = paciente nuevo, contorno ámbar = sesión que cambia de sillón u hora. Aún no se ha agendado.` : '';
    let h = '<div class="eje"><div></div><div class="pista">';
    for (let x = cfg.HORA_INI; x <= cfg.HORA_FIN; x++) h += `<span class="h" style="left:${(x - cfg.HORA_INI) / (cfg.HORA_FIN - cfg.HORA_INI) * 100}%">${String(x).padStart(2, '0')}:00</span>`;
    h += '</div></div><div class="turnos-cab"><div></div><div class="pista">';
    cfg.TURNOS.forEach(([i, f], s) => {
      const enf = srv.dotacion[d * srv.S + s], cpe = srv.cargaPorEnf(d, s), sob = srv.cargaTurno(d, s) > srv.capCarga(d, s);
      h += `<div class="turno-cab" style="left:${pct(i)};width:${pct(f - i)}"><b>Turno ${turnoNom(s)}</b> · ${enf} enfermera/o${enf === 1 ? '' : 's'} (cubren ${Math.min(srv.cubribles(d, s), srv.L)} de ${srv.L} sillones)<br>` +
           `<span class="${sob ? 'sobre' : ''}">carga ${num(cpe)} de ${srv.m} puntos por enfermera/o${sob ? ' · sobrecarga' : ''}</span></div>`;
    });
    h += '</div></div>';
    for (let l = 0; l < srv.L; l++) {
      let usado = 0; for (let s = 0; s < srv.S; s++) usado += srv.cap[s] - srv.libre[srv.i(l, d, s)];
      h += `<div class="fila"><div class="nombre">Sillón ${l + 1}<small>${Math.round(usado / cfg.CAP_DIA * 100)}% ocupado</small></div><div class="pista">`;
      h += `<div class="corte" style="left:${pct(cfg.TURNOS[1][0])}"></div>`;
      if (!srv.disp[srv.d(l, d)]) h += `<div class="bloqueo fuera" style="left:0;width:100%">Fuera de servicio</div>`;
      else cfg.TURNOS.forEach(([i, f], s) => {
        if (!srv.abierto[srv.i(l, d, s)] && srv.equiposLibres(d, s) <= 0)
          h += `<div class="bloqueo sinenf" style="left:${pct(i)};width:${pct(f - i)}">Sin enfermería para este sillón</div>`;
      });
      for (let s = 0; s < srv.S; s++) for (const id of ag.orden.get(srv.i(l, d, s)) || []) {
        const x = ag.sesiones[id], p = ag.pacientePorId(x.pid), col = COLORES[catNom(p.cat)];
        const cls = ['ses', p.previo ? 'previo' : '', d < agenda.diaActual ? 'pasada' : '', x.pid === nuevaPid ? 'nueva' : '',
                     movidas.has(id) ? 'movida' : '', x.pid === resaltado ? 'resaltada' : ''].join(' ');
        const n = p.sesiones.indexOf(id) + 1 + (p.sesionesPrevias || 0), tot = p.sesiones.length + (p.sesionesPrevias || 0);
        h += `<div class="${cls}" data-ses="${id}" data-ag="${ag === agenda ? 'real' : 'previa'}" style="left:${pct(x.bloque)};width:${pct(x.dur)};border-color:${col};background:${col}22;color:${col}" ` +
             `title="${esc(x.pid)} · ${esc(cfg.PROTOCOLOS[p.prot].nombre)} · sesión ${n} de ${tot} · ${hora(x.bloque)}–${hora(x.bloque + x.dur)}">` +
             `<b>${catNom(p.cat)} · ${esc(x.pid)}</b>${hora(x.bloque)} · ${n}/${tot}</div>`;
      }
      h += '</div></div>';
    }
    $('calendario').innerHTML = h;
    $('leyenda').innerHTML = cfg.CAT_ORDER.map(k => `<span><i style="background:${COLORES[k]}22;border-color:${COLORES[k]}"></i>${k} · ${esc(cfg.CATEGORIAS[k].nombre)}</span>`).join('') +
      '<span>Tono claro = en tratamiento (simulado) · tono fuerte = ingreso manual</span>';
  }

  function renderFranja() {
    const ag = vista(), d0 = agenda.diaActual;
    const nuevas = new Set(prop && opcionSel && previas[opcionSel] ? previas[opcionSel].pac.sesiones.map(id => ag.sesiones[id].dia) : []);
    let h = '';
    for (let t = d0; t < d0 + 60; t++) {
      const o = ag.srv.ocupacion(t), col = o >= 0.9 ? '#E63946' : o >= 0.7 ? '#E0A800' : '#2E9E6B';
      h += `<button data-dia="${t}" class="${t === diaVista ? 'sel' : ''} ${nuevas.has(t) ? 'nueva' : ''} ${fecha(t).getDay() === 1 ? 'lunes' : ''}" ` +
           `style="height:${Math.max(6, o * 100)}%;background:${col}" title="${corta(t)} · ${Math.round(o * 100)}% ocupado"></button>`;
    }
    $('franja').innerHTML = h;
  }

  function renderTabla() {
    const ag = agenda, ver = $('verPrevios').checked;
    const lista = ag.pacientes.filter(p => ver || !p.previo).slice().reverse();
    if (!lista.length) { $('tabla').innerHTML = '<tr><td class="vacio">Aún no hay ingresos manuales. Usa el formulario “Ingresar paciente”.</td></tr>'; return; }
    let h = '<tr><th>ID</th><th>Nombre</th><th>Cat.</th><th>Protocolo</th><th>Admisión</th><th>Inicio</th><th>Espera</th><th>GES</th><th>Sillón · turno</th><th>Próxima sesión</th><th>w̄</th><th>Opción</th></tr>';
    for (const p of lista) {
      const prox = p.sesiones.map(id => ag.sesiones[id]).find(x => x.dia >= ag.diaActual);
      const ok = p.previo ? null : cumpleGes(p);
      h += `<tr class="fila-pac" data-pid="${esc(p.pid)}"><td>${esc(p.pid)}</td><td>${esc(p.nombre)}</td>` +
           `<td><span class="punto" style="background:${COLORES[catNom(p.cat)]}"></span>${catNom(p.cat)}</td>` +
           `<td>${esc(cfg.PROTOCOLOS[p.prot].nombre)}</td><td>${p.previo ? '—' : corta(p.a)}</td><td>${p.inicio >= 0 ? corta(p.inicio) : 'antes del día 1'}</td>` +
           `<td>${p.previo ? '—' : (p.inicio - p.a) + ' d'}</td><td>${ok === null ? '—' : `<span class="ges ${ok ? 'ok' : 'no'}">${ok ? 'Cumple' : 'No cumple'}</span>`}</td>` +
           `<td>Sillón ${p.sillon + 1} · ${turnoNom(p.turno)}</td><td>${prox ? corta(prox.dia) + ' ' + hora(prox.bloque) : 'terminado'}</td>` +
           `<td>${p.previo || catCfg(p.cat).urgente ? '—' : num(p.w)}</td><td>${p.previo ? 'previo' : p.opcion === 'reacomodo' ? 'B · reacomodo' : 'A · estándar'}</td></tr>`;
    }
    $('tabla').innerHTML = h;
  }

  function render() {
    $('hoyFecha').textContent = larga(agenda.diaActual);
    const met = datos.metricas[String(agenda.L)];
    $('cfgModelo').textContent = `Modelo activo: XGBoost F3 para ${agenda.L} sillones, entrenado con ${met.instancias} instancias del régimen alternante ` +
      `(λ = ${num(met.lam, 2)}): R² ${num(met.R2, 2)} y error medio ${num(met.MAE)} días en instancias de prueba.`;
    document.querySelectorAll('.v-ratio').forEach(e => { e.textContent = agenda.opts.ratio; });
    document.querySelectorAll('.v-m').forEach(e => { e.textContent = agenda.opts.m; });
    renderKPIs(); renderPropuesta(); renderCalendario(); renderFranja(); renderTabla(); actualizarPrep();
  }

  // ── Detalle de una sesion ──
  function mostrarDetalle(el, ev) {
    const ag = el.dataset.ag === 'previa' ? vista() : agenda, x = ag.sesiones[+el.dataset.ses], p = ag.pacientePorId(x.pid);
    const proto = cfg.PROTOCOLOS[p.prot], n = p.sesiones.indexOf(x.id) + 1 + (p.sesionesPrevias || 0), tot = p.sesiones.length + (p.sesionesPrevias || 0);
    const box = $('detalle');
    box.innerHTML = `<button class="cerrar" aria-label="Cerrar">×</button><h4>${esc(p.pid)} · ${esc(p.nombre)}</h4>
      <div>${catNom(p.cat)} · ${esc(catCfg(p.cat).nombre)} · agudeza ${p.kappa}</div>
      <div>${esc(proto.nombre)} (${esc(proto.esquema)}) · sesión ${n} de ${tot}</div>
      <div>${corta(x.dia)} · Sillón ${x.l + 1} · turno ${turnoNom(x.s)} · ${hora(x.bloque)}–${hora(x.bloque + x.dur)}</div>
      ${p.previo ? `<div class="ref">Paciente en tratamiento al iniciar la agenda${p.sesionesPrevias ? ` (${p.sesionesPrevias} sesión(es) ya realizadas)` : ''}.</div>`
                 : `<div class="ref">Admitido el ${corta(p.a)} · inicio ${corta(p.inicio)} · espera ${p.inicio - p.a} día(s) hábil(es) · ${cumpleGes(p) ? 'dentro' : 'fuera'} de plazo GES</div>`}
      <div class="chips">${p.sesiones.map(id => `<span>${corta(ag.sesiones[id].dia)} · S${ag.sesiones[id].l + 1}</span>`).join('')}</div>`;
    box.hidden = false;
    const r = box.getBoundingClientRect();
    box.style.left = Math.max(8, Math.min(ev.clientX + 12, innerWidth - r.width - 8)) + 'px';
    box.style.top = Math.max(8, Math.min(ev.clientY + 12, innerHeight - r.height - 8)) + 'px';
  }

  function descargarCsv() {
    const ag = agenda, filas = [['id', 'nombre', 'categoria', 'protocolo', 'agudeza', 'sesion', 'fecha', 'hora_inicio', 'hora_fin', 'sillon', 'turno', 'tipo']];
    for (const p of ag.pacientes) p.sesiones.forEach((id, j) => {
      const x = ag.sesiones[id], f = fecha(x.dia);
      filas.push([p.pid, p.nombre, catNom(p.cat), cfg.PROTOCOLOS[p.prot].nombre, p.kappa, j + 1 + (p.sesionesPrevias || 0),
        `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`,
        hora(x.bloque), hora(x.bloque + x.dur), x.l + 1, turnoNom(x.s), p.previo ? 'en tratamiento' : 'ingreso manual']);
    });
    const csv = '﻿' + filas.map(f => f.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'agenda_quimioterapia.csv'; a.click(); URL.revokeObjectURL(a.href);
  }

  // ── Eventos ──
  function conectar() {
    $('formIngreso').onsubmit = calcular;
    $('propuesta').onclick = e => {
      const conf = e.target.closest('[data-confirmar]');
      if (conf) { confirmar(conf.dataset.confirmar); return; }
      if (e.target.id === 'btnCancelar') { limpiarPropuesta(); aviso = ''; render(); return; }
      const card = e.target.closest('.opcion');
      if (card && card.dataset.op !== opcionSel) { opcionSel = card.dataset.op; diaVista = prop[opcionSel].t; render(); }
    };
    $('btnAnt').onclick = () => { diaVista = Math.max(0, diaVista - 1); render(); };
    $('btnSig').onclick = () => { diaVista = Math.min(agenda.T - 1, diaVista + 1); render(); };
    $('btnHoy').onclick = () => { diaVista = agenda.diaActual; render(); };
    $('franja').onclick = e => { const b = e.target.closest('button'); if (b) { diaVista = +b.dataset.dia; render(); } };
    $('verPrevios').onchange = renderTabla;
    $('tabla').onclick = e => {
      const tr = e.target.closest('tr[data-pid]'); if (!tr) return;
      const p = agenda.pacientePorId(tr.dataset.pid);
      resaltado = p.pid; diaVista = agenda.sesiones[p.sesiones.find(id => agenda.sesiones[id].dia >= agenda.diaActual) ?? p.sesiones[0]].dia;
      render(); $('calendario').scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    $('calendario').onclick = e => { const s = e.target.closest('.ses'); if (s) { e.stopPropagation(); mostrarDetalle(s, e); } };
    document.addEventListener('click', e => { if (!e.target.closest('#detalle') && !e.target.closest('.ses')) $('detalle').hidden = true; });
    $('detalle').onclick = e => { if (e.target.closest('.cerrar')) $('detalle').hidden = true; };
    $('btnAvanzar').onclick = () => {
      if (agenda.diaActual >= agenda.T - cfg.MAX_SPAN - 2) return;
      agenda.diaActual++; diaVista = agenda.diaActual; limpiarPropuesta(); aviso = ''; guardar(); render();
    };
    $('btnGenerar').onclick = () => {
      const hay = agenda.pacientes.some(p => !p.previo);
      if (hay && !confirm('Generar una nueva agenda inicial borra los pacientes ingresados. ¿Continuar?')) return;
      $('cargando').hidden = false; $('cargando').textContent = 'Generando la agenda inicial…';
      setTimeout(() => { nuevaAgenda(); aviso = ''; render(); $('cargando').hidden = true; }, 30);
    };
    // La reserva gamma y la carga maxima m se aplican sin regenerar; los sillones por enfermera/o, al generar
    for (const id of ['cfgGamma', 'cfgM']) $(id).onchange = () => {
      agenda.opts.gamma = +$('cfgGamma').value; agenda.opts.m = +$('cfgM').value;
      agenda.srv.m = agenda.opts.m; limpiarPropuesta(); guardar(); render();
    };
    $('btnCsv').onclick = descargarCsv;
  }

  // ── Inicio ──
  fetch('modelo.json').then(r => r.json()).then(j => {
    datos = j; cfg = j.config;
    if (!recuperar()) nuevaAgenda();
    diaVista = agenda.diaActual;
    armarFormulario(); conectar(); render();
    $('cargando').hidden = true;
  }).catch(err => { $('cargando').textContent = 'No se pudo cargar el modelo: ' + err; });
})();
