const test = require('node:test');
const assert = require('node:assert/strict');
const {
  VALID_ESTADOS,
  REQUIRED_FIELDS,
  OPTIONAL_FIELDS,
  parseFrontmatter,
  serializeFrontmatter,
  validateTemaMeta,
} = require('../cli/lib/frontmatter.cjs');

test('parseFrontmatter lida com CRLF, acentos e listas inline/bloco', () => {
  const raw = [
    '---',
    'titulo: Reuniões e CRM Horta Comunitária',
    'projetos:',
    '  - "[[HortaComunitaria]]"',
    'estado: ideia',
    'versao: v1',
    'relacionados: []',
    '---',
    '',
    '# Corpo com acento',
  ].join('\r\n');
  const { data, body } = parseFrontmatter(raw);
  assert.equal(data.titulo, 'Reuniões e CRM Horta Comunitária');
  assert.deepEqual(data.projetos, ['[[HortaComunitaria]]']);
  assert.equal(data.estado, 'ideia');
  assert.equal(data.versao, 'v1');
  assert.deepEqual(data.relacionados, []);
  assert.equal(body.trim(), '# Corpo com acento');
});

test('serializeFrontmatter escreve apenas 5 campos fixos e omite opcionais vazios', () => {
  assert.deepEqual(REQUIRED_FIELDS, ['titulo', 'projetos', 'estado', 'versao', 'relacionados']);
  assert.deepEqual(OPTIONAL_FIELDS, ['pr_ativo', 'branch_ativa', 'fontes_anteriores', 'kanban_ref']);
  const out = serializeFrontmatter({
    titulo: 'Teste',
    projetos: ['[[HortaComunitaria]]'],
    estado: 'discutindo',
    versao: 'v1',
    relacionados: [],
    pr_ativo: '',
    branch_ativa: '',
    fontes_anteriores: [],
    kanban_ref: '',
  }, '\n# Texto\n');
  assert.doesNotMatch(out, /pr_ativo|branch_ativa|fontes_anteriores|kanban_ref/);
  const reparsed = parseFrontmatter(out);
  assert.equal(reparsed.data.titulo, 'Teste');
  assert.deepEqual(reparsed.data.projetos, ['[[HortaComunitaria]]']);
});

test('serializeFrontmatter inclui campos opcionais quando preenchidos', () => {
  const out = serializeFrontmatter({
    titulo: 'Com PR',
    projetos: ['[[HortaComunitaria]]'],
    estado: 'em-pr',
    versao: 'v2',
    relacionados: ['[[outro-tema]]'],
    pr_ativo: 'https://github.com/exemplo/horta-comunitaria/pull/99',
    branch_ativa: 'agent/exemplo/TICKET-99',
    fontes_anteriores: ['docs/antigo.md'],
    kanban_ref: 'KB-12',
  }, '\nCorpo\n');
  const { data } = parseFrontmatter(out);
  assert.equal(data.pr_ativo, 'https://github.com/exemplo/horta-comunitaria/pull/99');
  assert.equal(data.branch_ativa, 'agent/exemplo/TICKET-99');
  assert.deepEqual(data.fontes_anteriores, ['docs/antigo.md']);
  assert.equal(data.kanban_ref, 'KB-12');
});

test('validateTemaMeta valida os 4 estados e rejeita estado/versao invalidos', () => {
  assert.deepEqual(VALID_ESTADOS, ['ideia', 'discutindo', 'em-pr', 'pronto']);
  const ok = validateTemaMeta({
    titulo: 'X', projetos: ['[[HortaComunitaria]]'], estado: 'ideia', versao: 'v1', relacionados: [],
  });
  assert.equal(ok.valid, true);
  const bad = validateTemaMeta({
    titulo: '', projetos: [], estado: 'capturada', versao: '1', relacionados: [],
  });
  assert.equal(bad.valid, false);
  assert.ok(bad.errors.length >= 3);
});

test('parseFrontmatter suporta listas YAML sem indentacao (coluna 0)', () => {
  const raw = [
    '---',
    'titulo: Lista Coluna Zero',
    'projetos:',
    '- "[[HortaComunitaria]]"',
    '- "[[BibliotecaBairro]]"',
    'estado: ideia',
    'versao: v1',
    'relacionados: []',
    '---',
    '',
    '# Corpo',
  ].join('\n');
  const { data } = parseFrontmatter(raw);
  assert.deepEqual(data.projetos, ['[[HortaComunitaria]]', '[[BibliotecaBairro]]']);
});
