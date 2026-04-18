# 15 — Session Documentation & CLAUDE.md Maintenance

> **Skill type:** Claude Code Skill
> **Role:** Session Documentation — mantém CLAUDE.md, memory, e documentação sempre actualizados ao longo e no final de cada sessão.
> **Trigger:** Stop hook (automático) + após cada commit significativo

---

## Quando Este Processo Dispara

| Trigger | Acção |
|---------|-------|
| **Stop hook** (fim de sessão) | Checklist completo obrigatório |
| **Após git commit** com alterações estruturais | Actualizar CLAUDE.md inline |
| **Após criar/remover ficheiros** | Actualizar Project Structure no CLAUDE.md |
| **Após mudar convenção** | Actualizar Conventions no CLAUDE.md |
| **Após feedback do utilizador** | Guardar em memory (feedback type) |

---

## Checklist de Fim de Sessão (OBRIGATÓRIO)

### 1. CLAUDE.md — Verificar e Actualizar

Ler `CLAUDE.md` e verificar cada secção:

#### Project Structure
```
Pergunta: Criei/removi/movi algum ficheiro em src/?
Se SIM → actualizar a árvore de directórios no CLAUDE.md
```

**Como detectar:**
```bash
git diff --name-status HEAD~$(git log --oneline --since="today" | wc -l) -- src/
```

Se o output mostrar `A` (added) ou `D` (deleted) em `src/`, actualizar a secção `## Project Structure`.

#### BLE Services
```
Pergunta: Adicionei/modifiquei algum serviço BLE?
Se SIM → actualizar a tabela de BLE Services
```

#### Conventions
```
Pergunta: Introduzi alguma convenção nova ou alterei uma existente?
Se SIM → adicionar/actualizar na secção ## Conventions
Exemplos:
  - Novo padrão de estado → adicionar regra Zustand
  - Nova restrição de API → adicionar regra REST
  - Novo protocolo BLE → adicionar regra BLE
```

#### Modules
```
Pergunta: O projecto tem novos módulos funcionais?
Se SIM → actualizar a lista de Modules
```

#### Auth / RBAC / File Storage
```
Pergunta: Alterei algo na autenticação, permissões, ou storage?
Se SIM → actualizar a secção relevante
```

#### Skill Routing Table
```
Pergunta: Criei funcionalidade que deveria ter uma skill associada?
Se SIM → verificar se a routing table cobre o novo domínio
Se NÃO cobre → adicionar linha à tabela ou criar nova skill
```

---

### 2. Memory — Guardar Aprendizagens

Verificar se houve aprendizagens que beneficiam sessões futuras:

#### Feedback (correcções do utilizador)
```
O utilizador corrigiu-me? ("não, faz assim", "usa X em vez de Y")
→ Guardar em memory como tipo 'feedback'
→ Incluir WHY e HOW TO APPLY
```

#### Project (decisões, bugs, estado)
```
Descobri algo sobre o estado do projecto?
- Bug encontrado e resolvido
- Decisão de arquitectura tomada
- Trabalho em progresso que continua noutra sessão
→ Guardar em memory como tipo 'project'
→ Converter datas relativas para absolutas
```

#### Reference (recursos externos)
```
Descobri um recurso externo útil?
- URL de documentação
- Endpoint de API
- Ferramenta ou serviço
→ Guardar em memory como tipo 'reference'
```

#### User (perfil do utilizador)
```
Aprendi algo novo sobre o utilizador?
- Preferências de trabalho
- Nível de conhecimento
- Responsabilidades
→ Guardar em memory como tipo 'user'
```

**IMPORTANTE:** Antes de guardar, verificar MEMORY.md para evitar duplicados. Se já existe uma memory sobre o tópico, ACTUALIZAR em vez de criar nova.

---

### 3. kromi-doc — Sincronizar Documentação

```bash
# Verificar se git hooks estão instalados
ls -la .git/hooks/pre-commit .git/hooks/post-push 2>/dev/null

# Se não estão instalados:
PYTHONIOENCODING=utf-8 kromi-doc install-hooks --force

# Se houve commits, a sincronização é automática via hooks
# NÃO fazer sync manual — os hooks fazem isso
```

Se os hooks não estão instalados, LEMBRAR o utilizador:
> "Os git hooks do kromi-doc não estão instalados. Queres que os instale? Sem eles, a documentação Obsidian não sincroniza automaticamente."

---

### 4. Resumo da Sessão

No final, apresentar ao utilizador um resumo breve:

```
## Sessão [data]
### O que foi feito
- [lista de alterações principais]

### Ficheiros alterados
- [lista dos ficheiros mais importantes]

### CLAUDE.md
- [actualizado/sem alterações] — [o que mudou, se aplicável]

### Memory
- [N memories criadas/actualizadas] — [tópicos]

### Próximos passos
- [sugestões para a próxima sessão, se aplicável]
```

---

## Actualização Inline (Durante a Sessão)

Não esperar pelo fim da sessão para tudo. Actualizar IMEDIATAMENTE quando:

| Evento | Acção imediata |
|--------|----------------|
| Criei ficheiro novo em `src/` | Actualizar Project Structure |
| Criei tabela Supabase | Actualizar secção relevante + adicionar à lista de key tables na skill 02 |
| Criei edge function | Actualizar lista de edge functions |
| Adicionei serviço BLE | Actualizar tabela BLE Services |
| Mudei convenção | Actualizar Conventions |
| Utilizador deu feedback | Guardar memory AGORA (não esperar pelo fim) |

---

## Anti-Patterns (NUNCA fazer)

| Anti-pattern | Correcto |
|---|---|
| Ignorar o Stop hook | SEMPRE executar o checklist |
| Guardar código/paths em memory | Código vive no repo, não em memory |
| Duplicar memories existentes | Verificar MEMORY.md primeiro, depois actualizar |
| Expandir CLAUDE.md para > 300 linhas | Manter conciso; detalhes vão para skills |
| Guardar state temporário em memory | Memory é para sessões futuras, não tarefas em curso |
| Fazer sync manual do kromi-doc | Usar SEMPRE os git hooks |
| Adiar actualização do CLAUDE.md | Actualizar inline quando o evento ocorre |

---

## Template: Secção CLAUDE.md para Novo Serviço

Quando crias um novo serviço/módulo significativo, adiciona ao CLAUDE.md:

```markdown
## [Nome do Módulo]

**Propósito:** [uma linha]
**Ficheiros:** `src/services/[nome]/` — [lista de ficheiros]
**Store:** [nome]Store (se aplicável)
**Convenções:**
- [regra 1]
- [regra 2]
```

---

## Checklist Rápido (copiar para verificação)

```
[ ] CLAUDE.md Project Structure actualizado?
[ ] CLAUDE.md Conventions actualizado?
[ ] CLAUDE.md secções específicas (Auth/BLE/Storage) actualizadas?
[ ] Skill routing table cobre novos domínios?
[ ] Feedback do utilizador guardado em memory?
[ ] Decisões/aprendizagens guardadas em memory?
[ ] kromi-doc hooks instalados?
[ ] Resumo da sessão apresentado ao utilizador?
```
