-- ============================================================================
-- SIGA-Rotas — DDL Oracle 11g (SRID = NULL)
-- ----------------------------------------------------------------------------
-- Tabelas e sequences para persistência corporativa de:
--   1) SIGA_ROTA            (rotas CALCULADA e execuções reais GPS)
--   2) SIGA_ROTA_OBSERVACAO (observações georreferenciadas vinculadas à rota)
--   3) SIGA_ROTA_EVENTO     (histórico/auditoria de interações em observações)
--
-- Compatível com Oracle Database 11g:
--   • Utiliza SEQUENCE + NEXTVAL (sem GENERATED AS IDENTITY do 12c+);
--   • Utiliza CLOB para payloads JSON (sem constraint IS JSON do 12c+);
--   • Utiliza MDSYS.SDO_GEOMETRY com SDO_SRID = NULL (padrão SIGA).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. SEQUENCES
-- ----------------------------------------------------------------------------
CREATE SEQUENCE SEQ_SIGA_ROTA
  START WITH 1
  INCREMENT BY 1
  NOCACHE
  NOCYCLE;

CREATE SEQUENCE SEQ_SIGA_ROTA_OBSERVACAO
  START WITH 1
  INCREMENT BY 1
  NOCACHE
  NOCYCLE;

CREATE SEQUENCE SEQ_SIGA_ROTA_EVENTO
  START WITH 1
  INCREMENT BY 1
  NOCACHE
  NOCYCLE;

-- ----------------------------------------------------------------------------
-- 2. SIGA_ROTA — Rotas calculadas e rotas percorridas por GPS
--    Regra:
--      • TIPO_ROTA = 'CALCULADA': trajeto planejado (A → paradas → A).
--      • TIPO_ROTA = 'GPS': execução real em campo; ID_ROTA_ORIGEM aponta para
--        a rota CALCULADA de origem sem jamais sobrescrever sua geometria.
--      • Uma rota CALCULADA pode originar 0..N execuções GPS.
-- ----------------------------------------------------------------------------
CREATE TABLE SIGA_ROTA (
  ID_ROTA           NUMBER(12)                   NOT NULL,
  ID_CLIENTE        VARCHAR2(36)                 NOT NULL,
  ID_ROTA_ORIGEM    NUMBER(12)                       NULL,
  TIPO_ROTA         VARCHAR2(20)                 NOT NULL,
  GEOMETRY          MDSYS.SDO_GEOMETRY           NOT NULL,
  DISTANCIA_METROS  NUMBER(12, 2)  DEFAULT 0     NOT NULL,
  DURACAO_SEGUNDOS  NUMBER(12)     DEFAULT 0     NOT NULL,
  TITULO            VARCHAR2(160)                    NULL,
  MODO_CALCULO      VARCHAR2(30)                     NULL,
  CIRCULAR          NUMBER(1)      DEFAULT 1     NOT NULL,
  PONTOS_JSON       CLOB                             NULL,
  LEGS_JSON         CLOB                             NULL,
  DATA_CRIACAO      TIMESTAMP(6) WITH TIME ZONE  DEFAULT SYSTIMESTAMP NOT NULL,
  DATA_INICIO       TIMESTAMP(6) WITH TIME ZONE      NULL,
  DATA_FIM          TIMESTAMP(6) WITH TIME ZONE      NULL,
  DATA_ATUALIZACAO  TIMESTAMP(6) WITH TIME ZONE  DEFAULT SYSTIMESTAMP NOT NULL,
  VERSAO            NUMBER(10)     DEFAULT 1     NOT NULL,
  STATUS            VARCHAR2(25)                 NOT NULL,
  ID_USUARIO        VARCHAR2(80)                 NOT NULL,

  CONSTRAINT PK_SIGA_ROTA PRIMARY KEY (ID_ROTA),
  CONSTRAINT UQ_SIGA_ROTA_ID_CLIENTE UNIQUE (ID_CLIENTE),
  CONSTRAINT FK_SIGA_ROTA_ORIGEM FOREIGN KEY (ID_ROTA_ORIGEM)
    REFERENCES SIGA_ROTA (ID_ROTA),
  CONSTRAINT CK_SIGA_ROTA_TIPO CHECK (TIPO_ROTA IN ('CALCULADA', 'GPS')),
  CONSTRAINT CK_SIGA_ROTA_CIRCULAR CHECK (CIRCULAR IN (0, 1)),
  CONSTRAINT CK_SIGA_ROTA_ORIGEM_TIPO CHECK (ID_ROTA_ORIGEM IS NULL OR TIPO_ROTA = 'GPS'),
  CONSTRAINT CK_SIGA_ROTA_STATUS CHECK (
    STATUS IN ('PLANEJADA', 'SALVA', 'EM_EXECUCAO', 'CONCLUIDA', 'INTERROMPIDA', 'CANCELADA')
  )
);

