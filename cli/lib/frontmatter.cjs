'use strict';

const VALID_ESTADOS = ['ideia', 'discutindo', 'em-pr', 'pronto'];
const REQUIRED_FIELDS = ['titulo', 'projetos', 'estado', 'versao', 'relacionados'];
const OPTIONAL_FIELDS = ['pr_ativo', 'branch_ativa', 'fontes_anteriores', 'kanban_ref'];
const LIST_FIELDS = new Set(['projetos', 'relacionados', 'fontes_anteriores']);

function unquote(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    const inner = trimmed.slice(1, -1);
    return trimmed.startsWith('"')
      ? inner.replace(/\\"/g, '"').replace(/\\\\/g, '\\')
      : inner.replace(/''/g, "'");
  }
  return trimmed;
}

function formatScalar(value) {
  const str = String(value);
  if (str === '') return '""';
  const needsQuotes =
    /^\s|\s$/.test(str) ||
    /[:#\[\]{}&*!|>'"%@`]/.test(str) ||
    str === 'true' ||
    str === 'false' ||
    str === 'null';
  if (!needsQuotes) return str;
  return `"${str.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function parseInlineArray(raw) {
  const inner = raw.slice(1, -1).trim();
  if (!inner) return [];
  const items = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (quote) {
      if (ch === '\\' && quote === '"' && i + 1 < inner.length) {
        current += ch + inner[i + 1];
        i += 1;
      } else if (ch === quote) {
        current += ch;
        quote = null;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === ',') {
      items.push(unquote(current));
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim() !== '') {
    items.push(unquote(current));
  }
  return items;
}

function parseFrontmatter(markdown) {
  const normalized = String(markdown || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return { data: {}, body: normalized };
  }
  const endIdx = normalized.indexOf('\n---', 4);
  if (endIdx === -1) {
    return { data: {}, body: normalized };
  }
  const afterClose = normalized.slice(endIdx + 4);
  if (afterClose !== '' && !afterClose.startsWith('\n')) {
    return { data: {}, body: normalized };
  }

  const yamlBlock = normalized.slice(4, endIdx);
  const body = afterClose.startsWith('\n') ? afterClose.slice(1) : afterClose;
  const data = {};
  const lines = yamlBlock.split('\n');
  let currentListKey = null;

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) {
      continue;
    }
    const listMatch = line.match(/^\s*-\s+(.*)$/);
    if (listMatch && currentListKey) {
      data[currentListKey].push(unquote(listMatch[1]));
      continue;
    }
    const kvMatch = line.match(/^([a-zA-Z0-9_-]+):(.*)$/);
    if (!kvMatch) {
      currentListKey = null;
      continue;
    }
    const key = kvMatch[1];
    const rest = kvMatch[2].trim();
    if (rest === '') {
      data[key] = [];
      currentListKey = key;
    } else if (rest.startsWith('[') && rest.endsWith(']')) {
      data[key] = parseInlineArray(rest);
      currentListKey = null;
    } else {
      data[key] = unquote(rest);
      currentListKey = null;
    }
  }

  return { data, body };
}

function isEmptyOptional(value) {
  if (value === undefined || value === null) return true;
  if (Array.isArray(value)) return value.length === 0;
  return String(value).trim() === '';
}

function serializeField(key, value) {
  if (Array.isArray(value) || LIST_FIELDS.has(key)) {
    const arr = Array.isArray(value) ? value : (value ? [value] : []);
    if (arr.length === 0) {
      return `${key}: []`;
    }
    return `${key}:\n${arr.map((item) => `  - ${formatScalar(item)}`).join('\n')}`;
  }
  return `${key}: ${formatScalar(value)}`;
}

function serializeFrontmatter(data, body = '') {
  const lines = ['---'];
  const orderedKeys = [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS];
  const seen = new Set(orderedKeys);

  for (const key of REQUIRED_FIELDS) {
    const val = data[key] !== undefined ? data[key] : (LIST_FIELDS.has(key) ? [] : '');
    lines.push(serializeField(key, val));
  }

  for (const key of OPTIONAL_FIELDS) {
    if (!isEmptyOptional(data[key])) {
      lines.push(serializeField(key, data[key]));
    }
  }

  for (const key of Object.keys(data || {})) {
    if (!seen.has(key) && !isEmptyOptional(data[key])) {
      lines.push(serializeField(key, data[key]));
    }
  }

  lines.push('---');
  const normalizedBody = String(body || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!normalizedBody) {
    return `${lines.join('\n')}\n`;
  }
  const sep = normalizedBody.startsWith('\n') ? '' : '\n';
  return `${lines.join('\n')}\n${sep}${normalizedBody}`;
}

function validateTemaMeta(data) {
  const errors = [];
  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Frontmatter ausente ou inválido'] };
  }
  if (!data.titulo || String(data.titulo).trim() === '') {
    errors.push('Campo obrigatório "titulo" está vazio.');
  }
  if (!Array.isArray(data.projetos) || data.projetos.length === 0) {
    errors.push('Campo obrigatório "projetos" deve ter ao menos um projeto.');
  }
  if (!VALID_ESTADOS.includes(data.estado)) {
    errors.push(`Campo "estado" inválido ("${data.estado}"). Valores aceitos: ${VALID_ESTADOS.join(', ')}.`);
  }
  if (!data.versao || !/^v[1-9]\d*$/.test(String(data.versao))) {
    errors.push(`Campo "versao" inválido ("${data.versao}"). Use formato v1, v2, ...`);
  }
  if (!Array.isArray(data.relacionados)) {
    errors.push('Campo obrigatório "relacionados" deve ser uma lista (pode ser []).');
  }
  return { valid: errors.length === 0, errors };
}

module.exports = {
  VALID_ESTADOS,
  REQUIRED_FIELDS,
  OPTIONAL_FIELDS,
  parseFrontmatter,
  serializeFrontmatter,
  validateTemaMeta,
};
