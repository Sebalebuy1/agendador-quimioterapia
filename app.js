/* Interfaz del agendador: ingreso manual de pacientes y gestion de reservas sobre el motor (motor.js) y el modelo (modelo.json). */
(function () {
  'use strict';
  const CLAVE = 'agendador-quimio-v1';
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const COLORES = { P1: '#E63946', P2: '#E08C56', P3: '#2F6E9E', P4: '#6C5DD3' };

  let datos, cfg, agenda, fechaInicio, diaVista = 0, resaltado = null;
  // Ingreso: propuesta, vistas previas de cada opcion y opcion seleccionada
  let prop = null, entradaActual = null, previas = {}, opcionSel = null, aviso = '';
  // Gestion de una reserva existente
  let gestion = null, previaGestion = null;
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
  const plural = (n, s, p) => `${n} ${n === 1 ? s : (p || s + 's')}`;
  function inicioHoy() {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    return d;
  }
  const catNom = c => cfg.CAT_ORDER[c];
  const catCfg = c => cfg.CATEGORIAS[catNom(c)];
  const turnoNom = s => cfg.NOMBRES_TURNO[s];
  const cumpleGes = p => corridos(p.a, p.inicio) <= catCfg(p.cat).plazo_corridos;
  const numSesion = (ag, p, id) => p.sesiones.indexOf(id) + 1 + (p.sesionesPrevias || 0);
  const totSesiones = p => p.sesiones.length + (p.sesionesPrevias || 0);
  // "esta sesión" / "esta sesión y la siguiente" / "esta sesión y las 3 siguientes"
  const yLasSiguientes = n => n <= 0 ? 'esta sesión' : n === 1 ? 'esta sesión y la siguiente' : `esta sesión y las ${n} siguientes`;
  const quien = id => { const q = agenda.pacientePorId(id); return `${esc(id)}${q && !q.previo ? ' · ' + esc(q.nombre) : ''}`; };

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
    fechaInicio = inicioHoy(); fechas.length = 0; diaVista = 0; limpiarPropuesta(); cerrarGestion();
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
  function opcionesProtocolo(cat) {
    const probs = cfg.PROT_PROBS[cat];
    const hab = cfg.PROTOCOLOS.map((p, k) => k).filter(k => probs[k] > 0).sort((a, b) => probs[b] - probs[a]);
    const otros = cfg.PROTOCOLOS.map((p, k) => k).filter(k => probs[k] === 0);
    const op = k => { const p = cfg.PROTOCOLOS[k]; return `<option value="${k}">${esc(p.nombre)} · ${esc(p.esquema)} (${p.offsets.length} sesiones en 12 semanas) — ${esc(p.uso)}</option>`; };
    return `<optgroup label="Habituales para ${catNom(cat)}">${hab.map(op).join('')}</optgroup><optgroup label="Otros protocolos">${otros.map(op).join('')}</optgroup>`;
  }
  function actualizarFormulario(reiniciarPrep) {
    [...$('inCat').children].forEach(b => b.classList.toggle('on', +b.dataset.c === form.cat));
    $('inProt').innerHTML = opcionesProtocolo(form.cat);
    if (reiniciarPrep) $('inPrep').value = catCfg(form.cat).listo[0];
    $('inDurTxt').textContent = `${$('inDur').value} min`;
    actualizarPrep();
  }
  function actualizarPrep() {
    const v = +$('inPrep').value;
    $('inPrepTxt').textContent = `${v} día${v === 1 ? '' : 's'} hábil${v === 1 ? '' : 'es'}`;
  }

  // ── Bloques comunes de las propuestas ──
  function htmlCambios(cambios, titulo) {
    if (!cambios.length) return '';
    const movidas = cambios.filter(x => x.de !== x.a || x.turnoAntes !== x.turno), horas = cambios.filter(x => x.de === x.a && x.turnoAntes === x.turno);
    return `<div class="mov"><b>${titulo || 'Cambios propuestos a otros pacientes'}</b> (misma fecha y protocolo):<ul>` +
      movidas.map(x => `<li>${quien(x.pid)} · ${corta(x.dia)}: Sillón ${x.de + 1} ${turnoNom(x.turnoAntes)} → <b>Sillón ${x.a + 1} ${turnoNom(x.turno)}</b>, ${hora(x.bloqueAntes)} → <b>${hora(x.bloque)}</b></li>`).join('') +
      horas.map(x => `<li>${quien(x.pid)} · ${corta(x.dia)} ${turnoNom(x.turno)}, Sillón ${x.a + 1}: hora ${hora(x.bloqueAntes)} → <b>${hora(x.bloque)}</b></li>`).join('') +
      '</ul></div>';
  }
  const chipsSesiones = (ag, ids) => `<div class="chips">${ids.map((id, j) => `<span title="Sesión ${j + 1}">${corta(ag.sesiones[id].dia)}</span>`).join('')}</div>`;

  // ── Ingreso de un paciente ──
  function calcular(e) {
    e.preventDefault();
    cerrarGestion();
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
    const exc = agenda.srv.conAgudeza ? agenda.srv.excesoIncremental(cfg.PROTOCOLOS[prop.prot].offsets.map(o => sol.t + o), prop.kappa)[sol.s] : 0;
    const titulo = op === 'estandar' ? 'Opción A · Agenda estándar del modelo'
      : `Opción B · Empieza ${prop.estandar ? plural(prop.estandar.t - sol.t, 'día hábil', 'días hábiles') + ' antes' : 'antes'} con reacomodo`;
    return `<div class="opcion ${opcionSel === op ? 'sel' : ''}" data-op="${op}">
      <h4><span>${titulo}</span><span class="ges ${ok ? 'ok' : 'no'}">${ok ? 'Dentro de plazo GES' : 'Fuera de plazo GES'}</span></h4>
      <div class="det">
        <div><b>Inicio:</b> ${larga(sol.t)}, ${hora(pr.agenda.sesiones[p.sesiones[0]].bloque)}</div>
        <div><b>Sillón ${sol.l + 1}</b> · turno ${turnoNom(sol.s)} · espera ${plural(espera, 'día hábil', 'días hábiles')}, ${corridos(prop.a, sol.t)} corridos (plazo ${c.plazo_corridos})</div>
        ${chipsSesiones(pr.agenda, p.sesiones)}
        ${exc > 0 ? `<div class="ref">Agrega ${num(exc, 0)} punto(s) de sobrecarga de enfermería en esas fechas.</div>` : ''}
      </div>${op === 'reacomodo' ? htmlCambios(pr.cambios) : ''}
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

  // ── Gestion de una reserva existente ──
  // Abre el panel de una sesion. Al abrirlo desde el calendario se preselecciona (y se previsualiza) el cupo
  // sugerido; tras aplicar un cambio se reabre en el cupo actual, sin vista previa.
  function abrirGestion(sid, tab, sugerir) {
    const ses = agenda.sesiones[sid];
    if (!ses || ses.anulada) return;
    limpiarPropuesta(); aviso = '';
    gestion = { sid, tab: tab || 'hora', msg: '', reag: null, horaSel: null };
    previaGestion = null;
    if (ses.dia >= agenda.diaActual) {
      gestion.horas = agenda.opcionesHora(sid);
      const sug = gestion.horas.sugerida, actual = gestion.horas.opciones.findIndex(o => o.actual);
      gestion.horaSel = sugerir !== false && sug ? gestion.horas.opciones.indexOf(sug) : actual;
      if (gestion.tab === 'hora') previsualizarHora();
    }
    resaltado = ses.pid; diaVista = ses.dia;
    render();
    if (sugerir !== false) $('cajaGestion').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function cerrarGestion() { gestion = null; previaGestion = null; }
  function previsualizarHora() {
    const o = gestion.horas.opciones[gestion.horaSel];
    if (!o || o.actual) { previaGestion = null; return; }
    const copia = agenda.copia(), res = copia.aplicarHora(gestion.sid, o.l, o.s, o.pos);
    previaGestion = { agenda: copia, foco: new Set([gestion.sid]), movidas: new Set(res.cambios.filter(x => x.id !== gestion.sid).map(x => x.id)),
      cambios: res.cambios.filter(x => x.id !== gestion.sid), texto: 'Vista previa del <b>cambio de hora</b>' };
  }
  function previsualizarReagenda(op) {
    const r = gestion.reag;
    r.opcionSel = op;
    if (!op) { previaGestion = null; return; }
    const pv = r.previas[op];
    previaGestion = { agenda: pv.agenda, foco: new Set(pv.pac.sesiones.slice(r.prop.k)), movidas: new Set(pv.cambios.map(x => x.id)),
      texto: `Vista previa del <b>reagendamiento (${op === 'reacomodo' ? 'opción B, con reacomodo' : 'opción A'})</b>` };
    diaVista = r.prop[op].t;
  }
  function buscarReagenda() {
    const noAntes = $('gNoAntes').value === '' ? null : +$('gNoAntes').value;
    const turnoBtn = document.querySelector('#gTurno button.on');
    const turno = !turnoBtn || turnoBtn.dataset.v === '' ? null : +turnoBtn.dataset.v;
    const p = agenda.sesiones[gestion.sid], propR = agenda.proponerReagenda(gestion.sid, { noAntes, turno });
    const previasR = {};
    for (const op of ['estandar', 'reacomodo']) if (propR[op]) {
      const copia = agenda.copia(), res = copia.aplicarReagenda(propR, op);
      previasR[op] = { agenda: copia, ...res };
    }
    gestion.reag = { prop: propR, previas: previasR, noAntes, turno, opcionSel: null };
    previsualizarReagenda(propR.reacomodo ? 'reacomodo' : propR.estandar ? 'estandar' : null);
    render();
  }
  function tarjetaReagenda(op) {
    const r = gestion.reag, pr = r.prop, sol = pr[op], pv = r.previas[op], p = pv.pac;
    const ids = p.sesiones.slice(pr.k), mismo = sol.t === pr.original && sol.l === pr.origL && sol.s === pr.origS;
    const delta = sol.t - pr.original;
    const mov = delta === 0 ? 'misma fecha' : delta > 0 ? `se posterga ${plural(delta, 'día hábil', 'días hábiles')}` : `se adelanta ${plural(-delta, 'día hábil', 'días hábiles')}`;
    let ges = '';
    if (pr.completo) { const ok = corridos(p.a, sol.t) <= catCfg(p.cat).plazo_corridos; ges = `<span class="ges ${ok ? 'ok' : 'no'}">${ok ? 'Dentro de plazo GES' : 'Fuera de plazo GES'}</span>`; }
    const exc = agenda.srv.excesoIncremental(pr.rel.map(o => sol.t + o), pr.kappa)[sol.s];
    const titulo = op === 'estandar' ? 'Opción A · Mejor cupo del modelo'
      : `Opción B · ${pr.estandar ? plural(pr.estandar.t - sol.t, 'día hábil', 'días hábiles') + ' antes' : 'Cupo'} con reacomodo`;
    return `<div class="opcion ${r.opcionSel === op ? 'sel' : ''}" data-rop="${op}">
      <h4><span>${titulo}</span>${ges}</h4>
      <div class="det">
        <div><b>Desde:</b> ${larga(sol.t)}, ${hora(pv.agenda.sesiones[ids[0]].bloque)} (${mov})</div>
        <div><b>Sillón ${sol.l + 1}</b> · turno ${turnoNom(sol.s)} · ${plural(ids.length, 'sesión', 'sesiones')} con el espaciado del protocolo</div>
        ${chipsSesiones(pv.agenda, ids)}
        ${mismo ? '<div class="ref">Es el mismo cupo que tiene hoy: no hay uno mejor con estas condiciones.</div>' : ''}
        ${exc > 0 ? `<div class="ref">Agrega ${num(exc, 0)} punto(s) de sobrecarga de enfermería.</div>` : ''}
      </div>${op === 'reacomodo' ? htmlCambios(pv.cambios) : ''}
      <div class="acciones"><button class="pri" data-reagendar="${op}" ${mismo ? 'disabled' : ''}>Reagendar con esta opción</button></div>
    </div>`;
  }
  function renderGestion() {
    const caja = $('cajaGestion');
    if (!gestion) { caja.hidden = true; caja.innerHTML = ''; return; }
    caja.hidden = false;
    const ses = agenda.sesiones[gestion.sid], p = agenda.pacientePorId(ses.pid), proto = cfg.PROTOCOLOS[p.prot];
    const n = numSesion(agenda, p, ses.id), tot = totSesiones(p), futura = ses.dia >= agenda.diaActual;
    const restantes = p.sesiones.slice(p.sesiones.indexOf(ses.id));
    let h = `<div class="ges-cab"><h2>Gestionar sesión</h2><button class="cerrar" id="gCerrar" aria-label="Cerrar">×</button></div>
      <div class="ficha"><span class="punto" style="background:${COLORES[catNom(p.cat)]}"></span><b>${esc(p.pid)} · ${esc(p.nombre)}</b>
        <div>${catNom(p.cat)} · ${esc(catCfg(p.cat).nombre)} · agudeza ${ses.kappa}</div>
        <div>${esc(proto.nombre)} (${esc(proto.esquema)}) · sesión ${n} de ${tot}</div>
        <div><b>${larga(ses.dia)}</b> · ${hora(ses.bloque)}–${hora(ses.bloque + ses.dur)} · Sillón ${ses.l + 1} · turno ${turnoNom(ses.s)}</div>
        ${p.previo ? `<div class="ref">Paciente en tratamiento al iniciar la agenda${p.sesionesPrevias ? ` (${p.sesionesPrevias} sesión(es) ya realizadas)` : ''}.</div>`
                   : `<div class="ref">Admitido el ${corta(p.a)} · inicio ${corta(p.inicio)} · ${cumpleGes(p) ? 'dentro' : 'fuera'} de plazo GES${p.reagendas ? ` · reagendado ${p.reagendas} vez/veces` : ''}</div>`}
        ${chipsSesiones(agenda, p.sesiones)}
      </div>`;
    if (!futura) { caja.innerHTML = h + '<div class="resumen">Sesión ya realizada: no se puede editar.</div>'; return; }
    const tabs = [['hora', 'Cambiar hora'], ['datos', 'Editar datos'], ['reagendar', 'Reagendar'], ['cancelar', 'Cancelar']];
    h += `<div class="seg tabs" id="gTabs">${tabs.map(([k, t]) => `<button type="button" data-tab="${k}" class="${gestion.tab === k ? 'on' : ''}">${t}</button>`).join('')}</div>`;
    if (gestion.msg) h += gestion.msg;
    if (gestion.tab === 'hora') {
      const { opciones, sugerida } = gestion.horas;
      const etiqueta = o => `${hora(o.bloque)}–${hora(o.bloque + ses.dur)} · Sillón ${o.l + 1} · ${turnoNom(o.s)}` +
        (o.actual ? ' (actual)' : '') + (o === sugerida ? ' ★ sugerida' : '') +
        (o.desplaza ? ` · mueve la hora de ${plural(o.desplaza, 'sesión', 'sesiones')}` : '') +
        (o.cambiaTurno ? ' · cambia de turno' : '') + (o.sobrecarga ? ' · sobrecarga de enfermería' : '');
      h += `<p class="nota">Cupos posibles el mismo día. La hora resulta del orden de las sesiones dentro del turno; la fecha y el protocolo no cambian.</p>
        <label>Nuevo cupo <select id="gHora">${cfg.NOMBRES_TURNO.map((t, s) =>
          `<optgroup label="Turno ${t}">${opciones.map((o, k) => o.s === s ? `<option value="${k}" ${k === gestion.horaSel ? 'selected' : ''}>${etiqueta(o)}</option>` : '').join('')}</optgroup>`).join('')}</select></label>`;
      const o = opciones[gestion.horaSel];
      if (previaGestion && previaGestion.cambios) h += htmlCambios(previaGestion.cambios, 'Otras sesiones cuya hora cambia');
      h += `<div class="acciones"><button class="pri" id="gAplicarHora" ${!o || o.actual ? 'disabled' : ''}>Aplicar cambio de hora</button></div>`;
    } else if (gestion.tab === 'datos') {
      h += `${p.previo ? '' : `<label>Nombre <input id="gNombre" type="text" maxlength="40" value="${esc(p.nombre)}"></label>`}
        <div class="rango"><label for="gDur">Duración de la sesión <b id="gDurTxt">${ses.dur * cfg.BLOQUE_MIN} min</b></label>
          <input id="gDur" type="range" min="35" max="235" step="5" value="${ses.dur * cfg.BLOQUE_MIN}"></div>
        ${restantes.length > 1 ? `<label class="chk"><input type="checkbox" id="gTodas"> Aplicar también a ${restantes.length === 2 ? 'su sesión siguiente' : `sus ${restantes.length - 1} sesiones siguientes`}</label>`
                               : '<input type="checkbox" id="gTodas" hidden disabled><p class="nota">Es su última sesión agendada.</p>'}
        <div class="etq">Agudeza del paciente (sesiones futuras)</div>
        <div class="seg" id="gKappa">${[1, 2, 3].map(v => `<button type="button" data-v="${v}" class="${v === ses.kappa ? 'on' : ''}">${v} · ${['baja', 'media', 'alta'][v - 1]}</button>`).join('')}</div>
        <p class="nota">Una duración mayor solo se acepta si cabe en el sillón y turno de cada sesión; si no cabe, usa Cambiar hora o Reagendar. La agudeza cambia la carga de enfermería de los turnos.</p>
        <div class="acciones"><button class="pri" id="gGuardarDatos">Guardar cambios</button></div>`;
    } else if (gestion.tab === 'reagendar') {
      const completo = p.sesiones.indexOf(ses.id) === 0 && !p.previo, minimo = completo ? agenda.diaActual : ses.dia;
      const r = gestion.reag, sel = r ? r.noAntes : (completo ? null : ses.dia + 1);
      const dias = [];
      for (let t = minimo; t < Math.min(minimo + 45, agenda.T - 60); t++) dias.push(t);
      h += `<p class="nota">${completo
        ? 'El paciente aún no empieza: el modelo vuelve a decidir su inicio con la agenda de hoy (Algoritmo 2). Se mantiene su plazo GES desde la admisión.'
        : `Se reagenda ${yLasSiguientes(restantes.length - 1)}${restantes.length > 1 ? ', con el mismo espaciado del protocolo' : ''}. Las sesiones no se adelantan respecto de su fecha actual.`}</p>
        <label>No antes de <select id="gNoAntes">${completo ? `<option value="" ${sel == null ? 'selected' : ''}>Lo que sugiera el modelo</option>` : ''}${dias.map(t =>
          `<option value="${t}" ${t === sel ? 'selected' : ''}>${corta(t)}${t === ses.dia ? ' (fecha actual)' : t === agenda.diaActual ? ' (hoy)' : ''}</option>`).join('')}</select></label>
        <div class="etq">Turno preferido</div>
        <div class="seg" id="gTurno"><button type="button" data-v="" class="${!r || r.turno == null ? 'on' : ''}">Indiferente</button><button type="button" data-v="0" class="${r && r.turno === 0 ? 'on' : ''}">AM 08–12</button><button type="button" data-v="1" class="${r && r.turno === 1 ? 'on' : ''}">PM 12–16</button></div>
        <div class="acciones"><button class="pri" id="gBuscar">Buscar mejor cupo</button></div>`;
      if (r) {
        const pr = r.prop;
        h += `<div class="resumen">${pr.completo ? (pr.urgente ? `<b>Urgente:</b> primera fecha disponible desde que está listo.`
            : `<b>Programado:</b> el modelo predice una espera ideal de <b>${num(pr.w)} días hábiles</b> desde hoy (w̄ = ${pr.wbar}); busca desde el ${corta(pr.desde)}.`)
            : `Busca el primer cupo desde el ${corta(pr.desde)} con sillón, enfermería y la reserva γ = ${Math.round(pr.gamma * 100)}% para programados.`}
            <br><span class="ref">${plural(pr.rel.length, 'sesión', 'sesiones')} de ${pr.dur * cfg.BLOQUE_MIN} min · agudeza ${pr.kappa}</span></div>`;
        if (pr.reacomodo) h += tarjetaReagenda('reacomodo');
        if (pr.estandar) h += tarjetaReagenda('estandar');
        else h += '<div class="resumen"><b>Sin cupo</b> en el horizonte con estas condiciones.</div>';
        if (pr.completo) h += `<div class="ref">${pr.greedy ? `Regla de referencia (greedy, Pham et al.): ${corta(pr.greedy.t)} en Sillón ${pr.greedy.l + 1} ${turnoNom(pr.greedy.s)}.` : 'Regla de referencia (greedy): sin cupo.'}</div>`;
      }
    } else if (gestion.tab === 'cancelar') {
      h += `<p class="nota">Se cancela ${yLasSiguientes(restantes.length - 1)} (${restantes.map(id => corta(agenda.sesiones[id].dia)).join(', ')}). Los cupos quedan libres para otros pacientes.</p>
        <div class="acciones"><button class="pri peligro" id="gCancelarSes">Cancelar ${plural(restantes.length, 'sesión', 'sesiones')}</button></div>`;
    }
    caja.innerHTML = h;
  }
  function eventosGestion(e) {
    const t = e.target;
    if (t.closest('#gCerrar')) { cerrarGestion(); render(); return; }
    const tab = t.closest('#gTabs button');
    if (tab) {
      gestion.tab = tab.dataset.tab; gestion.msg = '';
      if (gestion.tab === 'hora') previsualizarHora();
      else if (gestion.tab === 'reagendar' && gestion.reag) previsualizarReagenda(gestion.reag.opcionSel);
      else previaGestion = null;
      if (previaGestion) diaVista = agenda.sesiones[gestion.sid].dia;
      render(); return;
    }
    const seg = t.closest('#gKappa button, #gTurno button');
    if (seg) { [...seg.parentNode.children].forEach(x => x.classList.toggle('on', x === seg)); return; }
    if (t.closest('#gAplicarHora')) {
      const o = gestion.horas.opciones[gestion.horaSel], sid = gestion.sid, antes = agenda.sesiones[sid];
      const desc = `Sillón ${antes.l + 1} ${turnoNom(antes.s)} ${hora(antes.bloque)}`;
      const res = agenda.aplicarHora(sid, o.l, o.s, o.pos), otras = res.cambios.filter(x => x.id !== sid).length;
      guardar(); const id = sid; abrirGestion(id, 'hora', false);
      gestion.msg = `<div class="resumen ok-msg">Cambio aplicado: de ${desc} a <b>Sillón ${o.l + 1} ${turnoNom(o.s)} ${hora(agenda.sesiones[id].bloque)}</b>${otras ? ` · se ajustó la hora de ${plural(otras, 'otra sesión', 'otras sesiones')}` : ''}.</div>`;
      render(); return;
    }
    if (t.closest('#gGuardarDatos')) {
      const ses = agenda.sesiones[gestion.sid], kb = document.querySelector('#gKappa button.on');
      const durNueva = Math.ceil(+$('gDur').value / cfg.BLOQUE_MIN);
      const res = agenda.editarDatos(gestion.sid, { dur: durNueva !== ses.dur || $('gTodas').checked ? durNueva : null, todas: $('gTodas').checked,
        kappa: kb ? +kb.dataset.v : null, nombre: $('gNombre') ? $('gNombre').value.trim() : null });
      if (!res.ok) { gestion.msg = `<div class="resumen error-msg"><b>No cabe</b> en su sillón y turno el ${res.fallas.map(corta).join(', ')}. Usa <i>Cambiar hora</i> o <i>Reagendar</i>.</div>`; render(); return; }
      guardar(); const id = gestion.sid; abrirGestion(id, 'datos', false);
      gestion.msg = `<div class="resumen ok-msg">Datos guardados.${res.cambios.length ? ` Se ajustó la hora de ${plural(res.cambios.length, 'sesión', 'sesiones')} del mismo turno.` : ''}</div>`;
      render(); return;
    }
    if (t.closest('#gBuscar')) { buscarReagenda(); return; }
    const reag = t.closest('[data-reagendar]');
    if (reag) {
      const op = reag.dataset.reagendar, r = gestion.reag, res = agenda.aplicarReagenda(r.prop, op);
      const p = res.pac, primera = agenda.sesiones[p.sesiones[r.prop.k]], movidas = res.cambios.length;
      guardar(); cerrarGestion(); resaltado = p.pid; diaVista = primera.dia;
      aviso = `<div class="resumen ok-msg"><b>${esc(p.pid)} reagendado.</b> Desde el ${larga(primera.dia)} a las ${hora(primera.bloque)}, Sillón ${primera.l + 1} · turno ${turnoNom(primera.s)}.` +
              (movidas ? ` Se ajustaron ${plural(movidas, 'sesión', 'sesiones')} de otros pacientes.` : '') + '</div>';
      render(); $('cajaIngreso').scrollIntoView({ behavior: 'smooth', block: 'start' }); return;
    }
    const card = t.closest('.opcion[data-rop]');
    if (card && card.dataset.rop !== gestion.reag.opcionSel) { previsualizarReagenda(card.dataset.rop); render(); return; }
    if (t.closest('#gCancelarSes')) {
      const ses = agenda.sesiones[gestion.sid];
      if (!confirm('¿Cancelar esta sesión y las siguientes del paciente?')) return;
      const pid = ses.pid, res = agenda.cancelarDesde(gestion.sid);
      guardar(); cerrarGestion();
      aviso = `<div class="resumen ok-msg">Se cancelaron ${plural(res.n, 'sesión', 'sesiones')} de ${esc(pid)}. Los cupos quedaron libres.</div>`;
      render();
    }
  }

  // ── Vista: agenda mostrada (con vista previa si hay una propuesta seleccionada) ──
  function previa() {
    if (previaGestion) return previaGestion;
    if (prop && opcionSel && previas[opcionSel]) {
      const pv = previas[opcionSel];
      return { agenda: pv.agenda, foco: new Set(pv.pac.sesiones), movidas: new Set(pv.cambios.map(x => x.id)),
               texto: `Vista previa de la <b>${opcionSel === 'reacomodo' ? 'opción B (reacomodo)' : 'opción A'}</b> del ingreso` };
    }
    return null;
  }

  function renderCalendario() {
    const pv = previa(), ag = pv ? pv.agenda : agenda, srv = ag.srv, d = diaVista, pct = b => (b / cfg.CAP_DIA * 100) + '%';
    const foco = pv ? pv.foco : new Set(), movidas = pv ? pv.movidas : new Set(), editando = gestion ? gestion.sid : null;
    $('calFecha').textContent = larga(d);
    $('calSub').textContent = `Día hábil ${d + 1} de la agenda` + (d < agenda.diaActual ? ' · pasado' : d === agenda.diaActual ? ' · hoy' : ` · en ${d - agenda.diaActual} día(s) hábil(es)`);
    $('vistaPrevia').hidden = !pv;
    $('vistaPrevia').innerHTML = pv ? `${pv.texto}: borde punteado = sesión propuesta, contorno ámbar = otra sesión que cambia de sillón u hora. Aún no se ha aplicado.` : '';
    let h = '<div class="eje"><div></div><div class="pista">';
    for (let x = cfg.HORA_INI; x <= cfg.HORA_FIN; x++) h += `<span class="h" style="left:${(x - cfg.HORA_INI) / (cfg.HORA_FIN - cfg.HORA_INI) * 100}%">${String(x).padStart(2, '0')}:00</span>`;
    h += '</div></div><div class="turnos-cab"><div></div><div class="pista">';
    cfg.TURNOS.forEach(([i, f], s) => {
      h += `<div class="turno-cab" style="left:${pct(i)};width:${pct(f - i)}"><b>Turno ${turnoNom(s)}</b></div>`;
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
        const cls = ['ses', p.previo ? 'previo' : '', d < agenda.diaActual ? 'pasada' : '', foco.has(id) ? 'nueva' : '',
                     movidas.has(id) ? 'movida' : '', x.pid === resaltado ? 'resaltada' : '', id === editando ? 'editando' : ''].join(' ');
        const n = numSesion(ag, p, id), tot = totSesiones(p);
        h += `<div class="${cls}" data-ses="${id}" style="left:${pct(x.bloque)};width:${pct(x.dur)};border-color:${col};background:${col}22;color:${col}" ` +
             `title="${esc(x.pid)} · ${esc(cfg.PROTOCOLOS[p.prot].nombre)} · sesión ${n} de ${tot} · ${hora(x.bloque)}–${hora(x.bloque + x.dur)}${d >= agenda.diaActual ? ' · clic para gestionar' : ''}">` +
             `<b>${catNom(p.cat)} · ${esc(x.pid)}</b>${hora(x.bloque)} · ${n}/${tot}</div>`;
      }
      h += '</div></div>';
    }
    $('calendario').innerHTML = h;
    $('leyenda').innerHTML = cfg.CAT_ORDER.map(k => `<span><i style="background:${COLORES[k]}22;border-color:${COLORES[k]}"></i>${k} · ${esc(cfg.CATEGORIAS[k].nombre)}</span>`).join('') +
      '<span>Tono claro = en tratamiento (simulado) · tono fuerte = ingreso manual · clic en una sesión futura para cambiar hora, datos o reagendar</span>';
  }

  function renderFranja() {
    const pv = previa(), ag = pv ? pv.agenda : agenda, d0 = agenda.diaActual;
    const marcadas = new Set(pv ? [...pv.foco].map(id => ag.sesiones[id].dia) : []);
    let h = '';
    for (let t = d0; t < d0 + 60; t++) {
      const o = ag.srv.ocupacion(t), col = o >= 0.9 ? '#E63946' : o >= 0.7 ? '#E0A800' : '#2E9E6B';
      h += `<button data-dia="${t}" class="${t === diaVista ? 'sel' : ''} ${marcadas.has(t) ? 'nueva' : ''} ${fecha(t).getDay() === 1 ? 'lunes' : ''}" ` +
           `style="height:${Math.max(6, o * 100)}%;background:${col}" title="${corta(t)} · ${Math.round(o * 100)}% ocupado"></button>`;
    }
    $('franja').innerHTML = h;
  }

  function renderTabla() {
    // Por defecto todos los pacientes (los ingresados a mano primero); marcando la casilla, solo los ingresados a mano
    const ag = agenda, solo = $('soloManuales').checked;
    const lista = ag.pacientes.filter(p => !solo || !p.previo).slice().reverse();
    if (!lista.length) { $('tabla').innerHTML = '<tr><td class="vacio">Aún no hay ingresos manuales. Usa el formulario “Ingresar paciente”.</td></tr>'; return; }
    let h = '<tr><th>ID</th><th>Nombre</th><th>Cat.</th><th>Protocolo</th><th>Admisión</th><th>Inicio</th><th>Espera</th><th>GES</th><th>Sillón · turno</th><th>Próxima sesión</th><th>w̄</th><th>Estado</th></tr>';
    for (const p of lista) {
      const prox = p.sesiones.map(id => ag.sesiones[id]).find(x => x.dia >= ag.diaActual);
      const ok = p.previo || !p.sesiones.length ? null : cumpleGes(p);
      const estado = [p.previo ? 'previo' : p.opcion === 'reacomodo' ? 'B · reacomodo' : 'A · estándar',
        p.reagendas ? `reagendado ×${p.reagendas}` : '', p.canceladas ? `${p.canceladas} cancelada(s)` : ''].filter(Boolean).join(' · ');
      h += `<tr class="fila-pac" data-pid="${esc(p.pid)}"><td>${esc(p.pid)}</td><td>${esc(p.nombre)}</td>` +
           `<td><span class="punto" style="background:${COLORES[catNom(p.cat)]}"></span>${catNom(p.cat)}</td>` +
           `<td>${esc(cfg.PROTOCOLOS[p.prot].nombre)}</td><td>${p.previo ? '—' : corta(p.a)}</td><td>${p.inicio >= 0 ? corta(p.inicio) : 'antes del día 1'}</td>` +
           `<td>${p.previo ? '—' : (p.inicio - p.a) + ' d'}</td><td>${ok === null ? '—' : `<span class="ges ${ok ? 'ok' : 'no'}">${ok ? 'Cumple' : 'No cumple'}</span>`}</td>` +
           `<td>Sillón ${p.sillon + 1} · ${turnoNom(p.turno)}</td><td>${prox ? corta(prox.dia) + ' ' + hora(prox.bloque) : p.canceladas ? 'cancelado' : 'terminado'}</td>` +
           `<td>${p.previo || catCfg(p.cat).urgente ? '—' : num(p.w)}</td><td>${estado}</td></tr>`;
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
    renderGestion(); renderPropuesta(); renderCalendario(); renderFranja(); renderTabla(); actualizarPrep();
  }

  function descargarCsv() {
    const ag = agenda, filas = [['id', 'nombre', 'categoria', 'protocolo', 'agudeza', 'sesion', 'fecha', 'hora_inicio', 'hora_fin', 'sillon', 'turno', 'tipo']];
    for (const p of ag.pacientes) p.sesiones.forEach(id => {
      const x = ag.sesiones[id], f = fecha(x.dia);
      filas.push([p.pid, p.nombre, catNom(p.cat), cfg.PROTOCOLOS[p.prot].nombre, x.kappa, numSesion(ag, p, id),
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
    $('cajaGestion').onclick = eventosGestion;
    $('cajaGestion').onchange = e => {
      if (e.target.id === 'gHora') { gestion.horaSel = +e.target.value; previsualizarHora(); render(); }
    };
    $('cajaGestion').oninput = e => { if (e.target.id === 'gDur') $('gDurTxt').textContent = `${e.target.value} min`; };
    $('btnAnt').onclick = () => { diaVista = Math.max(0, diaVista - 1); render(); };
    $('btnSig').onclick = () => { diaVista = Math.min(agenda.T - 1, diaVista + 1); render(); };
    $('btnHoy').onclick = () => { diaVista = agenda.diaActual; render(); };
    $('franja').onclick = e => { const b = e.target.closest('button'); if (b) { diaVista = +b.dataset.dia; render(); } };
    $('soloManuales').onchange = renderTabla;
    $('tabla').onclick = e => {
      const tr = e.target.closest('tr[data-pid]'); if (!tr) return;
      const p = agenda.pacientePorId(tr.dataset.pid), prox = p.sesiones.find(id => agenda.sesiones[id].dia >= agenda.diaActual);
      if (prox != null) abrirGestion(prox);
      else { resaltado = p.pid; if (p.sesiones.length) diaVista = agenda.sesiones[p.sesiones[0]].dia; render(); }
    };
    $('calendario').onclick = e => {
      const s = e.target.closest('.ses'); if (!s) return;
      const id = +s.dataset.ses, ses = agenda.sesiones[id];
      if (!ses || ses.anulada) return;           // sesion que solo existe en la vista previa
      abrirGestion(id);
    };
    $('btnAvanzar').onclick = () => {
      if (agenda.diaActual >= agenda.T - cfg.MAX_SPAN - 2) return;
      agenda.diaActual++; diaVista = agenda.diaActual; limpiarPropuesta(); cerrarGestion(); aviso = ''; guardar(); render();
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
      agenda.srv.m = agenda.opts.m; limpiarPropuesta(); cerrarGestion(); guardar(); render();
    };
    $('btnCsv').onclick = descargarCsv;
  }

  // ── Inicio ──
  fetch('modelo.json?v=202611111852').then(r => r.json()).then(j => {
    datos = j; cfg = j.config;
    if (!recuperar()) nuevaAgenda();
    diaVista = agenda.diaActual;
    armarFormulario(); conectar(); render();
    $('cargando').hidden = true;
  }).catch(err => { $('cargando').textContent = 'No se pudo cargar el modelo: ' + err; });
})();
