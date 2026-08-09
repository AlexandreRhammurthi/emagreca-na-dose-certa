import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, '..');
const publicDirectory = resolve(projectRoot, 'public');
const publicFiles = Object.freeze([
  'index.html',
  'styles.css',
  'app.js',
  'js/auth.js',
  'js/diary.js',
  'js/weight.js',
  'js/supabase-config.js',
  'assets/icons/application-vial.png',
  'assets/icons/weight-syringe.png',
  'assets/icons/weight-scale.png'
]);
const forbiddenPatterns = Object.freeze([
  { label: 'Secret Key', pattern: /sb_secret_[A-Za-z0-9._-]+/u },
  { label: 'service_role', pattern: /service_role/iu },
  { label: 'SUPABASE_SECRET', pattern: /SUPABASE_SECRET/iu },
  { label: 'SUPABASE_SERVICE', pattern: /SUPABASE_SERVICE/iu },
  { label: 'JWT_SECRET', pattern: /JWT_SECRET/iu }
]);

function validatePublicDirectory() {
  const pathFromRoot = relative(projectRoot, publicDirectory);
  const isDirectPublicChild = pathFromRoot === 'public';
  const isInsideRoot = pathFromRoot !== '' && !pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..';
  if (!isDirectPublicChild || !isInsideRoot || basename(publicDirectory) !== 'public' || publicDirectory === projectRoot) {
    throw new Error('BUILD ABORTADO: caminho de public/ não passou na validação de segurança.');
  }
}

async function sha256(filePath) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

async function securityCheck() {
  const findings = new Set();
  for (const file of publicFiles) {
    const content = await readFile(resolve(projectRoot, file), 'utf8');
    for (const forbidden of forbiddenPatterns) {
      if (forbidden.pattern.test(content)) findings.add(forbidden.label);
    }
  }
  if (findings.size) {
    throw new Error(`BUILD ABORTADO: padrão privilegiado encontrado (${[...findings].join(', ')}).`);
  }
}

async function cleanPublicDirectory() {
  await mkdir(publicDirectory, { recursive: true });
  await cleanDirectoryContents(publicDirectory);
}

async function cleanDirectoryContents(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const target = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await cleanDirectoryContents(target);
      continue;
    }
    await rm(target, { force: true, maxRetries: 3, retryDelay: 100 });
  }
}

async function build() {
  console.log('BUILD — Emagreça na Dose Certa\n');
  validatePublicDirectory();
  await securityCheck();

  await cleanPublicDirectory();
  console.log('Limpando public/... OK\n');
  console.log('Copiando:');

  for (const file of publicFiles) {
    const source = resolve(projectRoot, file);
    const destination = resolve(publicDirectory, file);
    await mkdir(dirname(destination), { recursive: true });
    await cp(source, destination);
    console.log(`${file.padEnd(31, '.')} OK`);
  }

  let synchronized = 0;
  for (const file of publicFiles) {
    const sourceHash = await sha256(resolve(projectRoot, file));
    const destinationHash = await sha256(resolve(publicDirectory, file));
    if (sourceHash !== destinationHash) throw new Error(`BUILD FAIL: integridade inválida em ${file}.`);
    synchronized += 1;
  }

  console.log(`\nVerificação de integridade:\n${synchronized}/${publicFiles.length} arquivos sincronizados.`);
  console.log('\nSegurança:\nSecret Key encontrada: NÃO\nservice_role encontrada: NÃO');
  console.log('\nBUILD: SUCCESS');
}

build().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
