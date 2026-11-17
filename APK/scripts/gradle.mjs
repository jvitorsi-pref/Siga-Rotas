#!/usr/bin/env node
/**
 * Executa o Gradle do projeto Android em qualquer sistema.
 * -------------------------------------------------------
 *
 * Os scripts antigos chamavam `gradlew.bat` diretamente, o que só funciona no
 * Windows. Aqui o wrapper escolhe `gradlew.bat` ou `gradlew` conforme a
 * plataforma e repassa os argumentos. Não baixa SDK, não assina e não altera
 * nenhum arquivo do build.
 *
 * Uso:
 *   node scripts/gradle.mjs assembleDebug
 *   node scripts/gradle.mjs assembleRelease -PalgumaCoisa=1
 *
 * `SIGA_GRADLE_DRY=1` apenas imprime o comando — útil para conferir o wrapper
 * sem JDK/SDK instalados.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raizApk = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const diretorioAndroid = path.join(raizApk, 'android');

/** Nome do script do Gradle para a plataforma pedida. */
export function scriptDoGradle(plataforma = process.platform) {
  return plataforma === 'win32' ? 'gradlew.bat' : 'gradlew';
}

/** Comando completo que será executado (sem shell). */
export function comandoDoGradle(argumentos, plataforma = process.platform) {
  const script = scriptDoGradle(plataforma);
  const executavel = plataforma === 'win32' ? script : './' + script;
  return { cwd: diretorioAndroid, executavel, argumentos: [...argumentos] };
}

export function executar(argumentos = process.argv.slice(2), ambiente = process.env) {
  if (!argumentos.length) {
    console.error('Informe uma tarefa do Gradle, por exemplo: node scripts/gradle.mjs assembleDebug');
    return 2;
  }
  const comando = comandoDoGradle(argumentos);
  if (ambiente.SIGA_GRADLE_DRY === '1') {
    console.log(JSON.stringify(comando));
    return 0;
  }
  const resultado = spawnSync(comando.executavel, comando.argumentos, {
    cwd: comando.cwd,
    stdio: 'inherit',
    // No Windows, .bat precisa ser chamado pelo shell; nos demais, execução direta.
    shell: process.platform === 'win32',
  });
  if (resultado.error) {
    console.error(
      'Não foi possível executar o Gradle (' + comando.executavel + '): ' + resultado.error.message +
      '\nConfira JDK 17 e ANDROID_HOME. O EAS (npm run eas:apk) não exige SDK local.'
    );
    return 1;
  }
  return resultado.status == null ? 1 : resultado.status;
}

const executadoDiretamente = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (executadoDiretamente) process.exit(executar());
