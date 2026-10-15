const $ = (id) => document.getElementById(id);

const enteEl = $("ente");
const exportarEl = $("exportar");
const avisoEl = $("aviso");
const resumoEl = $("resumo");
const emptyEl = $("empty-state");
const tabelaWrapEl = $("tabela-wrap");
const graficosWrapEl = $("graficos-wrap");
const tooltipEl = $("tooltip");

const TOTAL_RELATORIOS = 40;
const SITUACAO = {
  regular: { ico: "✓", txt: "Abaixo do limite de alerta" },
  acima_alerta: { ico: "!", txt: "Acima do limite de alerta" },
  acima_prudencial: { ico: "!", txt: "Acima do limite prudencial" },
  acima_maximo: { ico: "×", txt: "Acima do limite máximo" },
  sem_limite: { ico: "–", txt: "Sem limite próprio na LRF" },
  sem_dado: { ico: "–", txt: "Sem dado no período" },
};

const fmtPct = (v) =>
  v == null ? "—" : (v * 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%";
const fmtBi = (v) =>
  v == null ? "—" : "R$ " + (v / 1e9).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " bi";
const fmtMi = (v) =>
  v == null ? "—" : "R$ " + (v / 1e6).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " mi";
const fmtValor = (v) => (v != null && Math.abs(v) >= 1e9 ? fmtBi(v) : fmtMi(v));
const curto = (p) => `${p.periodo}º q. ${p.ano}`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function fetchJSON(url) {
  const r = await fetch(url);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(body.error || `HTTP ${r.status}`), { status: r.status });
  return body;
}

// Versão publicada (estática): dados embutidos em window.RGF_DADOS e planilhas pré-geradas em xlsx/.
const ESTATICO = window.RGF_DADOS || null;

async function obterEntes() {
  if (ESTATICO) return ESTATICO.entes.map(({ dados, ...e }) => e);
  return fetchJSON("/api/rgf/entes");
}

async function obterDados(cod) {
  if (ESTATICO) {
    const e = ESTATICO.entes.find((x) => String(x.cod_ibge) === String(cod));
    if (!e) throw new Error("estado/DF não encontrado");
    return e.dados;
  }
  return fetchJSON(`/api/rgf/pessoal?cod_ibge=${cod}`);
}

function linkExportacao(ente, cod) {
  return ESTATICO
    ? `xlsx/rgf_despesa_pessoal_${ente.uf}_2024_2026.xlsx`
    : `/api/rgf/export?cod_ibge=${cod}`;
}

let entes = [];
let token = 0;

function lembrar(cod) {
  try { localStorage.setItem("rgf-ente", String(cod)); } catch (e) { /* armazenamento indisponível */ }
}
function lembrado() {
  try { return localStorage.getItem("rgf-ente"); } catch (e) { return null; }
}

async function init() {
  entes = await obterEntes();
  enteEl.innerHTML = entes
    .map((e) => `<option value="${e.cod_ibge}">${esc(e.nome)} (${e.uf})</option>`)
    .join("");
  const salvo = lembrado();
  enteEl.value = entes.some((e) => String(e.cod_ibge) === salvo) ? salvo : "26";
  await carregar();
}

function mostrarAviso(ente) {
  if (ente && ente.relatorios < TOTAL_RELATORIOS) {
    avisoEl.textContent =
      `Extração em andamento: ${ente.relatorios} de ${TOTAL_RELATORIOS} relatórios deste estado já foram carregados. ` +
      `Os dados podem estar incompletos; recarregue a página em alguns minutos.`;
    avisoEl.hidden = false;
  } else {
    avisoEl.hidden = true;
  }
}

async function carregar() {
  const cod = enteEl.value;
  lembrar(cod);
  const meu = ++token;
  const ente = entes.find((e) => String(e.cod_ibge) === cod);

  exportarEl.href = linkExportacao(ente || { uf: cod }, cod);
  exportarEl.setAttribute("download", `rgf_despesa_pessoal_${ente ? ente.uf : cod}_2024_2026.xlsx`);
  emptyEl.textContent = "Carregando...";
  emptyEl.hidden = false;
  resumoEl.hidden = tabelaWrapEl.hidden = graficosWrapEl.hidden = true;

  let dados;
  try {
    entes = await obterEntes();
    dados = await obterDados(cod);
  } catch (err) {
    if (meu !== token) return;
    emptyEl.textContent = err.status === 503
      ? "A extração do RGF ainda não começou. Execute scripts/extract_rgf_estados.py e recarregue a página."
      : `Não foi possível carregar os dados: ${err.message}.`;
    exportarEl.setAttribute("aria-disabled", "true");
    return;
  }
  if (meu !== token) return;
  mostrarAviso(entes.find((e) => String(e.cod_ibge) === cod));

  if (!dados.orgaos.length) {
    emptyEl.textContent = `Ainda não há relatórios de ${dados.nome} carregados.`;
    exportarEl.setAttribute("aria-disabled", "true");
    return;
  }
  exportarEl.removeAttribute("aria-disabled");
  emptyEl.hidden = true;
  renderResumo(dados);
  renderTabela(dados);
  renderGraficos(dados);
}

