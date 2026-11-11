# TikTok Wallet — clone do entregável wallet.ytaitools.space

Clone do funil "TikTok Wallet" (saldo travado → verificação de documentos → chat de suporte).
Original: Laravel + Alpine + Turbo + Supabase. Aqui o FRONT é 100% o mesmo (mesmo HTML/CSS/JS,
mesmo app.js e lead.js), e o backend virou `public/js/wallet-shim.js` (roda no navegador).

## No ar
    https://walletreward.vercel.app   (projeto Vercel gringa1bf/walletreward)

## Rodar local
    node _dev-server.js      # http://127.0.0.1:4599

## Estrutura
- `public/` — o site (o que sobe pra Vercel)
  - `index.html` (/), `login.html`, `verification.html`, `cards.html`, `support.html`, `support-chat.html`
  - `css/` `js/` `images/` `avatars/` — assets idênticos ao original
  - `js/wallet-shim.js` — o "servidor" local: sessão, nome, chat da Sarah, upload, tracking
- `_original/telas/` — HTML original capturado (referência, não sobe)
- `vercel.json` — rewrites das rotas (Turbo)

## O que já funciona (Fase 1 — testado 11/11)
- Login por e-mail (sessão localStorage), com o mesmo gate do original
- Carteira: saldo travado $1,789.83, banner de documentos, ações bloqueadas (lock-gate)
- Verificação: 3 documentos + sheet de upload (aceita, só metadata)
- Cards travado até verificar
- Suporte: FAQ + chat ao vivo com a "Sarah Mitchell" respondendo sozinha (10 FAQs reais), com histórico

## Pendente (Fase 2)
- Gancho de pagamento: tela de "review em progresso" + cobrança da confirmation fee (VendePay)
- (opcional) chat com backend real no Supabase pra o Yalo responder os leads
- Domínio próprio
