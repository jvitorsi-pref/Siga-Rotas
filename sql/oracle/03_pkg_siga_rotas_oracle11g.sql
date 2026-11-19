-- ============================================================================
-- SIGA-Rotas — Package Oracle 11g (PKG_SIGA_ROTAS)
-- ----------------------------------------------------------------------------
-- Contrato de referência das procedures que a sua Classe DAL chamará.
-- Características Oracle 11g + SIGA (SRID = NULL):
--   • Recebe geometria como WKT (CLOB):
--       - Rotas:       LINESTRING(...) ou MULTILINESTRING((...), (...))
--       - Observações: POINT(lon lat)
--   • Converte via SDO_UTIL.FROM_WKTGEOMETRY (que produz SDO_SRID = NULL).
--   • Mantém SDO_SRID = NULL (ou converte temporariamente de 4326 → 31983/32723
--     e limpa SDO_SRID := NULL, caso o seu banco use UTM 23S sem SRID).
--   • Garante idempotência por ID_CLIENTE e previne observações órfãs.
-- ============================================================================

CREATE OR REPLACE PACKAGE PKG_SIGA_ROTAS AS

  -- Persiste rota CALCULADA ou GPS de forma idempotente por P_ID_CLIENTE.
  -- P_RESULTADO retorna: 'PERSISTIDO' | 'JA_EXISTENTE' | 'CONFLITO' | 'ROTA_ORIGEM_NAO_ENCONTRADA'
  PROCEDURE PR_SALVAR_ROTA(
    P_ID_CLIENTE             IN  VARCHAR2,
    P_TIPO_ROTA              IN  VARCHAR2,
    P_ID_ROTA_ORIGEM         IN  NUMBER,
    P_ID_ROTA_ORIGEM_CLIENTE IN  VARCHAR2,
    P_WKT_GEOMETRIA          IN  CLOB,
    P_DISTANCIA_METROS       IN  NUMBER,
    P_DURACAO_SEGUNDOS       IN  NUMBER,
    P_TITULO                 IN  VARCHAR2,
    P_MODO_CALCULO           IN  VARCHAR2,
    P_CIRCULAR               IN  NUMBER,
    P_PONTOS_JSON            IN  CLOB,
    P_LEGS_JSON              IN  CLOB,
    P_DATA_CRIACAO           IN  TIMESTAMP WITH TIME ZONE,
    P_DATA_INICIO            IN  TIMESTAMP WITH TIME ZONE,
    P_DATA_FIM               IN  TIMESTAMP WITH TIME ZONE,
    P_STATUS                 IN  VARCHAR2,
    P_VERSAO                 IN  NUMBER,
    P_ID_USUARIO             IN  VARCHAR2,
    O_ID_ROTA                OUT NUMBER,
    O_RESULTADO              OUT VARCHAR2,
    O_VERSAO_SERVIDOR        OUT NUMBER,
    O_MENSAGEM               OUT VARCHAR2
  );

  -- Cria observação georreferenciada vinculada obrigatoriamente a uma rota existente.
  -- Aceita P_ID_ROTA (ID Oracle) ou P_ID_ROTA_CLIENTE (UUID gerado em campo).
  PROCEDURE PR_SALVAR_OBSERVACAO(
    P_ID_CLIENTE       IN  VARCHAR2,
    P_ID_ROTA          IN  NUMBER,
    P_ID_ROTA_CLIENTE  IN  VARCHAR2,
    P_LONGITUDE        IN  NUMBER,
    P_LATITUDE         IN  NUMBER,
    P_DESCRICAO        IN  VARCHAR2,
    P_TIPO_OBSERVACAO  IN  VARCHAR2,
    P_DATA_CRIACAO     IN  TIMESTAMP WITH TIME ZONE,
    P_STATUS           IN  VARCHAR2,
    P_ID_USUARIO       IN  VARCHAR2,
    O_ID_OBSERVACAO    OUT NUMBER,
    O_ID_ROTA          OUT NUMBER,
    O_RESULTADO        OUT VARCHAR2,
    O_VERSAO_SERVIDOR  OUT NUMBER,
    O_MENSAGEM         OUT VARCHAR2
  );

  -- Atualiza descrição, tipo ou status da observação com controle de versão (conflito offline).
  PROCEDURE PR_ATUALIZAR_OBSERVACAO(
    P_ID_CLIENTE                 IN  VARCHAR2,
    P_DESCRICAO                  IN  VARCHAR2,
    P_TIPO_OBSERVACAO            IN  VARCHAR2,
    P_STATUS                     IN  VARCHAR2,
    P_VERSAO_ESPERADA            IN  NUMBER,
    P_DATA_ATUALIZACAO           IN  TIMESTAMP WITH TIME ZONE,
    P_ID_USUARIO                 IN  VARCHAR2,
    O_ID_OBSERVACAO              OUT NUMBER,
    O_RESULTADO                  OUT VARCHAR2,
    O_VERSAO_SERVIDOR            OUT NUMBER,
    O_DATA_ATUALIZACAO_SERVIDOR  OUT TIMESTAMP WITH TIME ZONE,
    O_MENSAGEM                   OUT VARCHAR2
  );

  -- Registra evento de histórico da observação de forma idempotente (SIGA_ROTA_EVENTO).
  PROCEDURE PR_REGISTRAR_EVENTO(
    P_ID_CLIENTE             IN  VARCHAR2,
    P_ID_OBSERVACAO          IN  NUMBER,
    P_ID_OBSERVACAO_CLIENTE  IN  VARCHAR2,
    P_TIPO_EVENTO            IN  VARCHAR2,
    P_DADOS_EVENTO           IN  CLOB,
    P_DATA_EVENTO            IN  TIMESTAMP WITH TIME ZONE,
    P_ID_USUARIO             IN  VARCHAR2,
    O_ID_EVENTO              OUT NUMBER,
    O_RESULTADO              OUT VARCHAR2,
    O_MENSAGEM               OUT VARCHAR2
  );

  -- Consulta rotas do usuário autenticado (CALCULADA e GPS).
  PROCEDURE PR_LISTAR_ROTAS(
    P_ID_USUARIO  IN  VARCHAR2,
    P_TIPO_ROTA   IN  VARCHAR2,
    P_LIMITE      IN  NUMBER,
    O_CURSOR      OUT SYS_REFCURSOR
  );

  -- Consulta observações de uma rota ou do usuário autenticado.
  PROCEDURE PR_LISTAR_OBSERVACOES(
    P_ID_USUARIO       IN  VARCHAR2,
    P_ID_ROTA          IN  NUMBER,
    P_ID_ROTA_CLIENTE  IN  VARCHAR2,
    O_CURSOR           OUT SYS_REFCURSOR
  );

