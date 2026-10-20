import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (file) => readFileSync(new URL(`../../../${file}`, import.meta.url), 'utf8');
const index = read('index.html');
const robots = read('robots.txt');
const sitemap = read('sitemap.xml');
const verification = read('google8a94517067eeb00c.html');
const build = read('scripts/build.mjs');

test('home possui metadados rastreáveis e estruturados coerentes com o conteúdo', () => {
  assert.match(index, /<link rel="canonical" href="https:\/\/emagrecanadosecerta\.com\.br\/"/);
  assert.match(index, /<meta name="robots" content="index,follow,max-image-preview:large"/);
  assert.match(index, /<meta property="og:title"/);
  assert.match(index, /application\/ld\+json/);
  assert.match(index, /"@type": "WebApplication"/);
  assert.match(index, /Não realiza prescrição nem substitui orientação profissional/);
});

test('robots e sitemap expõem apenas as páginas públicas pretendidas', () => {
  assert.match(robots, /Sitemap: https:\/\/emagrecanadosecerta\.com\.br\/sitemap\.xml/);
  assert.match(sitemap, /https:\/\/emagrecanadosecerta\.com\.br\//);
  assert.doesNotMatch(sitemap, /admin\.html|project-delivery-pipeline\.html/);
  assert.match(build, /'robots\.txt'/);
  assert.match(build, /'sitemap\.xml'/);
  assert.match(build, /'site\.webmanifest'/);
  assert.match(build, /'google8a94517067eeb00c\.html'/);
  assert.equal(verification.trim(), 'google-site-verification: google8a94517067eeb00c.html');
});
