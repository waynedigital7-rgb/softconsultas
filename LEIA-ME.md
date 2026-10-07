# Soft Consultas

Plataforma de consultas com cadastro, carteira de créditos (recarga por Pix), catálogo de consultas da APIFull, resultado na tela com resumo, PDF para baixar, histórico e painel administrativo.

## Variáveis de ambiente (Render → Environment)

| Nome | Valor |
|---|---|
| `DATA_DIR` | `/var/data` (pasta do disco persistente) |
| `ADMIN_EMAIL` | seu e-mail (a conta criada com ele vira administradora) |
| `RESEND_API_KEY` | chave do Resend (e-mails de boas-vindas e recuperação de senha) |
| `EMAIL_REMETENTE` | `Soft Consultas <contato@softcredito.com.br>` (até verificar o softconsultas.com no Resend) |
| `ASAAS_URL` | `https://api.asaas.com/v3` (conta real) |
| `ASAAS_API_KEY` | chave de produção do Asaas (`$aact_prod_...`) |
| `ASAAS_WEBHOOK_TOKEN` | token do webhook (veja abaixo) |
| `APIFULL_TOKEN` | o mesmo token da APIFull do outro site |

## Variáveis opcionais

| Nome | Para que serve |
|---|---|
| `URL_BASE` | `https://softconsultas.com` (links de e-mail e de indicação) |
| `TURNSTILE_SITE_KEY` e `TURNSTILE_SECRET_KEY` | "Não sou um robô" (Cloudflare Turnstile) no cadastro, login e senha |
| `META_PIXEL_ID` | Pixel da Meta (Instagram/Facebook) nas páginas |
| `GOOGLE_TAG_ID` | Tag do Google (ex.: `G-XXXX` do Analytics ou `AW-XXXX` do Ads) |
| `GOOGLE_ADS_CONV_CADASTRO` / `GOOGLE_ADS_CONV_RECARGA` | Conversões do Google Ads no formato `AW-XXXX/rótulo` |
| `CONTATO_ANUNCIE` | Link do botão "Anuncie aqui" (padrão: WhatsApp) |

## Páginas de campanha
- `/para/limpa-nome`, `/para/advogados`, `/para/empresas`
- Links prontos com UTM e o resultado por campanha ficam em **Admin → Campanhas**.

## Disco persistente (obrigatório)
Render → serviço → **Disks → Add Disk**: Mount Path `/var/data`, tamanho 1 GB.
Sem ele, cadastros, saldos e histórico são apagados a cada atualização.

## Webhook do Asaas (para o saldo cair sozinho)
No Asaas real: **Integrações → Webhooks → Adicionar webhook** (um segundo webhook, além do da Soft Crédito):
- URL: `https://SEU-ENDERECO.onrender.com/webhook/asaas`
- Token: o mesmo valor de `ASAAS_WEBHOOK_TOKEN`
- Tipo de envio: Não sequencial · Fila de sincronização: ativada
- Eventos: **Cobrança recebida** e **Cobrança confirmada**

Os dois sistemas usam a mesma conta Asaas sem conflito: cada um só processa as próprias cobranças.
Mesmo sem o webhook, a página de pagamento confere o pagamento sozinha enquanto o cliente estiver nela.

## Configurar as consultas (Admin → Consultas e preços)
- Já vem cadastradas: Cred Completa Plus (ativa, endpoint `e-boavista`) e outras 7 inativas.
- Para ativar uma consulta: clique em **Editar**, preencha o **endpoint** da APIFull e o **custo**, marque **Ativa** e salve.
- Preço de venda = custo + margem (padrão 150%). A margem fica em **Admin → Configurações**.
- Para consultas por placa, escolha "Placa de veículo" e use o nome de campo indicado na documentação da APIFull (geralmente `placa`).

## Configurações (Admin → Configurações)
- Margem sobre o custo (%), recarga mínima e faixas de bônus (ex.: `100=5; 300=10`).

## Como o cliente usa
1. Cria a conta e recarrega por Pix (com bônus conforme a faixa).
2. Escolhe a consulta, informa o documento e a finalidade (exigência da LGPD).
3. Vê o resultado na hora, com resumo em semáforo, e baixa o PDF original da fonte.
4. Se a consulta falhar, o valor volta automaticamente ao saldo.

## Termos e privacidade
Os textos em `/termos` e `/privacidade` são uma minuta. Peça para um advogado revisar antes de divulgar a plataforma.