function renderResumo(d) {
  const ultimo = d.periodos[d.periodos.length - 1];
  const exec = d.orgaos.find((o) => o.grupo === "E");
  const rcl = exec ? exec.pontos[exec.pontos.length - 1].rcl : null;
  $("resumo-titulo").textContent = `${d.nome} (${d.uf}) — ${d.orgaos.length} poderes e órgãos`;
  $("resumo-meta").innerHTML =
    `<span>Último período: ${esc(ultimo.rotulo)} (${esc(ultimo.meses)})</span>` +
    `<span>RCL Ajustada: ${fmtBi(rcl)}</span>`;
  resumoEl.hidden = false;
}

function renderTabela(d) {
  const ultimo = d.periodos[d.periodos.length - 1];
  $("tabela-head").innerHTML =
    `<th>Poder / órgão</th>` +
    d.periodos.map((p) => `<th title="${esc(p.meses)}">${curto(p)}</th>`).join("") +
    `<th>Limite máximo<br>(${curto(ultimo)})</th><th>Situação<br>(${curto(ultimo)})</th>`;

  $("tabela-body").innerHTML = d.orgaos.map((o) => {
    const cells = o.pontos.map((p) => {
      if (p.pct == null) return `<td class="pct val-zero">—</td>`;
      const fora = ["acima_alerta", "acima_prudencial", "acima_maximo"].includes(p.situacao);
      const calc = p.fonte === "calculado" ? `<span class="calc-mark" title="Calculado: despesa líquida / RCL Ajustada do Executivo">*</span>` : "";
      return `<td class="pct${fora ? " fora-alerta" : ""}">${fmtPct(p.pct)}${calc}</td>`;
    }).join("");
    const ult = o.pontos[o.pontos.length - 1];
    const s = SITUACAO[ult.situacao] || SITUACAO.sem_dado;
    return `<tr class="grupo-${o.grupo}">
      <td class="org-cell"><span class="org-nome">${esc(o.nome)}</span><span class="org-poder">${esc(o.poder)}</span></td>
      ${cells}
      <td>${ult.lim_max != null ? fmtPct(ult.lim_max) : "—"}</td>
      <td><span class="chip chip-${ult.situacao}"><span class="chip-ico" aria-hidden="true">${s.ico}</span>${s.txt}</span></td>
    </tr>`;
  }).join("");
  tabelaWrapEl.hidden = false;
}

// ---------------------------------------------------------------- gráficos

function passoBonito(bruto) {
  const exp = Math.pow(10, Math.floor(Math.log10(bruto)));
  const f = bruto / exp;
  const m = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return m * exp;
}

function caminhoLimite(pontos, chave, xs, y, meio, xMin, xMax) {
  let d = "";
  let anterior = null;
  pontos.forEach((p, i) => {
    const v = p[chave];
    if (v == null) { anterior = null; return; }
    const x0 = Math.max(xMin, xs[i] - meio);
    const x1 = Math.min(xMax, xs[i] + meio);
    if (anterior == null) d += `M${x0},${y(v)}H${x1}`;
    else d += (anterior !== v ? `V${y(v)}` : "") + `H${x1}`;
    anterior = v;
  });
  return d;
}

