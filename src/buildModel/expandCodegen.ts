import * as babel from '@babel/types';
import { Model } from '@rotcare/codegen';
import { Project } from '../Project';
import generate from '@babel/generator';
import { parse } from '@babel/parser';

export function expandCodegen(
    project: Project,
    stmt: babel.Statement,
    imports: babel.ImportDeclaration[],
    symbols: Map<string, string>,
    models: Map<string, Model>,
) {
    if (!babel.isExportNamedDeclaration(stmt)) {
        return stmt;
    }
    if (!babel.isVariableDeclaration(stmt.declaration)) {
        return stmt;
    }
    const callExpr = stmt.declaration.declarations[0].init;
    if (!babel.isCallExpression(callExpr)) {
        return stmt;
    }
    const isCodegen = babel.isIdentifier(callExpr.callee) && callExpr.callee.name === 'codegen';
    if (!isCodegen) {
        return stmt;
    }
    const arrowFuncAst = callExpr.arguments[0];
    if (!babel.isArrowFunctionExpression(arrowFuncAst)) {
        throw new Error(`codegen must be called with arrow function`);
    }
    const argNames = [];
    const argValues = [];
    if (babel.isRestElement(arrowFuncAst.params[0])) {
        const restElement = arrowFuncAst.params[0]
        if (!babel.isIdentifier(restElement.argument)) {
            throw new Error('expect identifier')
        }
        argNames.push(restElement.argument.name);
        argValues.push(Array.from(models.values()));
    } else {
        for (const arg of arrowFuncAst.params) {
            if (!babel.isIdentifier(arg)) {
                throw new Error('expect identifier');
            }
            if (!babel.isTSTypeAnnotation(arg.typeAnnotation)) {
                throw new Error('expect ts type annotation');
            }
            const typeRef = arg.typeAnnotation.typeAnnotation;
            if (!babel.isTSTypeReference(typeRef)) {
                throw new Error('expect ts type reference');
            }
            if (!typeRef.typeParameters) {
                throw new Error('expect ts type parameters');
            }
            const typeParam = typeRef.typeParameters.params[0];
            if (!babel.isTSTypeReference(typeParam)) {
                throw new Error('expect ts type ref');
            }
            if (!babel.isIdentifier(typeParam.typeName)) {
                throw new Error('expect identifier');
            }
            const importedFrom = symbols.get(typeParam.typeName.name);
            if (!importedFrom) {
                throw new Error(`symbole ${typeParam.typeName.name} not found`);
            }
            if (!importedFrom.startsWith('@motherboard/')) {
                throw new Error(`Model<T> must reference model class as T`);
            }
            const qualifiedName = importedFrom.substr('@motherboard/'.length);
            const model = models.get(qualifiedName);
            if (!model) {
                // TODO: mark build as incomplete
                return stmt;
            }
            argNames.push(arg.name);
            argValues.push(model);
        }
    }
    try {
        (global.require) = require;
    } catch(e) {
    }
    let code = generate(arrowFuncAst.body).code;
    code = `${translateImportToRequire(imports)}\n${code}`;
    const arrowFunc = new Function(...argNames, code);
    const generatedCode = arrowFunc.apply(undefined, argValues);
    const exportAs = (stmt.declaration.declarations[0].id as babel.Identifier).name;
    const generatedAst = parse(`export const ${exportAs} = (() => {${generatedCode}})()`, {
        plugins: [
            'typescript',
            'jsx',
            'classProperties',
            ['decorators', { decoratorsBeforeExport: true }],
        ],
        sourceType: 'module',
        sourceFilename: (stmt.loc as any).filename,
    });
    if (generatedAst.program.body.length !== 1) {
        throw new Error('should generate one and only one statement');
    }
    return generatedAst.program.body[0];
}

function translateImportToRequire(imports: babel.ImportDeclaration[]) {
    const lines = [];
    for (const stmt of imports) {
        if (stmt.source.value.startsWith('@motherboard/')) {
            continue;
        }
        for (const specifier of stmt.specifiers) {
            if (babel.isImportDefaultSpecifier(specifier)) {
                lines.push(`const ${specifier.local.name} = require('${stmt.source.value}').default;`);
            } else if (babel.isImportNamespaceSpecifier(specifier)) {
                lines.push(`const ${specifier.local.name} = require('${stmt.source.value}');`);
            } else {
                lines.push(`const { ${specifier.local.name} } = require('${stmt.source.value}');`);
            }
        }
    }
    return lines.join('\n');
}