END PKG_SIGA_ROTAS;
/

CREATE OR REPLACE PACKAGE BODY PKG_SIGA_ROTAS AS

  -- Converte WKT GeoJSON (lon/lat) para SDO_GEOMETRY com SDO_SRID = NULL.
  -- Caso suas tabelas SIGA usem UTM 23S com SDO_SRID = NULL (OPÇÃO B do script 02),
  -- descomente as duas linhas indicadas abaixo (em Oracle 11g, SDO_CS.TRANSFORM
  -- exige um SRID de origem válido antes de voltar para SDO_SRID := NULL).
  FUNCTION FN_WKT_PARA_SDO_NULL_SRID(P_WKT IN CLOB) RETURN MDSYS.SDO_GEOMETRY IS
    V_GEOM MDSYS.SDO_GEOMETRY;
  BEGIN
    V_GEOM := SDO_UTIL.FROM_WKTGEOMETRY(P_WKT);
    V_GEOM.SDO_SRID := NULL;

    -- OPÇÃO B (UTM 23S com SRID NULL): descomente se suas tabelas usarem metros UTM 23S
    -- V_GEOM.SDO_SRID := 4326;
    -- V_GEOM := SDO_CS.TRANSFORM(V_GEOM, 31983);
    -- V_GEOM.SDO_SRID := NULL;

    RETURN V_GEOM;
  END FN_WKT_PARA_SDO_NULL_SRID;

  FUNCTION FN_PONTO_PARA_SDO_NULL_SRID(P_LON IN NUMBER, P_LAT IN NUMBER) RETURN MDSYS.SDO_GEOMETRY IS
    V_GEOM MDSYS.SDO_GEOMETRY;
  BEGIN
    V_GEOM := MDSYS.SDO_GEOMETRY(
      2001,
      NULL,
      MDSYS.SDO_POINT_TYPE(P_LON, P_LAT, NULL),
      NULL,
      NULL
    );

    -- OPÇÃO B (UTM 23S com SRID NULL): descomente se suas tabelas usarem metros UTM 23S
    -- V_GEOM.SDO_SRID := 4326;
    -- V_GEOM := SDO_CS.TRANSFORM(V_GEOM, 31983);
    -- V_GEOM.SDO_SRID := NULL;

    RETURN V_GEOM;
  END FN_PONTO_PARA_SDO_NULL_SRID;

  PROCEDURE PR_SALVAR_ROTA(
    P_ID_CLIENTE             IN  VARCHAR2,
    P_TIPO_ROTA              IN  VARCHAR2,
    P_ID_ROTA_ORIGEM         IN  NUMBER,
    P_ID_ROTA_ORIGEM_CLIENTE IN  VARCHAR2,
    P_WKT_GEOMETRIA          IN  CLOB,
    P_DISTANCIA_METROS       IN  NUMBER,
    P_DURACAO_SEGUNDOS       IN  NUMBER,
    P_TITULO                 IN  VARCHAR2,
    P_MODO_CALCULO           IN  VARCHAR2,
    P_CIRCULAR               IN  NUMBER,
    P_PONTOS_JSON            IN  CLOB,
    P_LEGS_JSON              IN  CLOB,
    P_DATA_CRIACAO           IN  TIMESTAMP WITH TIME ZONE,
    P_DATA_INICIO            IN  TIMESTAMP WITH TIME ZONE,
    P_DATA_FIM               IN  TIMESTAMP WITH TIME ZONE,
    P_STATUS                 IN  VARCHAR2,
    P_VERSAO                 IN  NUMBER,
    P_ID_USUARIO             IN  VARCHAR2,
    O_ID_ROTA                OUT NUMBER,
    O_RESULTADO              OUT VARCHAR2,
    O_VERSAO_SERVIDOR        OUT NUMBER,
    O_MENSAGEM               OUT VARCHAR2
  ) IS
    V_EXISTE_ID      NUMBER;
    V_EXISTE_VERSAO  NUMBER;
    V_EXISTE_TIPO    VARCHAR2(20);
    V_EXISTE_USER    VARCHAR2(80);
    V_ORIGEM_ID      NUMBER := P_ID_ROTA_ORIGEM;
    V_GEOM           MDSYS.SDO_GEOMETRY;
    V_VERSAO_REQ     NUMBER := NVL(P_VERSAO, 1);
  BEGIN
    -- Resolve ID_ROTA_ORIGEM caso tenha sido enviado pelo ID_CLIENTE da rota planejada
    IF P_TIPO_ROTA = 'GPS' AND V_ORIGEM_ID IS NULL AND P_ID_ROTA_ORIGEM_CLIENTE IS NOT NULL THEN
      BEGIN
        SELECT ID_ROTA
          INTO V_ORIGEM_ID
          FROM SIGA_ROTA
         WHERE ID_CLIENTE = P_ID_ROTA_ORIGEM_CLIENTE;
      EXCEPTION
        WHEN NO_DATA_FOUND THEN
          O_ID_ROTA := NULL;
          O_RESULTADO := 'ROTA_ORIGEM_NAO_ENCONTRADA';
          O_VERSAO_SERVIDOR := 0;
          O_MENSAGEM := 'Rota calculada de origem ainda não foi sincronizada no Oracle.';
          RETURN;
      END;
    END IF;

    -- Verifica idempotência por ID_CLIENTE
    BEGIN
      SELECT ID_ROTA, VERSAO, TIPO_ROTA, ID_USUARIO
        INTO V_EXISTE_ID, V_EXISTE_VERSAO, V_EXISTE_TIPO, V_EXISTE_USER
        FROM SIGA_ROTA
       WHERE ID_CLIENTE = P_ID_CLIENTE
         FOR UPDATE;

      IF V_EXISTE_USER <> P_ID_USUARIO THEN
        O_ID_ROTA := NULL;
        O_RESULTADO := 'CONFLITO';
        O_VERSAO_SERVIDOR := V_EXISTE_VERSAO;
        O_MENSAGEM := 'ID_CLIENTE pertence a outro usuário.';
        RETURN;
      END IF;

      -- Nunca permitir transformar rota CALCULADA em GPS (nem sobrescrever CALCULADA por GPS)
      IF V_EXISTE_TIPO <> P_TIPO_ROTA THEN
        O_ID_ROTA := V_EXISTE_ID;
        O_RESULTADO := 'CONFLITO';
        O_VERSAO_SERVIDOR := V_EXISTE_VERSAO;
        O_MENSAGEM := 'Conflito de tipo de rota para o mesmo ID_CLIENTE.';
        RETURN;
      END IF;

      -- Se a versão recebida for maior que a do servidor (ex.: GPS finalizado após envio parcial), atualiza
      IF V_VERSAO_REQ > V_EXISTE_VERSAO THEN
        V_GEOM := FN_WKT_PARA_SDO_NULL_SRID(P_WKT_GEOMETRIA);
        UPDATE SIGA_ROTA
           SET GEOMETRY         = V_GEOM,
               DISTANCIA_METROS = NVL(P_DISTANCIA_METROS, DISTANCIA_METROS),
               DURACAO_SEGUNDOS = NVL(P_DURACAO_SEGUNDOS, DURACAO_SEGUNDOS),
               DATA_FIM         = NVL(P_DATA_FIM, DATA_FIM),
               DATA_ATUALIZACAO = SYSTIMESTAMP,
               STATUS           = NVL(P_STATUS, STATUS),
               VERSAO           = V_VERSAO_REQ
         WHERE ID_ROTA = V_EXISTE_ID;

        O_ID_ROTA := V_EXISTE_ID;
        O_RESULTADO := 'PERSISTIDO';
        O_VERSAO_SERVIDOR := V_VERSAO_REQ;
        O_MENSAGEM := 'Rota atualizada com sucesso.';
        RETURN;
      END IF;

      -- Reenvio idempotente (mesma versão ou retry após queda de rede)
      O_ID_ROTA := V_EXISTE_ID;
      O_RESULTADO := 'JA_EXISTENTE';
      O_VERSAO_SERVIDOR := V_EXISTE_VERSAO;
      O_MENSAGEM := 'Rota já persistida anteriormente para este ID_CLIENTE.';
      RETURN;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        NULL;
    END;

    V_GEOM := FN_WKT_PARA_SDO_NULL_SRID(P_WKT_GEOMETRIA);

    SELECT SEQ_SIGA_ROTA.NEXTVAL INTO O_ID_ROTA FROM DUAL;

    INSERT INTO SIGA_ROTA (
      ID_ROTA, ID_CLIENTE, ID_ROTA_ORIGEM, TIPO_ROTA, GEOMETRY,
      DISTANCIA_METROS, DURACAO_SEGUNDOS, TITULO, MODO_CALCULO, CIRCULAR,
      PONTOS_JSON, LEGS_JSON, DATA_CRIACAO, DATA_INICIO, DATA_FIM,
      DATA_ATUALIZACAO, VERSAO, STATUS, ID_USUARIO
    ) VALUES (
      O_ID_ROTA, P_ID_CLIENTE, CASE WHEN P_TIPO_ROTA = 'GPS' THEN V_ORIGEM_ID ELSE NULL END,
      P_TIPO_ROTA, V_GEOM, NVL(P_DISTANCIA_METROS, 0), NVL(P_DURACAO_SEGUNDOS, 0),
      P_TITULO, P_MODO_CALCULO, NVL(P_CIRCULAR, 1), P_PONTOS_JSON, P_LEGS_JSON,
      NVL(P_DATA_CRIACAO, SYSTIMESTAMP), P_DATA_INICIO, P_DATA_FIM,
      SYSTIMESTAMP, V_VERSAO_REQ, NVL(P_STATUS, 'SALVA'), P_ID_USUARIO
    );

    O_RESULTADO := 'PERSISTIDO';
    O_VERSAO_SERVIDOR := V_VERSAO_REQ;
    O_MENSAGEM := 'Rota persistida com sucesso.';
  EXCEPTION
    WHEN DUP_VAL_ON_INDEX THEN
      SELECT ID_ROTA, VERSAO
        INTO O_ID_ROTA, O_VERSAO_SERVIDOR
        FROM SIGA_ROTA
       WHERE ID_CLIENTE = P_ID_CLIENTE;
      O_RESULTADO := 'JA_EXISTENTE';
      O_MENSAGEM := 'Concorrência simultânea tratada por idempotência.';
  END PR_SALVAR_ROTA;

  PROCEDURE PR_SALVAR_OBSERVACAO(
    P_ID_CLIENTE       IN  VARCHAR2,
    P_ID_ROTA          IN  NUMBER,
    P_ID_ROTA_CLIENTE  IN  VARCHAR2,
    P_LONGITUDE        IN  NUMBER,
    P_LATITUDE         IN  NUMBER,
    P_DESCRICAO        IN  VARCHAR2,
    P_TIPO_OBSERVACAO  IN  VARCHAR2,
    P_DATA_CRIACAO     IN  TIMESTAMP WITH TIME ZONE,
    P_STATUS           IN  VARCHAR2,
    P_ID_USUARIO       IN  VARCHAR2,
    O_ID_OBSERVACAO    OUT NUMBER,
    O_ID_ROTA          OUT NUMBER,
    O_RESULTADO        OUT VARCHAR2,
    O_VERSAO_SERVIDOR  OUT NUMBER,
    O_MENSAGEM         OUT VARCHAR2
  ) IS
    V_ROTA_ID NUMBER := P_ID_ROTA;
    V_GEOM    MDSYS.SDO_GEOMETRY;
  BEGIN
    IF V_ROTA_ID IS NULL AND P_ID_ROTA_CLIENTE IS NOT NULL THEN
      BEGIN
        SELECT ID_ROTA
          INTO V_ROTA_ID
          FROM SIGA_ROTA
         WHERE ID_CLIENTE = P_ID_ROTA_CLIENTE;
      EXCEPTION
        WHEN NO_DATA_FOUND THEN
          V_ROTA_ID := NULL;
      END;
    END IF;

    IF V_ROTA_ID IS NULL THEN
      O_ID_OBSERVACAO := NULL;
      O_ID_ROTA := NULL;
      O_RESULTADO := 'ROTA_ORIGEM_NAO_ENCONTRADA';
      O_VERSAO_SERVIDOR := 0;
      O_MENSAGEM := 'Observação rejeitada: rota vinculada não encontrada no Oracle.';
      RETURN;
    END IF;

    BEGIN
      SELECT ID_OBSERVACAO, ID_ROTA, VERSAO
        INTO O_ID_OBSERVACAO, O_ID_ROTA, O_VERSAO_SERVIDOR
        FROM SIGA_ROTA_OBSERVACAO
       WHERE ID_CLIENTE = P_ID_CLIENTE;
      O_RESULTADO := 'JA_EXISTENTE';
      O_MENSAGEM := 'Observação já cadastrada anteriormente para este ID_CLIENTE.';
      RETURN;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        NULL;
    END;

    V_GEOM := FN_PONTO_PARA_SDO_NULL_SRID(P_LONGITUDE, P_LATITUDE);
    SELECT SEQ_SIGA_ROTA_OBSERVACAO.NEXTVAL INTO O_ID_OBSERVACAO FROM DUAL;

    INSERT INTO SIGA_ROTA_OBSERVACAO (
      ID_OBSERVACAO, ID_CLIENTE, ID_ROTA, GEOMETRY, DESCRICAO, TIPO_OBSERVACAO,
      DATA_CRIACAO, DATA_ATUALIZACAO, VERSAO, ID_USUARIO, STATUS
    ) VALUES (
      O_ID_OBSERVACAO, P_ID_CLIENTE, V_ROTA_ID, V_GEOM, P_DESCRICAO, P_TIPO_OBSERVACAO,
      NVL(P_DATA_CRIACAO, SYSTIMESTAMP), SYSTIMESTAMP, 1, P_ID_USUARIO, NVL(P_STATUS, 'ABERTA')
    );

    O_ID_ROTA := V_ROTA_ID;
    O_RESULTADO := 'PERSISTIDO';
    O_VERSAO_SERVIDOR := 1;
    O_MENSAGEM := 'Observação persistida com sucesso.';
  EXCEPTION
    WHEN DUP_VAL_ON_INDEX THEN
      SELECT ID_OBSERVACAO, ID_ROTA, VERSAO
        INTO O_ID_OBSERVACAO, O_ID_ROTA, O_VERSAO_SERVIDOR
        FROM SIGA_ROTA_OBSERVACAO
       WHERE ID_CLIENTE = P_ID_CLIENTE;
      O_RESULTADO := 'JA_EXISTENTE';
      O_MENSAGEM := 'Concorrência simultânea tratada por idempotência.';
  END PR_SALVAR_OBSERVACAO;

  PROCEDURE PR_ATUALIZAR_OBSERVACAO(
    P_ID_CLIENTE                 IN  VARCHAR2,
    P_DESCRICAO                  IN  VARCHAR2,
    P_TIPO_OBSERVACAO            IN  VARCHAR2,
    P_STATUS                     IN  VARCHAR2,
    P_VERSAO_ESPERADA            IN  NUMBER,
    P_DATA_ATUALIZACAO           IN  TIMESTAMP WITH TIME ZONE,
    P_ID_USUARIO                 IN  VARCHAR2,
    O_ID_OBSERVACAO              OUT NUMBER,
    O_RESULTADO                  OUT VARCHAR2,
    O_VERSAO_SERVIDOR            OUT NUMBER,
    O_DATA_ATUALIZACAO_SERVIDOR  OUT TIMESTAMP WITH TIME ZONE,
    O_MENSAGEM                   OUT VARCHAR2
  ) IS
    V_VERSAO_ATUAL NUMBER;
    V_DATA_ATUAL   TIMESTAMP WITH TIME ZONE;
    V_USER_ATUAL   VARCHAR2(80);
  BEGIN
    SELECT ID_OBSERVACAO, VERSAO, DATA_ATUALIZACAO, ID_USUARIO
      INTO O_ID_OBSERVACAO, V_VERSAO_ATUAL, V_DATA_ATUAL, V_USER_ATUAL
      FROM SIGA_ROTA_OBSERVACAO
     WHERE ID_CLIENTE = P_ID_CLIENTE
       FOR UPDATE;

    IF V_USER_ATUAL <> P_ID_USUARIO THEN
      O_RESULTADO := 'NAO_AUTORIZADO';
      O_VERSAO_SERVIDOR := V_VERSAO_ATUAL;
      O_DATA_ATUALIZACAO_SERVIDOR := V_DATA_ATUAL;
      O_MENSAGEM := 'Usuário sem permissão para alterar esta observação.';
      RETURN;
    END IF;

    -- Controle de conflito por versão / data
    IF P_VERSAO_ESPERADA IS NOT NULL AND P_VERSAO_ESPERADA < V_VERSAO_ATUAL THEN
      O_RESULTADO := 'CONFLITO';
      O_VERSAO_SERVIDOR := V_VERSAO_ATUAL;
      O_DATA_ATUALIZACAO_SERVIDOR := V_DATA_ATUAL;
      O_MENSAGEM := 'Existe versão mais recente no servidor.';
      RETURN;
    END IF;

    O_VERSAO_SERVIDOR := V_VERSAO_ATUAL + 1;
    O_DATA_ATUALIZACAO_SERVIDOR := NVL(P_DATA_ATUALIZACAO, SYSTIMESTAMP);

    UPDATE SIGA_ROTA_OBSERVACAO
       SET DESCRICAO        = NVL(P_DESCRICAO, DESCRICAO),
           TIPO_OBSERVACAO  = NVL(P_TIPO_OBSERVACAO, TIPO_OBSERVACAO),
           STATUS           = NVL(P_STATUS, STATUS),
           VERSAO           = O_VERSAO_SERVIDOR,
           DATA_ATUALIZACAO = O_DATA_ATUALIZACAO_SERVIDOR
     WHERE ID_OBSERVACAO = O_ID_OBSERVACAO;

    O_RESULTADO := 'PERSISTIDO';
    O_MENSAGEM := 'Observação atualizada com sucesso.';
  EXCEPTION
    WHEN NO_DATA_FOUND THEN
      O_ID_OBSERVACAO := NULL;
      O_RESULTADO := 'OBSERVACAO_NAO_ENCONTRADA';
      O_VERSAO_SERVIDOR := 0;
      O_DATA_ATUALIZACAO_SERVIDOR := NULL;
      O_MENSAGEM := 'Observação não encontrada para atualização.';
  END PR_ATUALIZAR_OBSERVACAO;

  PROCEDURE PR_REGISTRAR_EVENTO(
    P_ID_CLIENTE             IN  VARCHAR2,
    P_ID_OBSERVACAO          IN  NUMBER,
    P_ID_OBSERVACAO_CLIENTE  IN  VARCHAR2,
    P_TIPO_EVENTO            IN  VARCHAR2,
    P_DADOS_EVENTO           IN  CLOB,
    P_DATA_EVENTO            IN  TIMESTAMP WITH TIME ZONE,
    P_ID_USUARIO             IN  VARCHAR2,
    O_ID_EVENTO              OUT NUMBER,
    O_RESULTADO              OUT VARCHAR2,
    O_MENSAGEM               OUT VARCHAR2
  ) IS
    V_OBS_ID NUMBER := P_ID_OBSERVACAO;
  BEGIN
    IF V_OBS_ID IS NULL AND P_ID_OBSERVACAO_CLIENTE IS NOT NULL THEN
      BEGIN
        SELECT ID_OBSERVACAO
          INTO V_OBS_ID
          FROM SIGA_ROTA_OBSERVACAO
         WHERE ID_CLIENTE = P_ID_OBSERVACAO_CLIENTE;
      EXCEPTION
        WHEN NO_DATA_FOUND THEN
          V_OBS_ID := NULL;
      END;
    END IF;

    IF V_OBS_ID IS NULL THEN
      O_ID_EVENTO := NULL;
      O_RESULTADO := 'OBSERVACAO_NAO_ENCONTRADA';
      O_MENSAGEM := 'Evento rejeitado: observação vinculada não encontrada.';
      RETURN;
    END IF;

    BEGIN
      SELECT ID_EVENTO
        INTO O_ID_EVENTO
        FROM SIGA_ROTA_EVENTO
       WHERE ID_CLIENTE = P_ID_CLIENTE;
      O_RESULTADO := 'JA_EXISTENTE';
      O_MENSAGEM := 'Evento já registrado anteriormente para este ID_CLIENTE.';
      RETURN;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        NULL;
    END;

    SELECT SEQ_SIGA_ROTA_EVENTO.NEXTVAL INTO O_ID_EVENTO FROM DUAL;

    INSERT INTO SIGA_ROTA_EVENTO (
      ID_EVENTO, ID_CLIENTE, ID_OBSERVACAO, TIPO_EVENTO, DADOS_EVENTO, DATA_EVENTO, ID_USUARIO
    ) VALUES (
      O_ID_EVENTO, P_ID_CLIENTE, V_OBS_ID, P_TIPO_EVENTO, P_DADOS_EVENTO,
      NVL(P_DATA_EVENTO, SYSTIMESTAMP), P_ID_USUARIO
    );

    O_RESULTADO := 'PERSISTIDO';
    O_MENSAGEM := 'Evento registrado com sucesso.';
  EXCEPTION
    WHEN DUP_VAL_ON_INDEX THEN
      SELECT ID_EVENTO
        INTO O_ID_EVENTO
        FROM SIGA_ROTA_EVENTO
       WHERE ID_CLIENTE = P_ID_CLIENTE;
      O_RESULTADO := 'JA_EXISTENTE';
      O_MENSAGEM := 'Concorrência simultânea tratada por idempotência.';
  END PR_REGISTRAR_EVENTO;

  PROCEDURE PR_LISTAR_ROTAS(
    P_ID_USUARIO  IN  VARCHAR2,
    P_TIPO_ROTA   IN  VARCHAR2,
    P_LIMITE      IN  NUMBER,
    O_CURSOR      OUT SYS_REFCURSOR
  ) IS
    V_LIMITE NUMBER := LEAST(GREATEST(NVL(P_LIMITE, 50), 1), 200);
  BEGIN
    OPEN O_CURSOR FOR
      SELECT *
        FROM (
          SELECT r.ID_ROTA,
                 r.ID_CLIENTE,
                 r.ID_ROTA_ORIGEM,
                 orig.ID_CLIENTE AS ID_ROTA_ORIGEM_CLIENTE,
                 r.TIPO_ROTA,
                 SDO_UTIL.TO_WKTGEOMETRY(r.GEOMETRY) AS WKT_GEOMETRIA,
                 r.DISTANCIA_METROS,
                 r.DURACAO_SEGUNDOS,
                 r.TITULO,
                 r.MODO_CALCULO,
                 r.CIRCULAR,
                 r.PONTOS_JSON,
                 r.DATA_CRIACAO,
                 r.DATA_INICIO,
                 r.DATA_FIM,
                 r.DATA_ATUALIZACAO,
                 r.VERSAO,
                 r.STATUS,
                 r.ID_USUARIO
            FROM SIGA_ROTA r
            LEFT JOIN SIGA_ROTA orig ON orig.ID_ROTA = r.ID_ROTA_ORIGEM
           WHERE r.ID_USUARIO = P_ID_USUARIO
             AND (P_TIPO_ROTA IS NULL OR r.TIPO_ROTA = P_TIPO_ROTA)
           ORDER BY r.DATA_CRIACAO DESC
        )
       WHERE ROWNUM <= V_LIMITE;
  END PR_LISTAR_ROTAS;

  PROCEDURE PR_LISTAR_OBSERVACOES(
    P_ID_USUARIO       IN  VARCHAR2,
    P_ID_ROTA          IN  NUMBER,
    P_ID_ROTA_CLIENTE  IN  VARCHAR2,
    O_CURSOR           OUT SYS_REFCURSOR
  ) IS
  BEGIN
    OPEN O_CURSOR FOR
      SELECT o.ID_OBSERVACAO,
             o.ID_CLIENTE,
             o.ID_ROTA,
             r.ID_CLIENTE AS ID_ROTA_CLIENTE,
             o.GEOMETRY.SDO_POINT.X AS LONGITUDE,
             o.GEOMETRY.SDO_POINT.Y AS LATITUDE,
             o.DESCRICAO,
             o.TIPO_OBSERVACAO,
             o.DATA_CRIACAO,
             o.DATA_ATUALIZACAO,
             o.VERSAO,
             o.ID_USUARIO,
             o.STATUS
        FROM SIGA_ROTA_OBSERVACAO o
        INNER JOIN SIGA_ROTA r ON r.ID_ROTA = o.ID_ROTA
       WHERE o.ID_USUARIO = P_ID_USUARIO
         AND (P_ID_ROTA IS NULL OR o.ID_ROTA = P_ID_ROTA)
         AND (P_ID_ROTA_CLIENTE IS NULL OR r.ID_CLIENTE = P_ID_ROTA_CLIENTE)
       ORDER BY o.DATA_ATUALIZACAO DESC;
  END PR_LISTAR_OBSERVACOES;

END PKG_SIGA_ROTAS;
/
