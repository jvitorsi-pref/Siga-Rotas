# Formato da Planilha Excel (.xlsx) — Planejamento Inteligente de Visitas (ACS)

O **SIGA APP** aceita planilhas `.xlsx` flexíveis para importar o cronograma de visitas domiciliares do Agente Comunitário de Saúde (ACS) e a base territorial de pacientes próximos para sugestões oportunísticas.

Você também pode baixar um **modelo `.xlsx` pronto** diretamente dentro da seção **Planejamento de Visitas** do aplicativo (tanto no Android quanto na versão Web).

---

## 1. Colunas aceitas (flexível a variações de cabeçalho)

Os nomes de coluna ignoram maiúsculas/minúsculas, acentos e espaços.

| Coluna recomendada | Variações aceitas | Obrigatória? | Formato esperado |
| --- | --- | --- | --- |
| `id_paciente` | `id`, `codigo_paciente`, `prontuario`, `cns`, `cartao_sus`, `identificador` | Recomendada | Código único do prontuário/cadastro (evita duplicidades em reimportações) |
| `nome_paciente` | `nome`, `paciente`, `cidadao`, `nome_completo` | **Sim** (ou `id_paciente`) | Nome completo ou identificação do domicílio |
| `endereco_digital` | `cep_digital`, `plus_code`, `pluscode`, `codigo_plus` | **Sim** (ou `latitude` + `longitude`) | CEP Digital / Plus Code em Santo André (curto `8FP9+J6` ou completo `588M8FP9+J6`) |
| `latitude` e `longitude` | `lat`, `lon`, `lng`, `coordenadas` | Opcional se houver `endereco_digital` | Coordenadas decimais WGS84 dentro de Santo André (ex.: `-23.6639`, `-46.5318`) |
| `endereco` | `logradouro`, `rua`, `endereco_completo`, `referencia` | Opcional | Descrição textual do endereço para conferência do ACS |
| `microarea` | `micro_area`, `equipe`, `area`, `territorio` | Opcional | Identificação da microárea |
| `data_prevista` | `data_visita`, `data`, `data_agendada`, `data_planejada` | Opcional | `DD/MM/AAAA`, `AAAA-MM-DD` ou célula de data nativa do Excel |
| `ultima_visita` | `data_ultima_visita`, `ultimo_atendimento`, `dias_sem_visita` | Opcional | Data da última visita (`DD/MM/AAAA` ou `AAAA-MM-DD`) ou número de dias |
| `prioridade` | `prioridade_cronograma`, `ordem_prioridade` | Opcional | `alta`, `media` ou `baixa` (definida pelo cronograma do ACS) |
| `planejada` | `no_cronograma`, `cronograma`, `tipo_visita` | Opcional (padrão `SIM`) | `SIM` para visita planejada do período; `NAO` para paciente territorial elegível como sugestão próxima |
| `status_visita` | `status`, `situacao` | Opcional (padrão `planejada`) | `planejada`, `realizada` ou `nao_realizada` |
| `observacoes` | `observacao`, `notas`, `obs`, `acompanhamento`, `grupo` | Opcional | Notas operacionais da visita |

---

## 2. Regras de validação, período e sugestões oportunísticas

- **Localização reutilizando o projeto**: o importador resolve o `endereco_digital` pelo algoritmo oficial do CEP Digital (`core/enderecoDigital.js`) ou gera automaticamente o Plus Code a partir de `latitude`/`longitude`. Coordenadas fora de Santo André ou linhas sem localização válida são apontadas na pré-visualização com número da linha e mensagem clara — o app nunca inventa coordenadas.
- **Período configurável**: ao importar ou consultar o cronograma, o ACS define livremente a janela de planejamento (7, 14, 15, 30 dias ou intervalo personalizado de datas), sem ficar preso a 1 semana.
- **Deduplicação**: linhas repetidas na mesma planilha ou pacientes já importados anteriormente são mesclados automaticamente usando `id_paciente` (ou nome + Plus Code/coordenadas), preservando o status de visitas já concluídas.
- **Pré-visualização antes de confirmar**: antes de gravar, o app exibe quantos registros são válidos, novos, atualizações, planejados vs. base territorial e eventuais erros por linha.
- **Sugestões oportunísticas**: pacientes próximos não incluídos na rota ativa aparecem apenas como **sugestões contextuais** (ex.: quando uma visita é marcada como **Não realizada** ou próximo ao deslocamento atual). O ACS escolhe explicitamente se deseja clicar em **+ Incluir na rota**.
- **Extensibilidade clínica futura**: o sistema não inventa pontuações nem regras médicas; informações como prioridade do cronograma e dias sem visita são transparentes e ficam prontas para integração futura de regras clínicas oficiais.