-- ----------------------------------------------------------------------------
-- 3. SIGA_ROTA_OBSERVACAO — Observações georreferenciadas em campo
--    Regra:
--      • Toda observação pertence obrigatoriamente a uma rota (ID_ROTA NOT NULL).
--      • GEOMETRY é POINT (SDO_GTYPE 2001) com SDO_SRID = NULL.
--      • VERSAO controla concorrência otimista nas edições offline.
-- ----------------------------------------------------------------------------
CREATE TABLE SIGA_ROTA_OBSERVACAO (
  ID_OBSERVACAO     NUMBER(12)                   NOT NULL,
  ID_CLIENTE        VARCHAR2(36)                 NOT NULL,
  ID_ROTA           NUMBER(12)                   NOT NULL,
  GEOMETRY          MDSYS.SDO_GEOMETRY           NOT NULL,
  DESCRICAO         VARCHAR2(1000)               NOT NULL,
  TIPO_OBSERVACAO   VARCHAR2(40)                 NOT NULL,
  DATA_CRIACAO      TIMESTAMP(6) WITH TIME ZONE  DEFAULT SYSTIMESTAMP NOT NULL,
  DATA_ATUALIZACAO  TIMESTAMP(6) WITH TIME ZONE  DEFAULT SYSTIMESTAMP NOT NULL,
  VERSAO            NUMBER(10)     DEFAULT 1     NOT NULL,
  ID_USUARIO        VARCHAR2(80)                 NOT NULL,
  STATUS            VARCHAR2(20)   DEFAULT 'ABERTA' NOT NULL,

  CONSTRAINT PK_SIGA_ROTA_OBS PRIMARY KEY (ID_OBSERVACAO),
  CONSTRAINT UQ_SIGA_ROTA_OBS_ID_CLIENTE UNIQUE (ID_CLIENTE),
  CONSTRAINT FK_SIGA_ROTA_OBS_ROTA FOREIGN KEY (ID_ROTA)
    REFERENCES SIGA_ROTA (ID_ROTA),
  CONSTRAINT CK_SIGA_ROTA_OBS_STATUS CHECK (STATUS IN ('ABERTA', 'CONCLUIDA', 'REABERTA'))
);

-- ----------------------------------------------------------------------------
-- 4. SIGA_ROTA_EVENTO — Histórico/auditoria das interações com observações
--    Regra:
--      • Registra CRIACAO, EDICAO, CONCLUSAO, REABERTURA e ALTERACAO_STATUS.
--      • Também idempotente via ID_CLIENTE (UUID gerado no dispositivo).
-- ----------------------------------------------------------------------------
CREATE TABLE SIGA_ROTA_EVENTO (
  ID_EVENTO         NUMBER(12)                   NOT NULL,
  ID_CLIENTE        VARCHAR2(36)                 NOT NULL,
  ID_OBSERVACAO     NUMBER(12)                   NOT NULL,
  TIPO_EVENTO       VARCHAR2(30)                 NOT NULL,
  DADOS_EVENTO      CLOB                             NULL,
  DATA_EVENTO       TIMESTAMP(6) WITH TIME ZONE  DEFAULT SYSTIMESTAMP NOT NULL,
  ID_USUARIO        VARCHAR2(80)                 NOT NULL,

  CONSTRAINT PK_SIGA_ROTA_EVENTO PRIMARY KEY (ID_EVENTO),
  CONSTRAINT UQ_SIGA_ROTA_EVT_ID_CLIENTE UNIQUE (ID_CLIENTE),
  CONSTRAINT FK_SIGA_ROTA_EVT_OBS FOREIGN KEY (ID_OBSERVACAO)
    REFERENCES SIGA_ROTA_OBSERVACAO (ID_OBSERVACAO),
  CONSTRAINT CK_SIGA_ROTA_EVT_TIPO CHECK (
    TIPO_EVENTO IN ('CRIACAO', 'EDICAO', 'CONCLUSAO', 'REABERTURA', 'ALTERACAO_STATUS')
  )
);
