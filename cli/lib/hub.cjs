'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  VALID_ESTADOS,
  parseFrontmatter,
  serializeFrontmatter,
  validateTemaMeta,
} = require('./frontmatter.cjs');

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const ESTADO_SECTIONS = [
  { key: 'discutindo', heading: 'Em Discussão (`discutindo`)' },
  { key: 'em-pr', heading: 'Em Pull Request (`em-pr`)' },
  { key: 'ideia', heading: 'Ideias (`ideia`)' },
  { key: 'pronto', heading: 'Prontos (`pronto`)' },
];

function asciiSort(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function normalizeForSearch(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function stripWikilink(value) {
  const s = String(value || '').trim();
  const match = s.match(/^\[\[([^\]|]+)(?:\|[^\]]+)?\]\]$/);
  return match ? match[1].trim() : s;
}

function toWikilink(value) {
  const clean = stripWikilink(value);
  return clean ? `[[${clean}]]` : '';
}

function todayIsoDate() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function resolveHubRoot({ env = process.env, homeDir = os.homedir(), cwd = process.cwd() } = {}) {
  if (env && env.PROJETO_ORGANIZADO_HOME && String(env.PROJETO_ORGANIZADO_HOME).trim() !== '') {
    return path.resolve(String(env.PROJETO_ORGANIZADO_HOME).trim());
  }
  if (homeDir) {
    const pointerPath = path.join(homeDir, '.projeto-organizado.json');
    if (fs.existsSync(pointerPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(pointerPath, 'utf8'));
        if (parsed && typeof parsed.hubPath === 'string' && parsed.hubPath.trim() !== '') {
          return path.resolve(parsed.hubPath.trim());
        }
      } catch {
        // Ponteiro inválido: segue para fallback em cwd
      }
    }
  }
  return path.resolve(cwd);
}

function validateSlug(slug) {
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
    throw new Error(
      `Slug inválido ("${slug}"). Use apenas letras minúsculas sem acento, números e hífens (ex.: meu-tema-v1).`
    );
  }
  return slug;
}

function listVersoes(temaDir) {
  const versoesDir = path.join(temaDir, 'versoes');
  if (!fs.existsSync(versoesDir)) return [];
  return fs
    .readdirSync(versoesDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^v[1-9]\d*\.md$/.test(entry.name))
    .map((entry) => entry.name.replace(/\.md$/, ''))
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
}

