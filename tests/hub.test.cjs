'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  resolveHubRoot,
  validateSlug,
  loadHubData,
  renderPainel,
  writePainel,
  buscarTemas,
  createTema,
  createNovaVersao,
} = require('../cli/lib/hub.cjs');
const { parseFrontmatter, serializeFrontmatter } = require('../cli/lib/frontmatter.cjs');

function makeTempHub() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'po-hub-'));
  fs.mkdirSync(path.join(dir, 'projetos'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'temas'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'templates'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'projetos', 'HortaComunitaria.md'), '# HortaComunitaria\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'projetos', 'BibliotecaBairro.md'), '# BibliotecaBairro\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'projetos', 'projeto-organizado.md'), '# projeto-organizado\n', 'utf8');
  return dir;
}

test('resolveHubRoot respeita precedencia PROJETO_ORGANIZADO_HOME > ~/.projeto-organizado.json > cwd', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'po-home-'));
  const envHub = path.join(tmpHome, 'from-env');
  const ptrHub = path.join(tmpHome, 'from-pointer');
  const cwdHub = path.join(tmpHome, 'from-cwd');
  fs.mkdirSync(envHub, { recursive: true });
  fs.mkdirSync(ptrHub, { recursive: true });
  fs.mkdirSync(cwdHub, { recursive: true });
  fs.writeFileSync(
    path.join(tmpHome, '.projeto-organizado.json'),
    JSON.stringify({ hubPath: ptrHub }, null, 2),
    'utf8'
  );

  assert.equal(
    resolveHubRoot({ env: { PROJETO_ORGANIZADO_HOME: envHub }, homeDir: tmpHome, cwd: cwdHub }),
    path.resolve(envHub)
  );
  assert.equal(
    resolveHubRoot({ env: {}, homeDir: tmpHome, cwd: cwdHub }),
    path.resolve(ptrHub)
  );

  const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'po-empty-home-'));
  assert.equal(
    resolveHubRoot({ env: {}, homeDir: emptyHome, cwd: cwdHub }),
    path.resolve(cwdHub)
  );

  fs.rmSync(tmpHome, { recursive: true, force: true });
  fs.rmSync(emptyHome, { recursive: true, force: true });
});

test('validateSlug e createTema rejeitam slugs invalidos, path traversal e duplicados', () => {
  const hub = makeTempHub();
  try {
    for (const bad of ['../fora', 'Com Espaço', 'Maiuscula', 'a/b', 'slug_sublinhado', '-inicio', 'fim-', '']) {
      assert.throws(() => validateSlug(bad), /slug/i, `esperava rejeitar "${bad}"`);
      assert.throws(
        () => createTema(hub, { slug: bad, titulo: 'Teste', projetos: ['HortaComunitaria'] }),
        /slug/i
      );
    }

    assert.equal(fs.existsSync(path.join(hub, 'fora')), false);

    const created = createTema(hub, {
      slug: 'meu-tema',
      titulo: 'Meu Tema',
      projetos: ['HortaComunitaria'],
    });
    assert.ok(fs.existsSync(created.temaPath));
    assert.ok(fs.existsSync(created.versaoPath));
    assert.ok(fs.existsSync(path.join(hub, 'PAINEL.md')));

    const parsed = parseFrontmatter(fs.readFileSync(created.temaPath, 'utf8'));
    assert.equal(parsed.data.titulo, 'Meu Tema');
    assert.deepEqual(parsed.data.projetos, ['[[HortaComunitaria]]']);
    assert.equal(parsed.data.estado, 'ideia');
    assert.equal(parsed.data.versao, 'v1');
    assert.deepEqual(parsed.data.relacionados, []);

    assert.throws(
      () => createTema(hub, { slug: 'meu-tema', titulo: 'Outro', projetos: ['HortaComunitaria'] }),
      /já existe|duplicado/i
    );
    const afterDup = parseFrontmatter(fs.readFileSync(created.temaPath, 'utf8'));
    assert.equal(afterDup.data.titulo, 'Meu Tema');
  } finally {
    fs.rmSync(hub, { recursive: true, force: true });
  }
});

