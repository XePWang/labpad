import type { SyntaxNode, Tree } from '@lezer/common';
import type { Completion } from '@codemirror/autocomplete';
interface Scope {
  from: number;
  to: number;
}
export interface DeclaredName {
  name: string;
  qualified: string;
  type: string;
  detail: string;
  from: number;
  scope?: Scope;
}
const wrappers = new Set([
  'InitDeclarator',
  'PointerDeclarator',
  'ReferenceDeclarator',
  'ArrayDeclarator',
  'FunctionDeclarator',
  'ParenthesizedDeclarator',
  'AttributedDeclarator',
  'VariadicDeclarator',
]);
const names = new Set(['Identifier', 'TypeIdentifier', 'FieldIdentifier']);
function children(node: SyntaxNode) {
  const result: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) result.push(child);
  return result;
}
function namespaceName(node: SyntaxNode | null, text: string) {
  const result: string[] = [];
  for (let current = node; current; current = current.parent)
    if (current.name === 'NamespaceDefinition') {
      const parts = children(current)
        .filter((child) => child.name === 'Identifier')
        .map((child) => text.slice(child.from, child.to));
      result.unshift(...parts);
    }
  return result.join('::');
}
function lexicalScope(node: SyntaxNode): Scope | undefined {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.name === 'CompoundStatement' && parent.parent?.name === 'NamespaceDefinition')
      continue;
    if (
      [
        'CompoundStatement',
        'ForStatement',
        'FieldDeclarationList',
        'ClassSpecifier',
        'StructSpecifier',
      ].includes(parent.name)
    )
      return { from: parent.from, to: parent.to };
  }
}
function declarator(node: SyntaxNode): { node: SyntaxNode; function: boolean } | undefined {
  if (names.has(node.name) || node.name === 'ScopedIdentifier') return { node, function: false };
  if (!wrappers.has(node.name)) return;
  const child = children(node).find(
    (child) =>
      names.has(child.name) || child.name === 'ScopedIdentifier' || wrappers.has(child.name),
  );
  if (!child) return;
  const found = declarator(child);
  if (!found) return;
  const pointer =
    node.name === 'FunctionDeclarator' &&
    child.name === 'ParenthesizedDeclarator' &&
    children(child).some(
      (part) => part.name === 'PointerDeclarator' || part.name === 'ReferenceDeclarator',
    );
  return {
    node: found.node,
    function: found.function || (node.name === 'FunctionDeclarator' && !pointer),
  };
}
const cache = new WeakMap<Tree, { text: string; symbols: DeclaredName[] }>();
export function declaredNames(tree: Tree, text: string): DeclaredName[] {
  const cached = cache.get(tree);
  if (cached?.text === text) return cached.symbols;
  const result: DeclaredName[] = [];
  const recovery: { node: SyntaxNode; scope: Scope }[] = [];
  // Lezer may recover an unfinished function as a header and opening brace at Program level.
  for (const node of children(tree.topNode))
    if (node.name === 'FunctionDeclarator' && node.nextSibling?.name === '{') {
      let end = text.length;
      for (let next = node.nextSibling.nextSibling; next; next = next.nextSibling)
        if (next.name === 'FunctionDefinition') {
          end = next.from;
          break;
        }
      recovery.push({ node, scope: { from: node.nextSibling.from, to: end } });
    }
  function add(
    owner: SyntaxNode,
    node: SyntaxNode,
    type: string,
    scope = lexicalScope(owner),
    namespace = namespaceName(owner.parent, text),
  ) {
    const full = text.slice(node.from, node.to);
    if (!/^[A-Za-z_]\w*(?:::[A-Za-z_]\w*)*$/.test(full)) return;
    const parts = full.split('::'),
      name = parts.pop()!;
    const qualified = parts.length ? full : (namespace ? namespace + '::' : '') + name;
    if (!scope && owner.parent?.name === 'Program')
      scope = recovery.find(
        (item) => owner.from >= item.scope.from && owner.from < item.scope.to,
      )?.scope;
    const body = owner.getChild('CompoundStatement');
    result.push({
      name,
      qualified,
      type,
      from: node.from,
      scope,
      detail: text.slice(owner.from, Math.min(body?.from ?? owner.to, owner.from + 180)).trim(),
    });
  }
  function parameters(owner: SyntaxNode, scope: Scope) {
    const visit = (node: SyntaxNode) => {
      if (node.name === 'ParameterList') {
        for (const parameter of node.getChildren('ParameterDeclaration'))
          for (const child of children(parameter)) {
            if (child.name === 'TypeIdentifier') continue;
            const found = declarator(child);
            if (found) {
              add(parameter, found.node, 'variable', scope);
              break;
            }
          }
        return;
      }
      for (const child of children(node))
        if (child.name.includes('Declarator') || child.name === 'ParameterList') visit(child);
    };
    visit(owner);
  }
  tree.iterate({
    enter(ref) {
      const node = ref.node;
      if (
        node.name === 'Declaration' ||
        node.name === 'FieldDeclaration' ||
        node.name === 'FunctionDefinition' ||
        node.name === 'TypeDefinition'
      ) {
        let candidates = children(node);
        if (node.name === 'TypeDefinition') {
          const base = candidates.findIndex((child) => /Type|Specifier/.test(child.name));
          candidates = candidates.slice(base + 1);
        }
        for (const child of candidates) {
          if (child.name === 'TypeIdentifier' && node.name !== 'TypeDefinition') continue;
          const found = declarator(child);
          if (!found) continue;
          add(
            node,
            found.node,
            node.name === 'TypeDefinition'
              ? 'type'
              : found.function
                ? 'function'
                : node.name === 'FieldDeclaration'
                  ? 'property'
                  : 'variable',
          );
        }
        if (node.name === 'FunctionDefinition') {
          const body = node.getChild('CompoundStatement');
          if (body) parameters(node, { from: body.from, to: body.to });
        }
      } else if (
        ['StructSpecifier', 'ClassSpecifier', 'EnumSpecifier', 'AliasDeclaration'].includes(
          node.name,
        )
      ) {
        const name = node.getChild('TypeIdentifier');
        if (name) add(node, name, 'type');
      } else if (node.name === 'Enumerator') {
        const name = node.getChild('Identifier');
        if (name) add(node, name, 'constant');
      } else if (node.name === 'PreprocDirective' && node.firstChild?.name === '#define') {
        const name = node.getChild('Identifier');
        if (name) {
          const before = result.length;
          add(node, name, 'constant', undefined, '');
          if (result[before]) result[before].scope = undefined;
        }
      } else if (node.name === 'LambdaExpression') {
        const body = node.getChild('CompoundStatement');
        if (body) parameters(node, { from: body.from, to: body.to });
      }
    },
  });
  for (const item of recovery) {
    const found = declarator(item.node);
    if (found) add(item.node, found.node, 'function');
    parameters(item.node, item.scope);
  }
  cache.set(tree, { text, symbols: result });
  return result;
}
export interface Candidate extends Completion {
  qualified?: string;
}
export function visibleDeclarations(tree: Tree, text: string, pos: number): Candidate[] {
  const namespace = namespaceName(tree.resolveInner(pos, -1), text);
  return declaredNames(tree, text)
    .filter(
      (symbol) =>
        symbol.from <= pos &&
        (!symbol.scope || (pos >= symbol.scope.from && pos <= symbol.scope.to)),
    )
    .map((symbol) => {
      const own = symbol.qualified.slice(
        0,
        Math.max(0, symbol.qualified.length - symbol.name.length - 2),
      );
      return {
        label:
          symbol.scope || !own || namespace === own || namespace.startsWith(own + '::')
            ? symbol.name
            : symbol.qualified,
        qualified: symbol.scope ? undefined : symbol.qualified,
        type: symbol.type,
        detail: symbol.detail,
        boost: symbol.scope ? 20 : 5,
      };
    });
}
export function includeDirectives(tree: Tree, text: string, upto = text.length) {
  const result: { name: string; quoted: boolean }[] = [];
  tree.iterate({
    enter(ref) {
      const node = ref.node;
      if (node.from > upto) return false;
      if (node.name !== 'PreprocDirective' || node.firstChild?.name !== '#include') return;
      const value = node.getChild('String') ?? node.getChild('SystemLibString');
      if (!value || value.to > upto) return;
      const raw = text.slice(value.from, value.to);
      if (!/^(?:"[^"\r\n]+"|<[^>\r\n]+>)$/.test(raw)) return;
      result.push({ name: raw.slice(1, -1), quoted: raw[0] === '"' });
    },
  });
  return result;
}