function loadHubData(hubRoot) {
  const root = path.resolve(hubRoot);
  const warnings = [];

  const projetosDir = path.join(root, 'projetos');
  const projetos = [];
  if (fs.existsSync(projetosDir)) {
    for (const entry of fs.readdirSync(projetosDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        projetos.push(entry.name.slice(0, -3));
      }
    }
  }
  projetos.sort(asciiSort);

  const temasDir = path.join(root, 'temas');
  const temas = [];
  if (fs.existsSync(temasDir)) {
    const dirs = fs
      .readdirSync(temasDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort(asciiSort);

    for (const slug of dirs) {
      const temaDir = path.join(temasDir, slug);
      const filePath = path.join(temaDir, `${slug}.md`);
      if (!fs.existsSync(filePath)) {
        warnings.push(`Tema "${slug}" sem arquivo principal temas/${slug}/${slug}.md.`);
        continue;
      }
      const raw = fs.readFileSync(filePath, 'utf8');
      const { data, body } = parseFrontmatter(raw);
      const validation = validateTemaMeta(data);
      if (!validation.valid) {
        warnings.push(`Tema "${slug}" com frontmatter inválido: ${validation.errors.join(' ')}`);
      }
      const versoes = listVersoes(temaDir);
      temas.push({
        slug,
        filePath,
        data,
        body,
        versoes,
      });
    }
  }

  const slugSet = new Set(temas.map((t) => t.slug));
  for (const tema of temas) {
    const rels = Array.isArray(tema.data.relacionados) ? tema.data.relacionados : [];
    for (const rel of rels) {
      const target = stripWikilink(rel);
      if (target && !slugSet.has(target)) {
        warnings.push(`Tema "${tema.slug}" referencia relacionado inexistente: "${target}".`);
      }
    }
  }

  warnings.sort(asciiSort);
  return { projetos, temas, warnings };
}

function escapeCell(text) {
  return String(text || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

function formatPrCell(data) {
  const parts = [];
  if (data.pr_ativo) {
    const pr = String(data.pr_ativo).trim();
    parts.push(/^https?:\/\//i.test(pr) ? `[PR](${pr})` : escapeCell(pr));
  }
  if (data.branch_ativa) parts.push(`\`${data.branch_ativa}\``);
  return parts.length > 0 ? parts.join(' / ') : '-';
}

function renderPainel(hubData) {
  const { projetos = [], temas = [], warnings = [] } = hubData;
  const sortedTemas = [...temas].sort((a, b) => asciiSort(a.slug, b.slug));

  const counts = {};
  for (const estado of VALID_ESTADOS) counts[estado] = 0;
  for (const tema of sortedTemas) {
    if (counts[tema.data.estado] !== undefined) {
      counts[tema.data.estado] += 1;
    }
  }

  const lines = [
    '# Painel — Projeto Organizado',
    '',
    '> Gerado automaticamente por `tema painel`. Não edite manualmente; edite os temas em `temas/<slug>/`.',
    '> Guia rápido: [[MANUAL]] | Auditoria local desta máquina: [[WORKTREES.local]]',
    '',
    '## Resumo',
    '',
    '| Estado | Quantidade |',
    '|---|---|',
    `| \`discutindo\` | ${counts.discutindo} |`,
    `| \`em-pr\` | ${counts['em-pr']} |`,
    `| \`ideia\` | ${counts.ideia} |`,
    `| \`pronto\` | ${counts.pronto} |`,
    `| **Total** | **${sortedTemas.length}** |`,
    '',
  ];

  for (const section of ESTADO_SECTIONS) {
    lines.push(`## ${section.heading}`);
    lines.push('');
    const group = sortedTemas.filter((t) => t.data.estado === section.key);
    if (group.length === 0) {
      lines.push('_Nenhum tema neste estado._');
      lines.push('');
      continue;
    }
    lines.push('| Tema | Título | Projetos | Versão | PR / Branch |');
    lines.push('|---|---|---|---|---|');
    for (const tema of group) {
      const projs = (Array.isArray(tema.data.projetos) ? tema.data.projetos : [])
        .map((p) => toWikilink(p))
        .join(', ');
      lines.push(
        `| [[${tema.slug}]] | ${escapeCell(tema.data.titulo)} | ${projs || '-'} | ${escapeCell(tema.data.versao)} | ${formatPrCell(tema.data)} |`
      );
    }
    lines.push('');
  }

  lines.push('## Por Projeto');
  lines.push('');

  const projectNames = new Set(projetos);
  for (const tema of sortedTemas) {
    const list = Array.isArray(tema.data.projetos) ? tema.data.projetos : [];
    for (const p of list) {
      const name = stripWikilink(p);
      if (name) projectNames.add(name);
    }
  }
  const sortedProjects = [...projectNames].sort(asciiSort);

  if (sortedProjects.length === 0) {
    lines.push('_Nenhum projeto cadastrado._');
    lines.push('');
  } else {
    for (const proj of sortedProjects) {
      lines.push(`### [[${proj}]]`);
      lines.push('');
      const related = sortedTemas.filter((t) =>
        (Array.isArray(t.data.projetos) ? t.data.projetos : []).some((p) => stripWikilink(p) === proj)
      );
      if (related.length === 0) {
        lines.push('- _Nenhum tema vinculado ainda._');
      } else {
        for (const tema of related) {
          lines.push(
            `- [[${tema.slug}]] — ${escapeCell(tema.data.titulo)} (\`${tema.data.estado}\`, ${tema.data.versao})`
          );
        }
      }
      lines.push('');
    }
  }

  if (warnings.length > 0) {
    lines.push('## Avisos de Integridade');
    lines.push('');
    for (const w of warnings) {
      lines.push(`- ${w}`);
    }
    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

function writePainel(hubRoot) {
  const root = path.resolve(hubRoot);
  const data = loadHubData(root);
  const content = renderPainel(data);
  const painelPath = path.join(root, 'PAINEL.md');
  fs.writeFileSync(painelPath, content, 'utf8');
  return {
    painelPath,
    temaCount: data.temas.length,
    warnings: data.warnings,
  };
}

function buscarTemas(hubRoot, query) {
  const normalizedQuery = normalizeForSearch(query).trim();
  if (!normalizedQuery) return [];
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  const { temas } = loadHubData(hubRoot);
  const results = [];

  for (const tema of temas) {
    const slugNorm = normalizeForSearch(tema.slug);
    const tituloNorm = normalizeForSearch(tema.data.titulo);
    const projetosNorm = normalizeForSearch((tema.data.projetos || []).join(' '));
    const relacionadosNorm = normalizeForSearch((tema.data.relacionados || []).join(' '));
    const bodyNorm = normalizeForSearch(tema.body);

    const versoesDir = path.join(path.dirname(tema.filePath), 'versoes');
    let versoesText = '';
    if (fs.existsSync(versoesDir)) {
      for (const v of tema.versoes) {
        const vPath = path.join(versoesDir, `${v}.md`);
        if (fs.existsSync(vPath)) {
          versoesText += `\n${fs.readFileSync(vPath, 'utf8')}`;
        }
      }
    }
    const versoesNorm = normalizeForSearch(versoesText);
    const allCombined = `${slugNorm}\n${tituloNorm}\n${projetosNorm}\n${relacionadosNorm}\n${bodyNorm}\n${versoesNorm}`;

    // Todos os tokens devem existir em algum campo do tema
    const allMatch = tokens.every((tok) => allCombined.includes(tok));
    if (!allMatch) continue;

    let score = 0;
    const matchedIn = new Set();

    if (slugNorm.includes(normalizedQuery)) {
      score += 60;
      matchedIn.add('slug');
    }
    if (tituloNorm.includes(normalizedQuery)) {
      score += 50;
      matchedIn.add('titulo');
    }

    for (const tok of tokens) {
      if (slugNorm.includes(tok)) {
        score += 30;
        matchedIn.add('slug');
      }
      if (tituloNorm.includes(tok)) {
        score += 25;
        matchedIn.add('titulo');
      }
      if (projetosNorm.includes(tok)) {
        score += 15;
        matchedIn.add('projetos');
      }
      if (relacionadosNorm.includes(tok)) {
        score += 15;
        matchedIn.add('relacionados');
      }
      if (bodyNorm.includes(tok)) {
        score += 8;
        matchedIn.add('corpo');
      }
      if (versoesNorm.includes(tok)) {
        score += 6;
        matchedIn.add('versoes');
      }
    }

    results.push({
      slug: tema.slug,
      titulo: String(tema.data.titulo || tema.slug),
      estado: String(tema.data.estado || ''),
      versao: String(tema.data.versao || ''),
      projetos: Array.isArray(tema.data.projetos) ? tema.data.projetos : [],
      score,
      matchedIn: [...matchedIn],
    });
  }

  results.sort((a, b) => (b.score !== a.score ? b.score - a.score : asciiSort(a.slug, b.slug)));
  return results;
}

function renderVersionTemplate(hubRoot, { slug, titulo, versao, dataStr, resumo }) {
  const templatePath = path.join(hubRoot, 'templates', 'VERSAO.md');
  let content;
  if (fs.existsSync(templatePath)) {
    content = fs
      .readFileSync(templatePath, 'utf8')
      .replace(/\{\{titulo\}\}/g, () => titulo)
      .replace(/\{\{versao\}\}/g, () => versao)
      .replace(/\{\{slug\}\}/g, () => slug)
      .replace(/\{\{data\}\}/g, () => dataStr);
    if (resumo) {
      content = content.replace('(O que motivou esta versão / evolução.)', () => resumo);
    }
  } else {
    content = [
      `# ${titulo} — ${versao}`,
      '',
      `- **Tema:** [[${slug}]]`,
      `- **Criado em:** ${dataStr}`,
      '',
      '## 1. Contexto e Ideia Inicial',
      '',
      resumo || '(O que motivou esta versão / evolução.)',
      '',
      '## 2. Discussão e Decisões',
      '',
      '- ...',
      '',
      '## 3. Desenho Aprovado',
      '',
      '(Preenchido após alinhamento e aprovação da pessoa responsável.)',
      '',
      '## 4. Plano de Execução e PR',
      '',
      '- **Branch/Worktree:** -',
      '- **PR:** -',
      '- **Desfecho:** Em aberto',
      '',
    ].join('\n');
  }
  return content;
}

function createTema(
  hubRoot,
  {
    slug,
    titulo,
    projetos = [],
    estado = 'ideia',
    relacionados = [],
    fontes_anteriores = [],
    v1Conteudo,
  }
) {
  const root = path.resolve(hubRoot);
  validateSlug(slug);

  if (!titulo || String(titulo).trim() === '') {
    throw new Error('O campo "--titulo" é obrigatório.');
  }
  const normalizedProjetos = (Array.isArray(projetos) ? projetos : [projetos])
    .map(toWikilink)
    .filter(Boolean);
  if (normalizedProjetos.length === 0) {
    throw new Error('Informe ao menos um projeto em "--projeto".');
  }
  if (!VALID_ESTADOS.includes(estado)) {
    throw new Error(`Estado inválido ("${estado}"). Valores aceitos: ${VALID_ESTADOS.join(', ')}.`);
  }

  const temasDir = path.join(root, 'temas');
  const temaDir = path.resolve(temasDir, slug);
  const relCheck = path.relative(temasDir, temaDir);
  if (relCheck.startsWith('..') || path.isAbsolute(relCheck) || relCheck !== slug) {
    throw new Error(`Slug inválido ("${slug}"): caminho fora de temas/.`);
  }
  if (fs.existsSync(temaDir)) {
    throw new Error(`Tema "${slug}" já existe em temas/${slug}/. Escolha outro slug ou use "tema nova-versao ${slug}".`);
  }

  const normalizedRelacionados = (Array.isArray(relacionados) ? relacionados : [relacionados])
    .map(toWikilink)
    .filter(Boolean);

  const meta = {
    titulo: String(titulo).trim(),
    projetos: normalizedProjetos,
    estado,
    versao: 'v1',
    relacionados: normalizedRelacionados,
  };
  if (Array.isArray(fontes_anteriores) && fontes_anteriores.length > 0) {
    meta.fontes_anteriores = fontes_anteriores;
  }

  const dataStr = todayIsoDate();
  const body = [
    '',
    `# ${meta.titulo}`,
    '',
    '## Visão Atual',
    '',
    '(Resumo curto e vivo do que já foi decidido sobre este tema.)',
    '',
    '## Versões',
    '',
    `- [[temas/${slug}/versoes/v1|v1]] — Discussão inicial`,
    '',
    '## Histórico de PRs',
    '',
    '| Versão | Projeto | PR | Resultado | Data |',
    '|---|---|---|---|---|',
    `| v1 | ${normalizedProjetos.join(', ')} | - | Em aberto | ${dataStr} |`,
    '',
  ].join('\n');

  const versoesDir = path.join(temaDir, 'versoes');
  fs.mkdirSync(versoesDir, { recursive: true });

  const temaPath = path.join(temaDir, `${slug}.md`);
  const versaoPath = path.join(versoesDir, 'v1.md');

  fs.writeFileSync(temaPath, serializeFrontmatter(meta, body), 'utf8');
  const v1Text =
    typeof v1Conteudo === 'string' && v1Conteudo.trim() !== ''
      ? v1Conteudo.replace(/\r\n/g, '\n')
      : renderVersionTemplate(root, { slug, titulo: meta.titulo, versao: 'v1', dataStr });
  fs.writeFileSync(versaoPath, v1Text.endsWith('\n') ? v1Text : `${v1Text}\n`, 'utf8');

  writePainel(root);
  return { slug, temaPath, versaoPath };
}

function createNovaVersao(hubRoot, slug, { resumo = '' } = {}) {
  const root = path.resolve(hubRoot);
  validateSlug(slug);

  const temaDir = path.join(root, 'temas', slug);
  const temaPath = path.join(temaDir, `${slug}.md`);
  if (!fs.existsSync(temaPath)) {
    throw new Error(`Tema "${slug}" não encontrado em temas/${slug}/${slug}.md.`);
  }

  const raw = fs.readFileSync(temaPath, 'utf8');
  const { data, body } = parseFrontmatter(raw);
  const existingVersoes = listVersoes(temaDir);
  const currentNum = /^v([1-9]\d*)$/.test(String(data.versao || ''))
    ? Number(String(data.versao).slice(1))
    : 0;
  const maxFileNum = existingVersoes.reduce((acc, v) => Math.max(acc, Number(v.slice(1))), 0);
  const nextNum = Math.max(currentNum, maxFileNum) + 1;
  const versao = `v${nextNum}`;

  const versoesDir = path.join(temaDir, 'versoes');
  fs.mkdirSync(versoesDir, { recursive: true });
  const versaoPath = path.join(versoesDir, `${versao}.md`);
  const dataStr = todayIsoDate();
  const vContent = renderVersionTemplate(root, {
    slug,
    titulo: String(data.titulo || slug),
    versao,
    dataStr,
    resumo,
  });
  fs.writeFileSync(versaoPath, vContent.endsWith('\n') ? vContent : `${vContent}\n`, 'utf8');

  data.versao = versao;
  data.estado = 'discutindo';
  delete data.pr_ativo;
  delete data.branch_ativa;

  const entryLine = `- [[temas/${slug}/versoes/${versao}|${versao}]] — ${resumo || 'Nova evolução'}`;
  let updatedBody = body;
  if (/## Versões\s*\n/.test(updatedBody)) {
    updatedBody = updatedBody.replace(/(## Versões\s*\n(?:[\s\S]*?))(\n## |\s*$)/, (_, block, tail) => {
      return `${block.trimEnd()}\n${entryLine}\n${tail}`;
    });
  } else {
    updatedBody = `${updatedBody.trimEnd()}\n\n## Versões\n\n${entryLine}\n`;
  }

  if (/## Histórico de PRs\s*\n/.test(updatedBody)) {
    const projStr = (Array.isArray(data.projetos) ? data.projetos : []).join(', ') || '-';
    const row = `| ${versao} | ${projStr} | - | Em aberto | ${dataStr} |`;
    updatedBody = updatedBody.replace(
      /(## Histórico de PRs\s*\n(?:[\s\S]*?))(\n## |\s*$)/,
      (_, block, tail) => `${block.trimEnd()}\n${row}\n${tail}`
    );
  }

  fs.writeFileSync(temaPath, serializeFrontmatter(data, updatedBody), 'utf8');
  writePainel(root);
  return { slug, versao, versaoPath };
}

module.exports = {
  resolveHubRoot,
  validateSlug,
  normalizeForSearch,
  stripWikilink,
  toWikilink,
  loadHubData,
  renderPainel,
  writePainel,
  buscarTemas,
  createTema,
  createNovaVersao,
};
