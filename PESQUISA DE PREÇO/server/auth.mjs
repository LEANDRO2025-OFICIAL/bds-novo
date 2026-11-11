// Login da equipe. Usuários vêm da variável USUARIOS="nome:senha;outro:senha2" (definida no painel do Render).
// Senhas ficam só em memória como hash scrypt; a sessão é um token aleatório em cookie HttpOnly.
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const DURACAO_MS = 12 * 60 * 60 * 1000;
const TENTATIVAS_MAX = 10;
const JANELA_MS = 15 * 60 * 1000;

const hash = (senha, sal) => scryptSync(String(senha), sal, 64);

/** "nome:senha;nome2:senha2" (ou um por linha; '#' comenta) → Map(nome → {sal, hash}). Senha pode ter ':'; não ';'. */
export function carregarUsuarios(texto) {
  const usuarios = new Map();
  for (const par of String(texto || '').replace(/^﻿/, '').split(/[;\r\n]+/)) {
    if (par.trim().startsWith('#')) continue;
    const i = par.indexOf(':');
    if (i < 1) continue;
    const nome = par.slice(0, i).trim().toLowerCase();
    const senha = par.slice(i + 1);
    if (senha.length < 8) throw new Error(`USUARIOS: a senha de "${nome}" precisa de ao menos 8 caracteres.`);
    const sal = randomBytes(16);
    usuarios.set(nome, { sal, hash: hash(senha, sal) });
  }
  return usuarios;
}

export function criarAuth(usuarios) {
  // shortcut: sessões e tentativas em memória; um reinício/deploy desloga todos. Se incomodar, gravar no SQLite.
  const sessoes = new Map();
  const tentativas = new Map();
  const falso = { sal: randomBytes(16), hash: randomBytes(64) };

  function bloqueado(ip) {
    const t = tentativas.get(ip);
    if (t && t.ate < Date.now()) tentativas.delete(ip);
    return (tentativas.get(ip)?.n || 0) >= TENTATIVAS_MAX;
  }

  return {
    ativo: usuarios.size > 0,
    login(nome, senha, ip) {
      if (bloqueado(ip)) return { erro: 'Muitas tentativas. Aguarde 15 minutos.', status: 429 };
      const chave = String(nome || '').trim().toLowerCase();
      const u = usuarios.get(chave) || falso; // mesmo custo para usuário inexistente
      const ok = timingSafeEqual(hash(senha ?? '', u.sal), u.hash) && usuarios.has(chave);
      if (!ok) {
        const t = tentativas.get(ip) || { n: 0, ate: Date.now() + JANELA_MS };
        t.n += 1;
        tentativas.set(ip, t);
        return { erro: 'Usuário ou senha incorretos.', status: 401 };
      }
      tentativas.delete(ip);
      const token = randomBytes(32).toString('base64url');
      sessoes.set(token, { usuario: chave, expira: Date.now() + DURACAO_MS });
      return { token, usuario: chave };
    },
    usuario(token) {
      const s = token && sessoes.get(token);
      if (!s) return null;
      if (s.expira < Date.now()) { sessoes.delete(token); return null; }
      return s.usuario;
    },
    logout(token) { sessoes.delete(token); },
    maxAgeSeg: DURACAO_MS / 1000,
  };
}

export const lerCookie = (req, nome) => {
  for (const parte of String(req.headers.cookie || '').split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === nome) return v.join('=');
  }
  return null;
};