function renderGraficos(d) {
  const W = 320, H = 170, L = 44, R = 46, T = 10, B = 24;
  const pw = W - L - R, ph = H - T - B;
  const n = d.periodos.length;
  const xs = d.periodos.map((_, i) => L + (n === 1 ? pw / 2 : (i * pw) / (n - 1)));
  const meio = n > 1 ? pw / (n - 1) / 2 : pw / 2;

  $("graficos").innerHTML = d.orgaos.map((o, idx) => {
    const valores = o.pontos.flatMap((p) => [p.pct, p.lim_max]).filter((v) => v != null);
    const maxBruto = Math.max(...valores) * 1.08;
    const passo = passoBonito(maxBruto / 4);
    const yMax = Math.ceil(maxBruto / passo) * passo;
    const y = (v) => T + ph - (v / yMax) * ph;

    let svg = "";
    for (let v = 0; v <= yMax + 1e-12; v += passo) {
      svg += `<line class="${v === 0 ? "base-line" : "grid-line"}" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>`;
      svg += `<text class="tick" x="${L - 6}" y="${y(v) + 3}" text-anchor="end">${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%</text>`;
    }
    d.periodos.forEach((p, i) => {
      svg += `<text class="tick" x="${xs[i]}" y="${H - 6}" text-anchor="middle">${p.periodo}Q${String(p.ano).slice(2)}</text>`;
    });
    [["lim_alerta", "lim-alerta"], ["lim_prudencial", "lim-prudencial"], ["lim_max", "lim-maximo"]].forEach(([k, cls]) => {
      const chave = k === "lim_prudencial" ? "lim_prud" : k;
      const path = caminhoLimite(o.pontos, chave, xs, y, meio, L, W - R);
      if (path) svg += `<path class="lim ${cls}" d="${path}"/>`;
    });

    let linha = "";
    let aberto = false;
    o.pontos.forEach((p, i) => {
      if (p.pct == null) { aberto = false; return; }
      linha += `${aberto ? "L" : "M"}${xs[i]},${y(p.pct)}`;
      aberto = true;
    });
    svg += `<path class="serie" d="${linha}"/>`;
    let ultimoIdx = -1;
    o.pontos.forEach((p, i) => {
      if (p.pct == null) return;
      ultimoIdx = i;
      svg += `<circle class="ponto" cx="${xs[i]}" cy="${y(p.pct)}" r="4"/>`;
    });
    if (ultimoIdx >= 0) {
      const p = o.pontos[ultimoIdx];
      svg += `<circle class="ponto ponto-ultimo" cx="${xs[ultimoIdx]}" cy="${y(p.pct)}" r="5"/>`;
      svg += `<text class="rotulo-ultimo" x="${xs[ultimoIdx] + 9}" y="${y(p.pct) + 4}">${fmtPct(p.pct)}</text>`;
    }
    svg += `<line class="cross" x1="0" x2="0" y1="${T}" y2="${T + ph}" visibility="hidden"/>`;
    d.periodos.forEach((_, i) => {
      const x0 = i === 0 ? L - meio : xs[i] - meio;
      svg += `<rect class="hit" data-org="${idx}" data-i="${i}" x="${x0}" y="${T}" width="${meio * 2}" height="${ph}"/>`;
    });

    const ult = o.pontos[o.pontos.length - 1];
    const sub = ult.lim_max != null
      ? `${esc(o.poder)} · limite máximo ${fmtPct(ult.lim_max)}`
      : `${esc(o.poder)} · sem limite próprio na LRF`;
    return `<figure class="mini">
      <figcaption><p class="mini-titulo">${esc(o.nome)}</p><p class="mini-sub">${sub}</p></figcaption>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolução do % da despesa com pessoal de ${esc(o.nome)}">${svg}</svg>
    </figure>`;
  }).join("");

  graficosWrapEl.hidden = false;
  ligarTooltip(d, xs);
}

function ligarTooltip(d, xs) {
  const cont = $("graficos");
  cont.onmousemove = (ev) => {
    const hit = ev.target.closest(".hit");
    if (!hit) return esconder();
    const o = d.orgaos[Number(hit.dataset.org)];
    const i = Number(hit.dataset.i);
    const p = o.pontos[i];
    const svg = hit.ownerSVGElement;
    const cross = svg.querySelector(".cross");
    cross.setAttribute("x1", xs[i]);
    cross.setAttribute("x2", xs[i]);
    cross.setAttribute("visibility", "visible");
    const s = SITUACAO[p.situacao] || SITUACAO.sem_dado;
    tooltipEl.innerHTML =
      `<strong>${esc(o.nome)} · ${esc(p.rotulo)}</strong>` +
      `<span class="tt-muted">${esc(p.meses)}</span><br>` +
      `% sobre a RCL Ajustada: <b>${fmtPct(p.pct)}</b>${p.fonte === "calculado" ? " (calculado)" : ""}<br>` +
      `Despesa total com pessoal: ${fmtValor(p.dtp)}<br>` +
      (p.lim_max != null
        ? `Limites: alerta ${fmtPct(p.lim_alerta)} · prudencial ${fmtPct(p.lim_prud)} · máximo ${fmtPct(p.lim_max)}<br>`
        : `Sem limite próprio na LRF<br>`) +
      `${s.txt}`;
    tooltipEl.hidden = false;
    const r = tooltipEl.getBoundingClientRect();
    let left = ev.clientX + 14;
    let top = ev.clientY + 14;
    if (left + r.width > window.innerWidth - 8) left = ev.clientX - r.width - 14;
    if (top + r.height > window.innerHeight - 8) top = ev.clientY - r.height - 14;
    tooltipEl.style.left = `${Math.max(8, left)}px`;
    tooltipEl.style.top = `${Math.max(8, top)}px`;
    cont.querySelectorAll(".cross").forEach((c) => { if (c !== cross) c.setAttribute("visibility", "hidden"); });
  };
  cont.onmouseleave = esconder;
  function esconder() {
    tooltipEl.hidden = true;
    cont.querySelectorAll(".cross").forEach((c) => c.setAttribute("visibility", "hidden"));
  }
}

enteEl.addEventListener("change", carregar);
init();
