import * as babel from '@babel/types';
import * as path from 'path';

export function mergeImports(qualifiedName: string, imports: babel.ImportDeclaration[], symbols: Map<string, string>) {
    const merged = [];
    for (const stmt of imports) {
        const isRelativeImport = stmt.source.value[0] === '.';
        if (isRelativeImport) {
            stmt.source.value = `@motherboard/${path.join(
                path.dirname(qualifiedName),
                stmt.source.value,
            )}`;
        }
        const specifiers = [];
        for (const specifier of stmt.specifiers) {
            if (symbols.has(specifier.local.name)) {
                continue;
            }
            symbols.set(specifier.local.name, stmt.source.value);
            specifiers.push(specifier);
        }
        if (specifiers.length) {
            merged.push({ ...stmt, specifiers });
        }
    }
    return merged;
}