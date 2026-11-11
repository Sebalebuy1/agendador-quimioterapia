/*
 * Motor del agendador de quimioterapia (port de modelo/ en Python a JavaScript).
 *
 *  - Servidor tripartito: sillon x enfermeria x carga de enfermeria (Karakaya, Gul y Celik, 2023).
 *  - Agenda inicial: calentamiento greedy hasta 90% de ocupacion (Pham et al., 2023, sec. 4.2).
 *  - Ingreso: Algoritmo 2 de Pham et al. con el regresor XGBoost F3 exportado (urgentes: primera
 *    fecha elegible; programados: espera predicha por el modelo y primera fecha elegible desde ahi).
 *  - Reacomodo: busca una fecha anterior moviendo sesiones futuras de otros pacientes a otro sillon
 *    del mismo dia y turno (sin cambiar sus fechas, turno ni protocolo).
 *
 * Funciona en el navegador (window.Motor) y en Node (module.exports) para las pruebas de paridad.
 */
(function (global) {
  'use strict';

  // ── Aleatoriedad reproducible (solo para la agenda inicial) ─────────────────────────────────
  function crearRng(semilla) {
    let a = (semilla >>> 0) || 1;
    const random = () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const elegir = (valores, probs) => {
      let u = random(), acc = 0;
      for (let i = 0; i < valores.length; i++) { acc += probs[i]; if (u < acc) return valores[i]; }
      return valores[valores.length - 1];
    };
    const poisson = lam => { const L = Math.exp(-lam); let k = 0, p = 1; do { k++; p *= random(); } while (p > L); return k - 1; };
    const entero = (lo, hi) => lo + Math.floor(random() * (hi - lo + 1));
    const binomial = (n, p) => { let k = 0; for (let i = 0; i < n; i++) if (random() < p) k++; return k; };
    return { random, elegir, poisson, entero, binomial };
  }

  // ── Servidor ────────────────────────────────────────────────────────────────────────────────
  class Servidor {
    constructor(cfg, L, T, opts) {
      this.cfg = cfg; this.L = L; this.T = T; this.S = cfg.TURNOS.length;
      this.cap = cfg.TURNOS.map(([i, f]) => f - i);
      this.ratio = opts.ratio; this.m = opts.m; this.conAgudeza = opts.conAgudeza !== false;
      const n = L * T * this.S;
      this.libre = new Float64Array(n); this.abierto = new Uint8Array(n); this.carga = new Float64Array(n);
      for (let l = 0; l < L; l++) for (let t = 0; t < T; t++) for (let s = 0; s < this.S; s++) this.libre[this.i(l, t, s)] = this.cap[s];
      this.disp = new Uint8Array(L * T).fill(1);
      this.dotacion = new Int32Array(T * this.S);
    }
    i(l, t, s) { return (l * this.T + t) * this.S + s; }
    d(l, t) { return l * this.T + t; }
    abiertos(t, s) { let c = 0; for (let l = 0; l < this.L; l++) c += this.abierto[this.i(l, t, s)]; return c; }
    cubribles(t, s) { return this.dotacion[t * this.S + s] * this.ratio; }
    equiposLibres(t, s) { return this.cubribles(t, s) - this.abiertos(t, s); }
    cargaTurno(t, s) { let c = 0; for (let l = 0; l < this.L; l++) c += this.carga[this.i(l, t, s)]; return c; }
    capCarga(t, s) { return this.m * this.dotacion[t * this.S + s]; }
    cargaPorEnf(t, s) { return this.cargaTurno(t, s) / Math.max(this.dotacion[t * this.S + s], 1); }
    ocupacion(t) {
      let u = 0;
      for (let l = 0; l < this.L; l++) for (let s = 0; s < this.S; s++) u += this.cap[s] - this.libre[this.i(l, t, s)];
      return u / (this.L * this.cap.reduce((a, b) => a + b, 0));
    }
    excesoIncremental(dias, kappa) {
      const r = new Array(this.S).fill(0);
      for (const t of dias) for (let s = 0; s < this.S; s++) {
        const ct = this.cargaTurno(t, s), cap = this.capCarga(t, s);
        r[s] += Math.max(ct + kappa - cap, 0) - Math.max(ct - cap, 0);
      }
      return r;
    }
    // Sillon-turno utilizable el dia t (misma regla que Servidor.inicios_factibles en Python)
    ok(l, t, s, dur, reserva, kEq) {
      const k = this.i(l, t, s);
      if (this.abierto[k]) return (this.libre[k] - reserva) >= dur;
      return !!this.disp[this.d(l, t)] && (this.equiposLibres(t, s) - 1) >= kEq && (this.cap[s] - reserva) >= dur;
    }
    // Primera fecha elegible desde 'desde': {t, l, s} o null. 'turnos' restringe los turnos posibles.
    primerDiaElegible(desde, offs, dur, gamma, kEq, kappa, turnos) {
      const ultimo = offs[offs.length - 1], hasta = this.T - ultimo - 1;
      if (desde > hasta) return null;
      const reserva = this.cap.map(c => gamma * c);
      for (let t = desde; t <= hasta; t++) {
        let mejor = null, mejorCosto = Infinity, exc = null;
        for (let l = 0; l < this.L; l++) for (let s = 0; s < this.S; s++) {
          if (turnos && !turnos.includes(s)) continue;
          let fact = true, nuevas = 0;
          for (const o of offs) {
            if (!this.ok(l, t + o, s, dur, reserva[s], kEq)) { fact = false; break; }
            if (!this.abierto[this.i(l, t + o, s)]) nuevas++;
          }
          if (!fact) continue;
          let costo = nuevas;
          if (this.conAgudeza && kappa) {
            if (!exc) exc = this.excesoIncremental(offs.map(o => t + o), kappa);
            costo += 1000 * exc[s];
          }
          if (costo < mejorCosto) { mejorCosto = costo; mejor = { t, l, s }; }
        }
        if (mejor) return mejor;
      }
      return null;
    }
    reservar(t, l, s, offs, dur, kappa) {
      for (const o of offs) {
        const k = this.i(l, t + o, s);
        this.libre[k] -= dur; this.abierto[k] = 1; if (kappa) this.carga[k] += kappa;
      }
    }
    ajustarDotacion() {
      for (let t = 0; t < this.T; t++) for (let s = 0; s < this.S; s++) {
        const nec = Math.ceil(this.abiertos(t, s) / this.ratio), k = t * this.S + s;
        if (nec > this.dotacion[k]) this.dotacion[k] = nec;
      }
    }
    // Estado F3 (Pham et al. adaptado): capacidad efectiva por dia + indicador del componente que limita
    estadoF3(dia) {
      const V = this.cfg.VENTANA, efe = new Array(V).fill(0), ind = new Array(V).fill(0);
      const capTot = this.cap.reduce((a, b) => a + b, 0);
      for (let k = 0; k < V; k++) {
        const t = dia + k;
        if (t >= this.T) { efe[k] = this.L * capTot; ind[k] = 0; continue; }
        let enMant = 0;
        for (let l = 0; l < this.L; l++) enMant += this.disp[this.d(l, t)] ? 0 : 1;
        for (let s = 0; s < this.S; s++) {
          let libAb = 0, cerrados = 0;
          for (let l = 0; l < this.L; l++) {
            const q = this.i(l, t, s);
            if (this.abierto[q]) libAb += this.libre[q]; else if (this.disp[this.d(l, t)]) cerrados++;
          }
          const libres = Math.max(this.equiposLibres(t, s), 0);
          efe[k] += libAb + Math.min(cerrados, libres) * this.cap[s];
          ind[k] = Math.max(ind[k], libres < cerrados ? 2 : (enMant > 0 ? 1 : 0));
        }
      }
      return efe.concat(ind);
    }
  }

  // ── Regresor XGBoost exportado ──────────────────────────────────────────────────────────────
  function predecir(modelo, x) {
    let tot = modelo.base;
    const x32 = x.map(v => Math.fround(v));
    for (const a of modelo.arboles) {
      let k = 0;
      while (a.f[k] >= 0) k = x32[a.f[k]] < Math.fround(a.t[k]) ? a.s[k] : a.n[k];
      tot += a.v[k];
    }
    return tot;
  }

  // ── Agenda: servidor + pacientes + sesiones con su hora ────────────────────────────────────
  class Agenda {
    constructor(datos, opts) {
      this.datos = datos; this.cfg = datos.config; this.opts = opts;
      this.L = opts.sillones; this.T = this.cfg.T_ONLINE;
      this.modelo = datos.modelos[String(this.L)];
      this.srv = new Servidor(this.cfg, this.L, this.T, { ratio: opts.ratio, m: opts.m });
      this.pacientes = []; this.sesiones = []; this.orden = new Map(); this.diaActual = 0; this.contador = 0;
    }
    get cat() { return this.cfg.CATEGORIAS; }
    esUrgente(cat) { return this.cat[this.cfg.CAT_ORDER[cat]].urgente; }
    offs(prot) { return this.cfg.PROTOCOLOS[prot].offsets; }
    inicioGreedy(cat, a, r) {
      const c = this.cat[this.cfg.CAT_ORDER[cat]];
      return c.urgente ? Math.max(a, r) : Math.max(r, a + c.mirada);
    }
    // Hora (bloque) de cada sesion: se apilan en orden dentro de su sillon-turno-dia
    reapilar(key) {
      const lista = this.orden.get(key) || [], s = key % this.srv.S;
      let b = this.cfg.TURNOS[s][0];
      for (const id of lista) { this.sesiones[id].bloque = b; b += this.sesiones[id].dur; }
    }
    agregarSesion(pid, dia, l, s, dur) {
      const id = this.sesiones.length, key = this.srv.i(l, dia, s);
      this.sesiones.push({ id, pid, dia, l, s, dur, bloque: 0 });
      if (!this.orden.has(key)) this.orden.set(key, []);
      this.orden.get(key).push(id); this.reapilar(key);
      return id;
    }
    // Reserva todas las sesiones del protocolo (servidor + registro de sesiones)
    agendar(p, t, l, s) {
      const offs = this.offs(p.prot);
      this.srv.reservar(t, l, s, offs, p.dur, p.kappa);
      p.sesiones = offs.map(o => this.agregarSesion(p.pid, t + o, l, s, p.dur));
      p.inicio = t; p.sillon = l; p.turno = s;
      this.pacientes.push(p);
    }

    // ── Agenda inicial por calentamiento (Pham et al., sec. 4.2) ──
    generarInicial(semilla, regimen) {
      const cfg = this.cfg, rng = crearRng(semilla), L = this.L, S = this.srv.S;
      const largo = cfg.MAX_DIAS_CALENT + this.T + cfg.VENTANA + cfg.MAX_SPAN;
      const w = new Servidor(cfg, L, largo, { ratio: this.opts.ratio, m: this.opts.m });
      const nominalBase = Math.ceil(L / this.opts.ratio);
      for (let t = 0; t < largo; t++) {
        const nombre = regimen === 'alternante' ? (Math.floor(t / 5) % 2 === 0 ? 'sillon_limitante' : 'enfermeria_limitante') : regimen;
        const par = cfg.REGIMENES[nombre];
        const nominal = this.opts.dotacion || (nominalBase + par.holgura_enf);
        const q = this.opts.ausencia != null ? this.opts.ausencia : par.q_ausencia;
        const mant = this.opts.fueraServicio != null ? this.opts.fueraServicio : par.tasa_mant;
        for (let s = 0; s < S; s++) w.dotacion[t * S + s] = rng.binomial(nominal, 1 - q);
        for (let l = 0; l < L; l++) w.disp[w.d(l, t)] = rng.random() >= mant ? 1 : 0;
      }
      const lam = this.modelo.lam, mezcla = cfg.MEZCLA.map(v => v / 100), cats = [0, 1, 2, 3];
      const previos = [];
      let fin = cfg.MAX_DIAS_CALENT - 1;
      for (let dia = 0; dia < cfg.MAX_DIAS_CALENT; dia++) {
        const n = rng.poisson(lam);
        for (let j = 0; j < n; j++) {
          const cat = rng.elegir(cats, mezcla), c = this.cat[cfg.CAT_ORDER[cat]];
          const prot = rng.elegir(cfg.PROTOCOLOS.map((_, k) => k), cfg.PROT_PROBS[cat]);
          const dur = rng.elegir(cfg.DUR_BLOQUES, cfg.DUR_PROBS);
          const r = dia + rng.entero(c.listo[0], c.listo[1]);
          const kappa = rng.elegir(cfg.AGUDEZA_VALORES, cfg.AGUDEZA_PROBS);
          const offs = this.offs(prot);
          const sol = w.primerDiaElegible(this.inicioGreedy(cat, dia, r), offs, dur, c.urgente ? 0 : cfg.GAMMA, 0, kappa);
          if (sol) { w.reservar(sol.t, sol.l, sol.s, offs, dur, kappa); previos.push({ cat, prot, dur, kappa, a: dia, r, d: dia + c.plazo_habiles, ...sol }); }
        }
        let max = 0;
        for (let t = dia + 1; t < largo; t++) max = Math.max(max, w.ocupacion(t));
        if (max >= cfg.UMBRAL_CALENT) { fin = dia; break; }
      }
      // Recorte: el dia fin + 1 del calentamiento es el dia 0 de la agenda
      const t0 = fin + 1;
      for (let l = 0; l < L; l++) for (let t = 0; t < this.T; t++) {
        this.srv.disp[this.srv.d(l, t)] = w.disp[w.d(l, t + t0)];
        for (let s = 0; s < S; s++) {
          const a = this.srv.i(l, t, s), b = w.i(l, t + t0, s);
          this.srv.libre[a] = w.libre[b]; this.srv.abierto[a] = w.abierto[b]; this.srv.carga[a] = w.carga[b];
        }
      }
      for (let t = 0; t < this.T; t++) for (let s = 0; s < S; s++) this.srv.dotacion[t * S + s] = w.dotacion[(t + t0) * S + s];
      this.srv.ajustarDotacion();
      for (const p of previos) {
        const offs = this.offs(p.prot), futuras = offs.filter(o => p.t + o >= t0);
        if (!futuras.length) continue;
        const pid = 'E-' + String(++this.contador).padStart(3, '0');
        const pac = { pid, nombre: 'En tratamiento', previo: true, cat: p.cat, prot: p.prot, dur: p.dur, kappa: p.kappa,
          a: p.a - t0, r: p.r - t0, d: p.d - t0, inicio: p.t - t0, sillon: p.l, turno: p.s,
          sesionesPrevias: offs.length - futuras.length };
        pac.sesiones = futuras.map(o => this.agregarSesion(pid, p.t + o - t0, p.l, p.s, p.dur));
        this.pacientes.push(pac);
      }
      this.contador = 0;
      return { diasCalentamiento: t0, previos: this.pacientes.length };
    }

    // ── Ingreso de un paciente: Algoritmo 2 + referencia greedy + reacomodo ──
    proponer(entrada) {
      const cfg = this.cfg, cat = entrada.cat, c = this.cat[cfg.CAT_ORDER[cat]], urgente = c.urgente;
      const a = this.diaActual, r = a + entrada.prep, d = a + c.plazo_habiles;
      const prot = entrada.prot, offs = this.offs(prot), dur = entrada.dur, kappa = entrada.kappa;
      const gamma = urgente ? 0 : this.opts.gamma, turnos = entrada.turno == null ? null : [entrada.turno];
      let w = 0, wbar = 0, desde;
      if (urgente) desde = Math.max(a, r);
      else {
        const x = this.srv.estadoF3(a).concat([r - a, offs.length, d - a, dur, offs[offs.length - 1] + 1, kappa]);
        w = predecir(this.modelo, x); wbar = Math.max(0, Math.floor(w + 0.5)); desde = Math.max(a + wbar, r);
      }
      const base = { cat, prot, dur, kappa, a, r, d, urgente, w, wbar, desde, gamma };
      const estandar = this.srv.primerDiaElegible(desde, offs, dur, gamma, 0, kappa, turnos);
      const gr = this.srv.primerDiaElegible(this.inicioGreedy(cat, a, r), offs, dur, gamma, 0, kappa, turnos);
      const limite = estandar ? estandar.t - 1 : Math.min(desde + 60, this.T - offs[offs.length - 1] - 1);
      const reacomodo = this.buscarReacomodo(desde, limite, offs, dur, kappa, gamma, turnos);
      return { ...base, estandar, greedy: gr, reacomodo };
    }

    // Busca la primera fecha en [desde, limite] en que el paciente cabe en un sillon-turno si se mueven
    // sesiones futuras de otros pacientes a otro sillon del mismo dia y turno.
    buscarReacomodo(desde, limite, offs, dur, kappa, gamma, turnos) {
      const srv = this.srv;
      for (let t = desde; t <= limite; t++) {
        let mejor = null;
        for (let l = 0; l < srv.L; l++) for (let s = 0; s < srv.S; s++) {
          if (turnos && !turnos.includes(s)) continue;
          const plan = this.planReacomodo(t, l, s, offs, dur, gamma);
          if (!plan) continue;
          const exc = srv.conAgudeza && kappa ? srv.excesoIncremental(offs.map(o => t + o), kappa)[s] : 0;
          const costo = plan.movidas.length * 100 + exc * 1000 + plan.aperturas;
          if (!mejor || costo < mejor.costo) mejor = { t, l, s, costo, ...plan };
        }
        if (mejor && mejor.movidas.length) return mejor;
        if (mejor) return null;           // cabe sin mover a nadie: lo cubre la opcion estandar
      }
      return null;
    }
    planReacomodo(t, l, s, offs, dur, gamma) {
      const srv = this.srv, movidas = []; let aperturas = 0;
      for (const o of offs) {
        const u = t + o, k = srv.i(l, u, s), reserva = gamma * srv.cap[s];
        if (!srv.disp[srv.d(l, u)]) return null;
        // Estado local del (dia, turno): bloques libres y apertura de cada sillon
        const libre = [], abierto = [];
        for (let q = 0; q < srv.L; q++) { libre.push(srv.libre[srv.i(q, u, s)]); abierto.push(srv.abierto[srv.i(q, u, s)]); }
        let cupoApertura = srv.equiposLibres(u, s);
        if (!abierto[l]) { if (cupoApertura - 1 < 0) return null; cupoApertura--; abierto[l] = 1; aperturas++; }
        let deficit = dur + reserva - libre[l];
        if (deficit <= 1e-9) continue;
        // Sesiones movibles del sillon l ese dia y turno (de otros pacientes, todas futuras)
        const lista = (this.orden.get(k) || []).map(id => this.sesiones[id]);
        const destino = ses => {
          const pac = this.pacientePorId(ses.pid), res = this.esUrgente(pac.cat) ? 0 : this.opts.gamma * srv.cap[s];
          let elegido = -1, holgura = Infinity;
          for (let q = 0; q < srv.L; q++) {
            if (q === l || !srv.disp[srv.d(q, u)]) continue;
            if (abierto[q] && libre[q] - res >= ses.dur && libre[q] - ses.dur < holgura) { elegido = q; holgura = libre[q] - ses.dur; }
          }
          if (elegido < 0 && cupoApertura > 0)
            for (let q = 0; q < srv.L; q++) if (q !== l && srv.disp[srv.d(q, u)] && !abierto[q] && srv.cap[s] - res >= ses.dur) { elegido = q; break; }
          return elegido;
        };
        const mover = (ses, q) => {
          if (!abierto[q]) { abierto[q] = 1; cupoApertura--; aperturas++; }
          libre[q] -= ses.dur; libre[l] += ses.dur; deficit -= ses.dur;
          movidas.push({ sesion: ses.id, pid: ses.pid, dia: u, turno: s, de: l, a: q });
        };
        // 1) una sola sesion que libere el deficit (la mas corta posible)
        const unica = lista.filter(x => x.dur >= deficit).sort((x, y) => x.dur - y.dur);
        let hecho = false;
        for (const ses of unica) { const q = destino(ses); if (q >= 0) { mover(ses, q); hecho = true; break; } }
        // 2) si no, varias sesiones, de la mas larga a la mas corta
        if (!hecho) {
          for (const ses of lista.slice().sort((x, y) => y.dur - x.dur)) {
            if (deficit <= 1e-9) break;
            const q = destino(ses); if (q >= 0) mover(ses, q);
          }
          if (deficit > 1e-9) return null;
        }
      }
      return { movidas, aperturas };
    }
    pacientePorId(pid) { return this.pacientes.find(p => p.pid === pid); }

    // Aplica una propuesta ('estandar' o 'reacomodo'); retorna el paciente y los cambios de hora
    aplicar(prop, opcion, nombre) {
      const sol = prop[opcion], antes = new Map(this.sesiones.map(x => [x.id, { l: x.l, bloque: x.bloque }]));
      if (opcion === 'reacomodo') {
        const tocadas = new Set();
        for (const mv of sol.movidas) {
          const ses = this.sesiones[mv.sesion], pac = this.pacientePorId(ses.pid);
          const k0 = this.srv.i(mv.de, mv.dia, mv.turno), k1 = this.srv.i(mv.a, mv.dia, mv.turno);
          this.srv.libre[k0] += ses.dur; this.srv.libre[k1] -= ses.dur;
          this.srv.carga[k0] -= pac.kappa; this.srv.carga[k1] += pac.kappa;
          this.srv.abierto[k1] = 1;
          this.orden.set(k0, this.orden.get(k0).filter(id => id !== ses.id));
          if (!this.orden.get(k0).length) this.srv.abierto[k0] = 0;
          if (!this.orden.has(k1)) this.orden.set(k1, []);
          this.orden.get(k1).push(ses.id); ses.l = mv.a;
          tocadas.add(k0); tocadas.add(k1);
        }
        for (const k of tocadas) this.reapilar(k);
      }
      const pid = 'N-' + String(++this.contador).padStart(3, '0');
      const pac = { pid, nombre: nombre || `Paciente ${this.contador}`, previo: false, cat: prop.cat, prot: prop.prot,
        dur: prop.dur, kappa: prop.kappa, a: prop.a, r: prop.r, d: prop.d, w: prop.w, wbar: prop.wbar,
        opcion, sesionesPrevias: 0 };
      this.agendar(pac, sol.t, sol.l, sol.s);
      const cambios = this.sesiones.filter(x => antes.has(x.id) && (antes.get(x.id).l !== x.l || antes.get(x.id).bloque !== x.bloque))
        .map(x => ({ id: x.id, pid: x.pid, dia: x.dia, turno: x.s, de: antes.get(x.id).l, a: x.l,
                     bloqueAntes: antes.get(x.id).bloque, bloque: x.bloque }));
      return { pac, cambios };
    }

    // Vista previa: aplica la propuesta sobre una copia y entrega los cambios, sin tocar la agenda
    previsualizar(prop, opcion) { return this.copia().aplicar(prop, opcion, 'Vista previa'); }
    copia() {
      const o = new Agenda(this.datos, this.opts);
      for (const k of ['libre', 'abierto', 'carga', 'disp', 'dotacion']) o.srv[k] = this.srv[k].slice();
      o.pacientes = this.pacientes.map(p => ({ ...p, sesiones: p.sesiones.slice() }));
      o.sesiones = this.sesiones.map(x => ({ ...x }));
      o.orden = new Map([...this.orden].map(([k, v]) => [k, v.slice()]));
      o.diaActual = this.diaActual; o.contador = this.contador;
      return o;
    }
    // Serializacion para guardar en el navegador
    exportar() {
      const s = this.srv;
      return { opts: this.opts, diaActual: this.diaActual, contador: this.contador, pacientes: this.pacientes,
        sesiones: this.sesiones, orden: [...this.orden],
        srv: { libre: [...s.libre], abierto: [...s.abierto], carga: [...s.carga], disp: [...s.disp], dotacion: [...s.dotacion] } };
    }
    static importar(datos, j) {
      const o = new Agenda(datos, j.opts);
      o.srv.libre = Float64Array.from(j.srv.libre); o.srv.abierto = Uint8Array.from(j.srv.abierto);
      o.srv.carga = Float64Array.from(j.srv.carga); o.srv.disp = Uint8Array.from(j.srv.disp);
      o.srv.dotacion = Int32Array.from(j.srv.dotacion);
      o.pacientes = j.pacientes; o.sesiones = j.sesiones; o.orden = new Map(j.orden);
      o.diaActual = j.diaActual; o.contador = j.contador;
      return o;
    }
  }

  const Motor = { crearRng, Servidor, Agenda, predecir };
  if (typeof module !== 'undefined' && module.exports) module.exports = Motor; else global.Motor = Motor;
})(typeof window !== 'undefined' ? window : globalThis);
