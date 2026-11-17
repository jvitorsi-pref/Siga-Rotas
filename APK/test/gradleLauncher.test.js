import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { scriptDoGradle, comandoDoGradle, executar } from '../scripts/gradle.mjs';

const apk = (arquivo) => new URL('../' + arquivo, import.meta.url);

test('Gradle: escolhe o script certo por sistema, sem shell fora do Windows', () => {
  assert.equal(scriptDoGradle('win32'), 'gradlew.bat');
  assert.equal(scriptDoGradle('linux'), 'gradlew');
  assert.equal(scriptDoGradle('darwin'), 'gradlew');
  const windows = comandoDoGradle(['assembleRelease', '-Pfoo=1'], 'win32');
  assert.deepEqual(windows.argumentos, ['assembleRelease', '-Pfoo=1']);
  assert.equal(windows.executavel, 'gradlew.bat');
  assert.match(windows.cwd, /android$/);
  const linux = comandoDoGradle(['assembleDebug'], 'linux');
  assert.equal(linux.executavel, './gradlew');
  assert.deepEqual(linux.argumentos, ['assembleDebug']);
});

test('Gradle: modo de conferência imprime o comando e tarefa ausente falha com aviso', () => {
  const saida = [];
  const original = console.log;
  console.log = (linha) => saida.push(linha);
  const codigo = executar(['assembleRelease'], { SIGA_GRADLE_DRY: '1' });
  console.log = original;
  assert.equal(codigo, 0);
  const comando = JSON.parse(saida[0]);
  assert.equal(comando.executavel, process.platform === 'win32' ? 'gradlew.bat' : './gradlew');
  assert.deepEqual(comando.argumentos, ['assembleRelease']);
  assert.equal(executar([], {}), 2);
});

test('scripts npm do APK não dependem de .bat e o wrapper é executável no Unix', () => {
  const pkg = JSON.parse(readFileSync(apk('package.json'), 'utf8'));
  assert.equal(pkg.scripts['apk:debug'], 'node scripts/gradle.mjs assembleDebug');
  assert.equal(pkg.scripts['apk:release'], 'node scripts/gradle.mjs assembleRelease');
  assert.doesNotMatch(JSON.stringify(pkg.scripts), /gradlew\.bat/);
  if (process.platform !== 'win32') {
    const modo = statSync(apk('android/gradlew')).mode;
    assert.ok(modo & 0o100, 'gradlew precisa ser executável em Linux/macOS');
  }
});

test('release usa keystore próprio quando configurado, sem versionar segredos', () => {
  const gradle = readFileSync(apk('android/app/build.gradle'), 'utf8');
  assert.match(gradle, /def keystorePropsFile = rootProject\.file\('keystore\.properties'\)/);
  assert.match(gradle, /signingConfigs \{[\s\S]*release \{[\s\S]*storeFile file\(keystoreProps\['storeFile'\]\)/);
  assert.match(gradle, /if \(keystorePropsFile\.exists\(\) && keystoreProps\['storeFile'\]\) \{\s*signingConfig signingConfigs\.release\s*\} else \{\s*signingConfig signingConfigs\.debug/);
  const ignore = readFileSync(apk('.gitignore'), 'utf8');
  assert.match(ignore, /android\/keystore\.properties/);
  assert.match(ignore, /\*\.keystore/);
});
