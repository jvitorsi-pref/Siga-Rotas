-- ============================================================================
-- SIGA-Rotas — Metadados Espaciais e Índices Oracle 11g (SRID = NULL)
-- ----------------------------------------------------------------------------
-- IMPORTANTE SOBRE O PADRÃO DO BANCO SIGA (SRID = NULL):
--   As tabelas espaciais existentes do SIGA armazenam MDSYS.SDO_GEOMETRY com
--   SDO_SRID = NULL. O backend/payload de campo trafega GeoJSON em graus
--   geográficos [longitude, latitude] (WGS84 / EPSG:4326).
--
--   Escolha UMA das duas convenções abaixo conforme o padrão das suas demais
--   tabelas em USER_SDO_GEOM_METADATA:
--     • OPÇÃO A (padrão deste script): armazenar graus [lon, lat] com SRID = NULL
--       (bounds -180..180, -90..90, tolerância 0.000005 ~ 0,5 m).
--     • OPÇÃO B (se o seu SIGA armazena UTM 23S em metros com SRID = NULL):
--       ajuste os DIMINFO abaixo para X (320000..380000, tol 0.05) e
--       Y (7360000..7420000, tol 0.05) e descomente o bloco de conversão
--       SDO_CS.TRANSFORM na package PKG_SIGA_ROTAS (03_pkg_siga_rotas_oracle11g.sql).
-- ============================================================================

DELETE FROM USER_SDO_GEOM_METADATA
 WHERE TABLE_NAME IN ('SIGA_ROTA', 'SIGA_ROTA_OBSERVACAO')
   AND COLUMN_NAME = 'GEOMETRY';

-- OPÇÃO A: graus [lon, lat] com SDO_SRID = NULL
INSERT INTO USER_SDO_GEOM_METADATA (TABLE_NAME, COLUMN_NAME, DIMINFO, SRID)
VALUES (
  'SIGA_ROTA',
  'GEOMETRY',
  MDSYS.SDO_DIM_ARRAY(
    MDSYS.SDO_DIM_ELEMENT('X', -180, 180, 0.000005),
    MDSYS.SDO_DIM_ELEMENT('Y',  -90,  90, 0.000005)
  ),
  NULL
);

INSERT INTO USER_SDO_GEOM_METADATA (TABLE_NAME, COLUMN_NAME, DIMINFO, SRID)
VALUES (
  'SIGA_ROTA_OBSERVACAO',
  'GEOMETRY',
  MDSYS.SDO_DIM_ARRAY(
    MDSYS.SDO_DIM_ELEMENT('X', -180, 180, 0.000005),
    MDSYS.SDO_DIM_ELEMENT('Y',  -90,  90, 0.000005)
  ),
  NULL
);

COMMIT;

-- Índices espaciais Oracle 11g
CREATE INDEX IDX_SIGA_ROTA_GEOM
  ON SIGA_ROTA (GEOMETRY)
  INDEXTYPE IS MDSYS.SPATIAL_INDEX;

CREATE INDEX IDX_SIGA_ROTA_OBS_GEOM
  ON SIGA_ROTA_OBSERVACAO (GEOMETRY)
  INDEXTYPE IS MDSYS.SPATIAL_INDEX;

-- Índices operacionais para consultas rápidas por usuário, vínculo e ordem cronológica
CREATE INDEX IDX_SIGA_ROTA_USUARIO_DT
  ON SIGA_ROTA (ID_USUARIO, DATA_CRIACAO DESC);

CREATE INDEX IDX_SIGA_ROTA_ORIGEM
  ON SIGA_ROTA (ID_ROTA_ORIGEM);

CREATE INDEX IDX_SIGA_ROTA_OBS_ROTA
  ON SIGA_ROTA_OBSERVACAO (ID_ROTA, DATA_CRIACAO DESC);

CREATE INDEX IDX_SIGA_ROTA_OBS_USUARIO
  ON SIGA_ROTA_OBSERVACAO (ID_USUARIO, STATUS);

CREATE INDEX IDX_SIGA_ROTA_EVT_OBS_DT
  ON SIGA_ROTA_EVENTO (ID_OBSERVACAO, DATA_EVENTO ASC);