test('renderPainel e writePainel sao deterministicos, ordenam estados, agrupam por projeto e nao vazam caminhos locais', () => {
  const hub = makeTempHub();
  try {
    createTema(hub, { slug: 't-pronto', titulo: 'Tema Pronto', projetos: ['HortaComunitaria'], estado: 'pronto' });
    createTema(hub, { slug: 't-ideia', titulo: 'Tema Ideia', projetos: ['BibliotecaBairro', 'HortaComunitaria'], estado: 'ideia' });
    createTema(hub, { slug: 't-disc', titulo: 'Tema Discutindo', projetos: ['HortaComunitaria'], estado: 'discutindo' });
    createTema(hub, { slug: 't-pr', titulo: 'Tema Em PR', projetos: ['projeto-organizado'], estado: 'em-pr' });

    const r1 = writePainel(hub);
    const bytes1 = fs.readFileSync(r1.painelPath, 'utf8');
    const r2 = writePainel(hub);
    const bytes2 = fs.readFileSync(r2.painelPath, 'utf8');

    assert.equal(bytes1, bytes2, 'PAINEL.md precisa ser byte-a-byte deterministico');
    assert.equal(r1.temaCount, 4);
    assert.deepEqual(r1.warnings, []);

    const idxDisc = bytes1.indexOf('## Em Discussão (`discutindo`)');
    const idxPr = bytes1.indexOf('## Em Pull Request (`em-pr`)');
    const idxIdeia = bytes1.indexOf('## Ideias (`ideia`)');
    const idxPronto = bytes1.indexOf('## Prontos (`pronto`)');
    assert.ok(idxDisc !== -1 && idxPr !== -1 && idxIdeia !== -1 && idxPronto !== -1);
    assert.ok(idxDisc < idxPr && idxPr < idxIdeia && idxIdeia < idxPronto);

    assert.match(bytes1, /\[\[t-disc\]\]/);
    assert.match(bytes1, /\[\[HortaComunitaria\]\]/);
    assert.match(bytes1, /\[\[BibliotecaBairro\]\]/);
    assert.match(bytes1, /\[\[WORKTREES\.local\]\]/);
    assert.doesNotMatch(bytes1, /[A-Za-z]:\\|\/Users\/|\/home\/|\/tmp\//);
  } finally {
    fs.rmSync(hub, { recursive: true, force: true });
  }
});

test('buscarTemas normaliza acentos e ranqueia slug/titulo acima de match apenas no corpo', () => {
  const hub = makeTempHub();
  try {
    createTema(hub, {
      slug: 'empresa-ai-native-reunioes-crm',
      titulo: 'Reuniões e CRM Horta Comunitária',
      projetos: ['HortaComunitaria'],
      estado: 'ideia',
      v1Conteudo: '# Reuniões\n\nTranscrição automática e CRM.',
    });
    createTema(hub, {
      slug: 'outro-tema',
      titulo: 'Tema Genérico',
      projetos: ['HortaComunitaria'],
      estado: 'ideia',
      v1Conteudo: '# Outro\n\nApenas menciona reunioes de passagem no texto.',
    });

    const results = buscarTemas(hub, 'reunioes');
    assert.equal(results.length, 2);
    assert.equal(results[0].slug, 'empresa-ai-native-reunioes-crm');
    assert.ok(results[0].score > results[1].score);

    const resultsAcento = buscarTemas(hub, 'Horta Comunitária');
    assert.ok(resultsAcento.some((r) => r.slug === 'empresa-ai-native-reunioes-crm'));
  } finally {
    fs.rmSync(hub, { recursive: true, force: true });
  }
});

test('createNovaVersao incrementa v1 -> v2, cria versoes/v2.md e muda estado pronto -> discutindo', () => {
  const hub = makeTempHub();
  try {
    const created = createTema(hub, {
      slug: 'fluxo-cobranca',
      titulo: 'Fluxo de Cobrança',
      projetos: ['HortaComunitaria'],
      estado: 'pronto',
    });

    const raw = fs.readFileSync(created.temaPath, 'utf8');
    const parsed = parseFrontmatter(raw);
    parsed.data.pr_ativo = 'https://github.com/exemplo/horta-comunitaria/pull/1';
    parsed.data.branch_ativa = 'feat/cobranca-v1';
    fs.writeFileSync(created.temaPath, serializeFrontmatter(parsed.data, parsed.body), 'utf8');

    const v2 = createNovaVersao(hub, 'fluxo-cobranca', { resumo: 'Evolução Pix automático' });
    assert.equal(v2.versao, 'v2');
    assert.ok(fs.existsSync(v2.versaoPath));
    assert.match(fs.readFileSync(v2.versaoPath, 'utf8'), /Evolução Pix automático/);

    const updated = parseFrontmatter(fs.readFileSync(created.temaPath, 'utf8'));
    assert.equal(updated.data.versao, 'v2');
    assert.equal(updated.data.estado, 'discutindo');
    assert.equal(updated.data.pr_ativo, undefined);
    assert.equal(updated.data.branch_ativa, undefined);
    assert.match(updated.body, /v2/);

    const painel = fs.readFileSync(path.join(hub, 'PAINEL.md'), 'utf8');
    assert.match(painel, /\[\[fluxo-cobranca\]\].*v2/);
  } finally {
    fs.rmSync(hub, { recursive: true, force: true });
  }
});

test('loadHubData reporta aviso quando relacionado aponta para slug inexistente', () => {
  const hub = makeTempHub();
  try {
    createTema(hub, {
      slug: 'tema-com-link-quebrado',
      titulo: 'Link Quebrado',
      projetos: ['HortaComunitaria'],
      relacionados: ['nao-existe'],
    });
    const data = loadHubData(hub);
    assert.ok(data.warnings.some((w) => w.includes('nao-existe')));
  } finally {
    fs.rmSync(hub, { recursive: true, force: true });
  }
});

test('buscarTemas tambem indexa o campo relacionados', () => {
  const hub = makeTempHub();
  try {
    createTema(hub, {
      slug: 'tema-origem',
      titulo: 'Tema Origem',
      projetos: ['HortaComunitaria'],
    });
    createTema(hub, {
      slug: 'tema-dependente',
      titulo: 'Tema Dependente',
      projetos: ['BibliotecaBairro'],
      relacionados: ['tema-origem'],
    });
    const res = buscarTemas(hub, 'tema-origem');
    const dep = res.find((r) => r.slug === 'tema-dependente');
    assert.ok(dep, 'esperava encontrar tema-dependente via relacionados');
    assert.ok(dep.matchedIn.includes('relacionados'));
  } finally {
    fs.rmSync(hub, { recursive: true, force: true });
  }
});

test('createNovaVersao insere linha dentro de Historico de PRs mesmo com secoes abaixo', () => {
  const hub = makeTempHub();
  try {
    const created = createTema(hub, {
      slug: 'tema-com-notas',
      titulo: 'Tema com Notas',
      projetos: ['HortaComunitaria'],
      estado: 'pronto',
    });
    const extra = fs.readFileSync(created.temaPath, 'utf8') + '\n## Notas Extras\n\nTexto final.\n';
    fs.writeFileSync(created.temaPath, extra, 'utf8');

    createNovaVersao(hub, 'tema-com-notas', { resumo: 'Segunda fase' });
    const updated = fs.readFileSync(created.temaPath, 'utf8');
    const idxV2Row = updated.indexOf('| v2 |');
    const idxNotas = updated.indexOf('## Notas Extras');
    assert.ok(idxV2Row !== -1 && idxNotas !== -1);
    assert.ok(idxV2Row < idxNotas, 'linha v2 deve ficar dentro da tabela antes de ## Notas Extras');
  } finally {
    fs.rmSync(hub, { recursive: true, force: true });
  }
});
