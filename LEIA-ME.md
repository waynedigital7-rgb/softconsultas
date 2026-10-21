# Soft Consultas

Plataforma de consultas com cadastro, carteira de créditos (recarga por Pix), catálogo de consultas da APIFull, resultado na tela com resumo, PDF para baixar, histórico e painel administrativo.

## Variáveis de ambiente (Render → Environment)

| Nome | Valor |
|---|---|
| `DATA_DIR` | `/var/data` (pasta do disco persistente) |
| `ADMIN_EMAIL` | seu e-mail (a conta criada com ele vira administradora). Aceita vários, separados por vírgula |
| `RESEND_API_KEY` | chave do Resend (e-mails de boas-vindas e recuperação de senha) |
| `EMAIL_REMETENTE` | `Soft Consultas <contato@softcredito.com.br>` (até verificar o softconsultas.com no Resend) |
| `ASAAS_URL` | `https://api.asaas.com/v3` (conta real) |
| `ASAAS_API_KEY` | chave de produção do Asaas (`$aact_prod_...`) |
| `ASAAS_WEBHOOK_TOKEN` | token do webhook (veja abaixo) |
| `APIFULL_TOKEN` | o mesmo token da APIFull do outro site |

## Variáveis opcionais

| Nome | Para que serve |
|---|---|
| `CONTAS_INTERNAS` | E-mails (separados por vírgula) que usam o saldo da APIFull e consultam a preço de custo, como o admin, mas sem acesso ao painel administrativo |
| `URL_BASE` | `https://softconsultas.com` (links de e-mail e de indicação) |
| `TURNSTILE_SITE_KEY` e `TURNSTILE_SECRET_KEY` | "Não sou um robô" (Cloudflare Turnstile) no cadastro, login e senha |
| `META_PIXEL_ID` | Pixel da Meta (Instagram/Facebook) nas páginas |
| `META_CAPI_TOKEN` | Token da API de Conversões da Meta (Gerenciador de Eventos → pixel → Configurações → Gerar token). O servidor avisa cada compra paga, mesmo se o cliente fechou a página |
| `META_CAPI_TEST_CODE` | Opcional: código de teste do Gerenciador de Eventos, para ver os eventos na aba "Testar eventos". Apague depois de testar |
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

## White label do parceiro
- O parceiro configura em **Parceiro → Sua marca**: nome, logo, cor, WhatsApp, e-mail e a página de vendas `/p/nome-da-empresa`.
- Com a marca ativa, a página de pagamento, o acompanhamento, a ficha do Rating e os e-mails do cliente saem só com a marca dele (sem o pixel da Soft).
- **Receber no nome da empresa (DESLIGADO por enquanto; liga com a config `wl_subconta` = 1):** o sistema cria uma subconta Asaas no CPF/CNPJ do parceiro. Depois que o Asaas aprova, as cobranças saem pela subconta e o *split* manda a nossa parte fixa (atacado) para a nossa conta. A comissão não entra no saldo nem no repasse por Pix (ele já recebeu direto).
- Requisitos no Asaas: conta principal PJ com criação de subcontas e split liberados pela API. No início vale o "Período de Avaliação Regulatório" do Asaas (até 10 subcontas, R$ 2.000 em cobranças por subconta, 60 dias) até a homologação.
- Admin → Parceiros → (parceiro): situação da subconta, vendas com split, botões para conferir, pausar/retomar o recebimento na subconta e desligar a marca.
- Enquanto a subconta está desligada, o parceiro cadastra a própria chave Pix (área do parceiro ou "Sua marca") e a comissão sai no repasse automático, como o do Mateus. Toda troca de chave fica registrada e avisa o parceiro por e-mail.
